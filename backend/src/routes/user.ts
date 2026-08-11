import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../db/client.ts';
import { Coach, rememberCoach } from '../lib/coach.ts';
import { Errors } from '../lib/errors.ts';
import { signAccess } from '../lib/jwt.ts';
import { FREE_ANALYSIS_LIMIT } from '../lib/limits.ts';
import { log } from '../lib/logger.ts';
import { syncEntitlementFor } from '../lib/revenuecat.ts';
import { requireAccount } from '../middleware/auth.ts';
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
    /*
     * The stored onboarding answers, raw, so a reinstall can get its
     * personalisation back on the launch that follows the login.
     *
     * It rides here rather than on its own endpoint because this is already the
     * "what does the server actually think about me" call, made on launch and on
     * every resume — and `requireAuth` has already read the column, so it costs
     * a key in the JSON and nothing else.
     *
     * The client only ADOPTS it when it has none of its own; the device wins
     * otherwise. Answers just given offline must not be overwritten by an older
     * row, and a null here must never wipe a local profile and re-trigger the
     * setup screen.
     */
    coach: c.get('coachJson'),
  });
});

/**
 * Store / update the onboarding answers.
 *
 * The AI routes write this same column opportunistically on every analysis that
 * carries a coach profile; this endpoint exists for the one client that has the
 * answers before it has run anything — the onboarding screen. Both go through
 * `rememberCoach`, and both validate with `Coach`.
 *
 * That was not true until P2: this route parsed `z.string().max(64)` per field
 * and wrote the column directly, so it accepted values the enums do not define
 * and could overflow VARCHAR(255) with ten 64-character app names — MySQL would
 * truncate mid-string and every later read would fail to parse, silently
 * dropping the user's personalisation until they re-ran onboarding.
 *
 * `Coach` carries `.catch(undefined)`, so a payload it dislikes arrives here as
 * `undefined` rather than a parse error — hence the explicit check instead of
 * `safeParse`. An old build sending a since-renamed answer gets a 400 it can
 * act on, not a silent no-op.
 */
user.post('/coach', async (c) => {
  const { sub } = c.get('user');
  const coach = Coach.parse(await c.req.json().catch(() => null));
  if (!coach) throw Errors.badRequest('Invalid coach profile payload');

  await rememberCoach(sub, coach);
  return c.json({ ok: true });
});

/**
 * Delete the account and everything attached to it.
 *
 * Not optional and not a feature: App Store Review 5.1.1(v) requires in-app
 * deletion for any app that lets a user create an account, and Play requires a
 * deletion path too. Shipping signup without this is a rejection.
 *
 * This was one statement once, when the user row genuinely WAS the user's data.
 * It stopped being true at migration 0004 and again at 0008/0009, and the comment
 * claiming otherwise outlived the fact by longer than it should have. There are
 * **no foreign keys**, so nothing here cascades: every user-scoped table has to be
 * named in the transaction below by hand. Nothing fails if you forget one — the
 * rows simply outlive the account, which is the whole problem.
 *
 * Add a table, add a line. The order is deliberate: children first, the `users`
 * row last, so a failure mid-way rolls back rather than orphaning the children.
 *
 * Hard DELETE, not a soft flag: "we kept your email but marked it inactive" is
 * not deletion, and the unique key on `email` would block them signing up again.
 */
// `requireAccount`: irreversible, and a device token proves only that somebody
// holds this install id — not that they are the person whose account it is.
user.delete('/me', requireAccount, async (c) => {
  const { sub } = c.get('user');
  
  await db.transaction(async (tx) => {
    // 1. Purge audit ledger credit events
    await tx.execute(sql`DELETE FROM credit_events WHERE user_id = ${sub}`);
    // 2. Purge cached idempotent responses scoped to this user
    await tx.execute(sql`DELETE FROM idempotency WHERE id LIKE ${`${sub}:%`}`);
    // 3. Purge user-scoped rate limit buckets
    await tx.execute(sql`DELETE FROM rate_limits WHERE bucket LIKE ${`%:user:${sub}`}`);
    // 4. Purge saved profile scan summaries
    await tx.execute(sql`DELETE FROM profile_scans WHERE user_id = ${sub}`);
    // 5. Purge saved vault items
    await tx.execute(sql`DELETE FROM saved_items WHERE user_id = ${sub}`);
    // 6. Hard DELETE the parent user row
    await tx.execute(sql`DELETE FROM users WHERE id = ${sub}`);
  });

  // Never the email. The event is the record; the identity is what we just erased.
  log.info('user.deleted');
  return c.json({ ok: true });
});

/**
 * How many saved lines one response will carry.
 *
 * The query was unbounded. Nothing here is paginated and the client mirrors the
 * whole vault into MMKV, so "unbounded" meant one user's save loop could ask a
 * serverless function to serialise their entire history into a single JSON body
 * — a slow request that gets slower forever, on a plan billed by duration.
 *
 * 500 is far above any real vault (`FREE_ANALYSIS_LIMIT` is 3 and Pro users save
 * a handful per session) and is a size the client can hold and render without
 * windowing beyond what `vault.tsx` already does. Raising it is cheap; removing
 * it is not, so it is a constant rather than a literal in the SQL.
 */
const VAULT_PAGE = 500;

/**
 * Fetch saved vault items for the authenticated user.
 *
 * `has_more` is not decoration — the client REPLACES its local copy with this
 * response, and replacing a 600-item vault with the newest 500 would delete 100
 * lines from the user's device that still exist on the server. When the flag is
 * set the client merges instead. It is derived by asking for one row more than
 * we intend to return, which costs nothing and never lies.
 */
user.get('/vault', async (c) => {
  const { sub } = c.get('user');
  const rows = await db.execute(sql`
    SELECT id, category, text, note, saved_at
      FROM saved_items
     WHERE user_id = ${sub}
     ORDER BY saved_at DESC
     LIMIT ${VAULT_PAGE + 1}
  `);
  const all = (rows as unknown as [Array<{ id: string; category: string; text: string; note: string | null; saved_at: number }>])[0];
  const items = all.slice(0, VAULT_PAGE).map((row) => ({
    id: row.id,
    category: row.category,
    text: row.text,
    note: row.note ?? undefined,
    savedAt: row.saved_at,
  }));
  return c.json({ items, has_more: all.length > VAULT_PAGE });
});

const SaveVaultBody = z.object({
  id: z.string().min(1).max(64),
  category: z.string().min(1).max(32),
  text: z.string().min(1),
  note: z.string().max(255).optional(),
  savedAt: z.number().optional(),
});

/** Save / update a vault item. */
user.post('/vault', async (c) => {
  const { sub } = c.get('user');
  const body = SaveVaultBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw Errors.badRequest('Invalid item body');

  const { id, category, text, note, savedAt } = body.data;
  const now = savedAt ?? Date.now();

  await db.execute(sql`
    INSERT INTO saved_items (id, user_id, category, text, note, saved_at)
    VALUES (${id}, ${sub}, ${category}, ${text}, ${note ?? null}, ${now})
    ON DUPLICATE KEY UPDATE category = VALUES(category), text = VALUES(text), note = VALUES(note)
  `);

  return c.json({ ok: true });
});

/** Delete a saved item from vault by id. */
user.delete('/vault/:id', async (c) => {
  const { sub } = c.get('user');
  const id = c.req.param('id');
  await db.execute(sql`DELETE FROM saved_items WHERE id = ${id} AND user_id = ${sub}`);
  return c.json({ ok: true });
});

/** Delete all saved vault items for the authenticated user. */
user.delete('/vault', async (c) => {
  const { sub } = c.get('user');
  await db.execute(sql`DELETE FROM saved_items WHERE user_id = ${sub}`);
  return c.json({ ok: true });
});

/** Fetch past profile scan reports for the authenticated user. */
user.get('/scans', async (c) => {
  const { sub } = c.get('user');
  const rows = await db.execute(sql`
    SELECT id, mode, title, summary_json, created_at
      FROM profile_scans
     WHERE user_id = ${sub}
     ORDER BY created_at DESC
     LIMIT 20
  `);
  const scans = (rows as unknown as [Array<{ id: string; mode: string; title: string; summary_json: unknown; created_at: number }>])[0].map((row) => ({
    id: row.id,
    mode: row.mode,
    title: row.title,
    summary: typeof row.summary_json === 'string' ? JSON.parse(row.summary_json) : row.summary_json,
    createdAt: row.created_at,
  }));
  return c.json({ scans });
});

/** Delete a single scan report by id. */
user.delete('/scans/:id', async (c) => {
  const { sub } = c.get('user');
  const id = c.req.param('id');
  await db.execute(sql`DELETE FROM profile_scans WHERE id = ${id} AND user_id = ${sub}`);
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
  // `ep` comes off the context rather than a fresh read — requireAuth already
  // fetched it, and re-signing with a stale epoch would revoke the token we are
  // in the middle of handing out.
  const { token, expiresIn } = await signAccess({ sub, pro: isPro, ep: c.get('user').ep });
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
