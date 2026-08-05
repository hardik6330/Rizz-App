import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../db/client.ts';
import { Errors } from '../lib/errors.ts';
import { signAccess } from '../lib/jwt.ts';
import { FREE_ANALYSIS_LIMIT } from '../lib/limits.ts';
import { log } from '../lib/logger.ts';
import { syncEntitlementFor } from '../lib/revenuecat.ts';
import { creditsFor } from '../middleware/credits.ts';

export const user = new Hono();

/**
 * The client reconciles MMKV against this on launch and on resume — beside the
 * existing `consumeChatUsage()` call in _layout.tsx. MMKV stays an optimistic
 * cache so the paywall still appears instantly; this is the truth.
 *
 * Swipe counts are deliberately absent: FREE_SWIPE_LIMIT gates a feed that is
 * generated once globally and cached, so swiping costs nothing and reinstalling
 * to reset it causes no financial harm. It stays in MMKV. See blueprint §6.3.
 */
user.get('/credits', async (c) => {
  const { sub } = c.get('user');
  const { isPro, analysisCount, remaining } = await creditsFor(sub);
  return c.json({
    is_pro: isPro,
    analysis_count: analysisCount,
    credits_remaining: isPro ? null : remaining,
    limits: { free_analysis: FREE_ANALYSIS_LIMIT },
  });
});

/**
 * Delete the account and everything attached to it.
 *
 * Not optional and not a feature: App Store Review 5.1.1(v) requires in-app
 * deletion for any app that lets a user create an account, and Play requires a
 * deletion path too. Shipping signup without this is a rejection.
 *
 * One statement is the whole implementation because the schema holds no images,
 * transcripts, reports or saved items — the user row IS the user's data. If that
 * ever stops being true, this route is the thing that has to grow.
 *
 * Hard DELETE, not a soft flag: "we kept your email but marked it inactive" is
 * not deletion, and the unique key on `email` would block them signing up again.
 */
user.delete('/me', async (c) => {
  const { sub } = c.get('user');
  await db.execute(sql`DELETE FROM users WHERE id = ${sub}`);
  // Never the email. The event is the record; the identity is what we just erased.
  log.info('user.deleted');
  return c.json({ ok: true });
});

const ProBody = z.object({
  rc_app_user_id: z.string().min(1).max(128),
  /** Consulted ONLY in mock mode — see lib/revenuecat.ts. */
  claimed_pro: z.boolean().default(false),
});

/**
 * Sync entitlement after a purchase or a restore, and re-issue the token.
 *
 * Without this the server believes every user is free, and a paying subscriber
 * is cut off after three analyses — the credit gate reads `is_pro` off the row,
 * not off anything the app says. Call it after `purchasePlan()`, after a
 * restore, and on launch.
 *
 * The client does not get to assert its own entitlement: it sends the RevenueCat
 * user id, and the server asks RevenueCat.
 */
user.post('/pro', async (c) => {
  const { sub } = c.get('user');
  const body = ProBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw Errors.badRequest('rc_app_user_id is required');

  // Same writer the webhook uses, so the two can race without disagreeing.
  const { isPro } = await syncEntitlementFor(sub, body.data.rc_app_user_id, body.data.claimed_pro);

  // Re-sign: the old token keeps asserting the old entitlement until it expires.
  const { token, expiresIn } = await signAccess({ sub, pro: isPro });
  const { analysisCount, remaining } = await creditsFor(sub);

  return c.json({
    access_token: token,
    expires_in: expiresIn,
    is_pro: isPro,
    analysis_count: analysisCount,
    credits_remaining: isPro ? null : remaining,
    limits: { free_analysis: FREE_ANALYSIS_LIMIT },
  });
});
