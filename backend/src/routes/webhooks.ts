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
  const rows = await db.execute(sql`
    SELECT id FROM users WHERE id = ${appUserId} OR rc_app_user_id = ${appUserId} LIMIT 1
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
  log.info('rc.webhook', { type: event.type });
  return c.json({ ok: true });
});
