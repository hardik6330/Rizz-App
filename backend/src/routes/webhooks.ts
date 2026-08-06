import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { db } from '../db/client.ts';
import { env } from '../env.ts';
import { log } from '../lib/logger.ts';
import { verifyWebhook } from '../lib/rcSignature.ts';
import { syncEntitlementFor } from '../lib/revenuecat.ts';

/**
 * RevenueCat webhooks — the push half of entitlement.
 *
 * `/v1/user/pro` only fires when the app is open, so without this a cancellation,
 * a refund or a failed renewal is invisible until the user launches the app —
 * and a churned user who never launches it again keeps unlimited AI at our cost,
 * for ever, showing up in no dashboard. That is the leak this route closes.
 *
 * Deliberately NOT behind `requireAuth`: RevenueCat has no JWT. The signature is
 * the whole authentication, which is why lib/rcSignature.ts has a selfcheck and
 * why there is no "unverified but let it through" branch.
 *
 * Every reply is 200 once the signature checks out. RevenueCat treats anything
 * else as a failure and retries five times (5/10/20/40/80 minutes) then gives up
 * — so a 404 for a user we do not recognise would buy four wasted retries and
 * still no user.
 */
export const webhooks = new Hono();

/**
 * Drop idempotency rows older than the retry schedule that needs them.
 *
 * `rc_events` only exists so a redelivered RENEWAL is a no-op. RevenueCat gives
 * up after 5/10/20/40/80 minutes — under three hours — so a row a week old
 * protects against nothing and is pure storage: at 100K subscribers on monthly
 * renewals this table was growing by ~2M rows a year with no reader.
 *
 * Opportunistic rather than a cron, for the same reason as the rate-limit sweep:
 * a serverless instance may not live long enough for a timer to fire, and this
 * endpoint is the one guaranteed to run whenever there are rows to clean. LIMIT
 * bounds the gap lock — an unbounded DELETE on this table would block the
 * INSERT IGNORE above it. Never awaited: a failed sweep must not fail a webhook,
 * because RevenueCat reads anything but 200 as "retry".
 */
let sweptAt = 0;
const RETENTION_MS = 7 * 24 * 60 * 60_000;

function sweepEvents(now: number): void {
  if (now - sweptAt < 60 * 60_000) return;
  sweptAt = now;
  void db
    .execute(sql`DELETE FROM rc_events WHERE created_at < ${now - RETENTION_MS} LIMIT 5000`)
    .catch((err) => log.error('rc.sweep', err));
}

interface RcEvent {
  id?: string;
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
}

webhooks.post('/revenuecat', async (c) => {
  if (!env.REVENUECAT_WEBHOOK_SECRET) {
    // Unconfigured is a misconfiguration, not an open door.
    log.error('rc.webhook.unconfigured');
    return c.json({ ok: false }, 503);
  }

  // The RAW body, before any parsing: the signature covers the exact bytes, and
  // re-serialising the parsed object changes key order and whitespace enough to
  // break it for reasons nothing in the log explains.
  const raw = await c.req.text();
  const ok = verifyWebhook(env.REVENUECAT_WEBHOOK_SECRET, raw, {
    signature: c.req.header('x-revenuecat-webhook-signature'),
    authorization: c.req.header('authorization'),
  });
  if (!ok) {
    log.warn('rc.webhook.bad_signature');
    return c.json({ ok: false }, 401);
  }

  const body = JSON.parse(raw || '{}') as { event?: RcEvent };
  const event = body.event ?? {};
  const eventId = event.id;
  const appUserId = event.app_user_id ?? event.original_app_user_id;
  if (!eventId || !appUserId) return c.json({ ok: true });

  /*
   * Idempotency. Delivery is at-least-once, so the same RENEWAL arrives twice
   * often enough to matter; INSERT IGNORE makes the second one a no-op without
   * a read-then-write race.
   */
  const [inserted] = await db.execute(sql`
    INSERT IGNORE INTO rc_events (event_id, user_id, type, created_at)
    VALUES (${eventId}, ${appUserId}, ${event.type ?? 'UNKNOWN'}, ${Date.now()})
  `);
  if ((inserted as { affectedRows: number }).affectedRows === 0) {
    return c.json({ ok: true, duplicate: true });
  }

  /*
   * `app_user_id` IS `users.id` — that is the whole reason the app calls
   * Purchases.logIn(). The lookup is on rc_app_user_id anyway so that rows
   * written before that change still resolve.
   */
  /*
   * UNION ALL, not `id = ? OR rc_app_user_id = ?`.
   *
   * MySQL cannot serve a disjunction across two different indexes from one of
   * them: it either builds an index_merge or, with a LIMIT 1 and unlucky stats,
   * gives up and scans the table. That is fine at a thousand rows and a
   * multi-second scan at a million — on an endpoint RevenueCat abandons after
   * 60s and then retries five times, so a slow lookup turns one renewal into six
   * table scans. Two seeks against the keys that already exist instead.
   */
  const rows = await db.execute(sql`
    SELECT id FROM users WHERE id = ${appUserId} LIMIT 1
    UNION ALL
    SELECT id FROM users WHERE rc_app_user_id = ${appUserId} LIMIT 1
  `);
  const user = (rows as unknown as [Array<{ id: string }>])[0]?.[0];
  if (!user) {
    // A sandbox tester, or a user who deleted their account. Not an error.
    log.warn('rc.webhook.unknown_user', { type: event.type });
    return c.json({ ok: true });
  }

  /*
   * Re-ask RevenueCat rather than trusting the payload — see revenuecat.ts.
   *
   * ponytail: done inline, one ~1s round trip inside RevenueCat's 60s timeout.
   * If webhook volume ever makes that tight, write the event, return 200, and
   * drain rc_events from a worker; the idempotency row is already the queue.
   */
  await syncEntitlementFor(user.id, appUserId);
  sweepEvents(Date.now());
  log.info('rc.webhook', { type: event.type });
  return c.json({ ok: true });
});
