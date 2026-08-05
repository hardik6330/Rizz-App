import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../db/client.ts';
import { proNow } from '../lib/entitlement.ts';
import { ApiError, Errors } from '../lib/errors.ts';
import { signAccess } from '../lib/jwt.ts';
import { FREE_ANALYSIS_LIMIT } from '../lib/limits.ts';
import { log } from '../lib/logger.ts';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../lib/password.ts';
import { requireAuth } from '../middleware/auth.ts';

/**
 * Identity, in two layers.
 *
 * `/device` is the anonymous install identity the app has always had: no email,
 * no password, no signup screen, because asking for an account before the first
 * analysis destroys activation in a product people are already self-conscious
 * about using.
 *
 * `/signup` and `/login` layer an account on top of that, and the ordering is
 * the point: signup CLAIMS the row the install already owns instead of creating
 * a new one, so credits already spent stay spent, and a reinstall that logs in
 * lands back on the same row rather than a fresh set of free analyses.
 *
 * There is deliberately NO password reset and NO email verification in v1 — see
 * the note on /signup. Both are on the roadmap; neither is here.
 *
 * PHASE 1 CAVEAT: a JWT alone does not stop someone extracting the endpoint and
 * minting install_ids. Play Integrity / App Attest gating token issuance is
 * Phase 5 and is what actually makes the Gemini key safe. Until then the real
 * protection is the per-day cap in the credit gate plus the global kill switch.
 */
const Body = z.object({
  /**
   * Absent on first launch — the server mints it and returns it, and the client
   * persists it forever.
   *
   * Deliberately not generated client-side: React Native has no `crypto` global,
   * so the app would need `expo-crypto` (a native module, therefore a rebuild
   * rather than an OTA) or `Math.random`, which is not unguessable — and this id
   * IS the credential that owns a user's credits.
   */
  install_id: z.string().uuid().optional(),
  platform: z.enum(['ios', 'android']),
  app_version: z.string().max(24).optional(),
});

export const auth = new Hono();

interface UserRow {
  id: string;
  is_pro: number;
  analysis_count: number;
  banned_at: number | null;
  /** Null until /signup. The client shows it, and uses it as "am I signed in?". */
  username: string | null;
}

/** One row by primary key, or undefined. */
async function userById(id: string): Promise<UserRow | undefined> {
  const rows = await db.execute(sql`
    SELECT id, ${proNow()} AS is_pro, analysis_count, banned_at, username FROM users WHERE id = ${id} LIMIT 1
  `);
  return (rows as unknown as [UserRow[]])[0]?.[0];
}

/**
 * The response body `/device`, `/signup` and `/login` all return.
 *
 * One shape, because the client persists the token and pushes `user` straight
 * into the store on every one of them — three hand-rolled bodies is how
 * `analysis_count` goes missing on one path and `useOutOfCredits` starts
 * evaluating `undefined >= 3`. See the note on `creditsEnvelope`.
 */
async function sessionFor(user: UserRow, installId?: string) {
  const isPro = user.is_pro === 1;
  const { token, expiresIn } = await signAccess({ sub: user.id, pro: isPro });
  return {
    access_token: token,
    expires_in: expiresIn,
    ...(installId ? { install_id: installId } : {}),
    user: {
      /*
       * The client passes this to `Purchases.logIn()` so RevenueCat's App User
       * ID IS our user id. Without it the SDK invents an anonymous
       * `$RCAnonymousID:` that dies with the install, and a subscriber who
       * reinstalls cannot restore. Safe to expose: it is an opaque UUID the
       * bearer already holds a token for, and every request is authorised by
       * that token, never by this.
       */
      id: user.id,
      // null = anonymous install. The client gates its account UI on this.
      username: user.username,
      is_pro: isPro,
      analysis_count: user.analysis_count,
      credits_remaining: isPro ? null : Math.max(0, FREE_ANALYSIS_LIMIT - user.analysis_count),
      limits: { free_analysis: FREE_ANALYSIS_LIMIT },
    },
  };
}

auth.post('/device', async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw Errors.badRequest('install_id and platform are required');
  const { platform, app_version } = parsed.data;
  const install_id = parsed.data.install_id ?? randomUUID();

  const now = Date.now();
  const id = randomUUID();

  // Upsert on install_id. The UNIQUE key makes concurrent first-launch races a
  // no-op rather than a duplicate user with a fresh set of free credits.
  await db.execute(sql`
    INSERT INTO users (id, install_id, platform, app_version, created_at, updated_at)
    VALUES (${id}, ${install_id}, ${platform}, ${app_version ?? null}, ${now}, ${now})
    ON DUPLICATE KEY UPDATE app_version = VALUES(app_version), updated_at = ${now}
  `);

  const rows = await db.execute(sql`
    SELECT id, ${proNow()} AS is_pro, analysis_count, banned_at, username FROM users WHERE install_id = ${install_id} LIMIT 1
  `);
  const user = (rows as unknown as [UserRow[]])[0]?.[0];
  if (!user) throw Errors.badRequest('could not create device');
  if (user.banned_at) throw Errors.banned();

  log.info('auth.device', { platform, isNew: user.id === id });

  // install_id echoed back so a first-launch client can persist the one the
  // server minted.
  return c.json(await sessionFor(user, install_id));
});

// ── POST /v1/auth/signup ─────────────────────────────────────────────────────

/**
 * Username is public and shown back to the user; email and password are not.
 *
 * Minimum length over composition rules on purpose — NIST 800-63B dropped the
 * "one uppercase, one symbol" advice because it pushes people toward `Passw0rd!`
 * and a password manager toward nothing. 10 characters, anything in them.
 */
const SignupBody = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(32, 'Username must be 32 characters or fewer')
    .regex(/^[a-z0-9_]+$/i, 'Username can use letters, numbers and _ only'),
  email: z
    .string()
    .email('That email does not look right')
    .max(255)
    .transform((e) => e.trim().toLowerCase()),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(128, 'Password must be 128 characters or fewer'),
});

/**
 * Attach an account to the install that is already calling us.
 *
 * `requireAuth`, not anonymous: the caller must already hold a device token, and
 * the account is written onto THAT row. Creating a fresh row here would hand out
 * three more free analyses for the price of a signup form, which is the exact
 * hole an account is supposed to close.
 *
 * No email verification, by decision: without a resend endpoint a mistyped email
 * would be an account with no way back in, which is worse than not verifying at
 * all. The cost is that an email costs nothing to invent, so this endpoint does
 * NOT by itself stop reinstall farming — the IP-scoped grant cap and the global
 * spend ceiling are what bound that. Do not describe this as anti-abuse.
 */
auth.post('/signup', requireAuth, async (c) => {
  const { sub } = c.get('user');
  const parsed = SignupBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? 'Check your details');
  const { username, email, password } = parsed.data;

  const hash = await hashPassword(password);

  try {
    const [result] = await db.execute(sql`
      UPDATE users
         SET username      = ${username},
             email         = ${email},
             password_hash = ${hash},
             updated_at    = ${Date.now()}
       WHERE id = ${sub} AND email IS NULL
    `);
    // `email IS NULL` in the predicate: a second signup on an install that
    // already has an account must not silently overwrite the credentials on it.
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw Errors.badRequest('This device already has an account — log in instead');
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      // Usernames are public, so naming the clash is helpful. Emails are not:
      // "that email is in use" is an account-existence oracle, so it gets the
      // same vague message as anything else that went wrong.
      throw String((err as Error).message).includes('uq_users_username')
        ? Errors.badRequest('That username is taken')
        : Errors.badRequest('Could not create the account');
    }
    throw err;
  }

  const user = await userById(sub);
  if (!user) throw Errors.unauthorized();

  // Never the email, never the username — same rule as logger.ts.
  log.info('auth.signup');
  return c.json(await sessionFor(user));
});

// ── POST /v1/auth/login ──────────────────────────────────────────────────────

const LoginBody = z.object({
  email: z.string().email().max(255).transform((e) => e.trim().toLowerCase()),
  password: z.string().min(1).max(128),
});

/** Consecutive failures before the account is parked for LOCKOUT_MS. */
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MS = 15 * 60_000;

interface LoginRow extends UserRow {
  password_hash: string | null;
  failed_logins: number;
  locked_until: number | null;
}

/**
 * Email + password → a session on the ORIGINAL user row.
 *
 * This is the endpoint that makes an account worth having: a reinstall gets a
 * new install_id and a new anonymous row, then logs in and is handed back the
 * row it started with — spent credits, Pro state and all.
 *
 * With no reset flow, an attacker who brute-forces an account takes it
 * permanently. So the lockout below is load-bearing, and so is the token bucket
 * on this path in app.ts.
 */
auth.post('/login', async (c) => {
  const parsed = LoginBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw Errors.badRequest('Email and password are required');
  const { email, password } = parsed.data;
  const now = Date.now();

  const rows = await db.execute(sql`
    SELECT id, password_hash, failed_logins, locked_until, banned_at,
           ${proNow()} AS is_pro, analysis_count, username
      FROM users WHERE email = ${email} LIMIT 1
  `);
  const row = (rows as unknown as [LoginRow[]])[0]?.[0];

  if (row?.banned_at) throw Errors.banned();
  if (row?.locked_until != null && row.locked_until > now) throw Errors.rateLimited();

  /*
   * Hash even when there is no such user.
   *
   * A missing row returns in ~1ms and a real one in ~100ms, and that difference
   * is an account-existence oracle no amount of careful error copy can cover.
   * The dummy costs one scrypt on a path that is already rate limited.
   */
  const ok = row
    ? await verifyPassword(password, row.password_hash)
    : await verifyPassword(password, await DUMMY_HASH);

  // `!row` is folded in here rather than returned early above, so a missing
  // email and a wrong password take the same path and the same time.
  if (!ok || !row) {
    if (row) {
      const failed = row.failed_logins + 1;
      await db.execute(sql`
        UPDATE users
           SET failed_logins = ${failed},
               locked_until  = ${failed >= MAX_FAILED_LOGINS ? now + LOCKOUT_MS : null}
         WHERE id = ${row.id}
      `);
      if (failed >= MAX_FAILED_LOGINS) log.warn('auth.locked', { failed });
    }
    // ONE message for both branches. "No such user" tells an attacker which
    // half of the guess to keep.
    throw Errors.invalidCredentials();
  }

  await db.execute(sql`
    UPDATE users SET failed_logins = 0, locked_until = NULL, updated_at = ${now}
     WHERE id = ${row.id}
  `);

  log.info('auth.login');
  return c.json(await sessionFor(row));
});
