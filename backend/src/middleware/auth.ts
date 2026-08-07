import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';

import { db } from '../db/client.ts';
import { proNow } from '../lib/entitlement.ts';
import { Errors } from '../lib/errors.ts';
import { verifyAccess, type Claims } from '../lib/jwt.ts';

declare module 'hono' {
  interface ContextVariableMap {
    user: Claims;
  }
}

/**
 * Bearer JWT → c.get('user'). Every route except /auth/device, /auth/login and
 * /healthz.
 *
 * The signature check is not enough on its own, and one indexed primary-key
 * lookup buys the two things it cannot give you:
 *
 *   - **Revocation.** `banned_at` was checked only when a token was ISSUED and
 *     inside chargeCredit, so a banned install kept working for the life of its
 *     token. With tokens now lasting 30 days that gap went from a bad day to a
 *     bad month.
 *   - **Fresh entitlement.** `pro` is a claim baked in at signing time. Reading
 *     it off the row means a cancelled subscription stops mattering at the next
 *     request instead of at the next token refresh — which is what makes a
 *     30-day token safe to hand out at all.
 *
 * The cost is one PK lookup per request, on a service that already does two to
 * three round trips before Gemini is called. If that ever shows up in a latency
 * profile, cache it in-process for a few seconds — do not remove it.
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw Errors.unauthorized();

  let claims: Claims;
  try {
    claims = await verifyAccess(token);
  } catch {
    throw Errors.unauthorized();
  }

  const rows = await db.execute(sql`
    SELECT ${proNow()} AS is_pro, banned_at, token_epoch
      FROM users WHERE id = ${claims.sub} LIMIT 1
  `);
  const row = (rows as unknown as [
    Array<{ is_pro: number; banned_at: number | null; token_epoch: number }>,
  ])[0]?.[0];

  // A deleted account is an invalid token, not a 500 further down the stack.
  if (!row) throw Errors.unauthorized();
  if (row.banned_at) throw Errors.banned();
  /*
   * Revoked. The row has moved past the epoch this token was signed with, which
   * means somebody signed out — possibly the real owner, on a device they no
   * longer hold. Free, because the row was already being read.
   */
  if (claims.ep !== row.token_epoch) throw Errors.unauthorized();

  c.set('user', { sub: claims.sub, pro: row.is_pro === 1, ep: row.token_epoch, dev: claims.dev });
  await next();
};

/**
 * Refuse a device token. Chain AFTER `requireAuth`.
 *
 * A device token proves possession of an install id and nothing else — no
 * password was ever entered. That is fine for spending credits (it is how the
 * native chat bubble works, days after the app was last opened, when a token
 * would long since have expired) and not fine for anything that changes or
 * destroys the account behind it.
 *
 * Deliberately NOT applied to `/v1/user/pro`: entitlement sync runs at launch,
 * before the user has necessarily logged back in, and failing it would strip Pro
 * from a subscriber for the sake of a route that only ever writes what
 * RevenueCat says. It is also not applied to `/v1/ai/*` — that is the bubble.
 */
export const requireAccount: MiddlewareHandler = async (c, next) => {
  if (c.get('user').dev) throw Errors.unauthorized();
  await next();
};
