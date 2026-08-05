import { sql } from 'drizzle-orm';

import { db } from '../db/client.ts';
import { env } from '../env.ts';
import { log } from './logger.ts';

/**
 * Is this RevenueCat app_user_id entitled to `pro`, according to RevenueCat?
 *
 * Asks RevenueCat directly instead of believing the app. `isPro` decides whether
 * the credit gate charges at all, so a client-supplied boolean would make
 * "server-side credits" mean nothing — anyone who unpacks the APK can send
 * `is_pro: true` forever.
 *
 * There are now TWO callers — the app after a purchase or restore, and the
 * webhook after a renewal, cancellation or refund — and they both go through
 * `syncEntitlementFor` below rather than doing their own UPDATE. That is what
 * makes the race between them harmless: whichever lands second re-asks
 * RevenueCat and writes the same answer. Webhook payloads are a TRIGGER, never
 * a source of truth; RevenueCat delivers at-least-once and does not guarantee
 * ordering, so replaying event bodies into state would eventually invert it.
 */
export interface Entitlement {
  isPro: boolean;
  expiresAt: number | null;
  verified: boolean;
}

export async function checkEntitlement(
  rcAppUserId: string,
  claimedPro: boolean,
): Promise<Entitlement> {
  if (!env.REVENUECAT_SECRET_KEY) {
    // Mock mode. Matches the client: with a stub SDK key `purchasePlan()` grants
    // Pro after a fake sheet, so refusing here would break preview builds while
    // protecting nothing. Loud, because the failure mode is silent and in the
    // user's favour — exactly the one AGENTS.md warns about.
    log.warn('rc.unverified', { claimedPro, reason: 'REVENUECAT_SECRET_KEY unset' });
    return { isPro: claimedPro, expiresAt: null, verified: false };
  }

  let res: Response;
  try {
    res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(rcAppUserId)}`, {
      headers: { Authorization: `Bearer ${env.REVENUECAT_SECRET_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Fail CLOSED on a network error: returning "pro" here would let anyone with
    // a way to break this one call have a free subscription.
    log.error('rc.network', err);
    return { isPro: false, expiresAt: null, verified: false };
  }

  if (!res.ok) {
    // 404 is normal and means "never purchased", not an error.
    if (res.status !== 404) log.error('rc.http', undefined, { status: res.status });
    return { isPro: false, expiresAt: null, verified: res.status === 404 };
  }

  const body = (await res.json()) as {
    subscriber?: { entitlements?: Record<string, { expires_date: string | null }> };
  };

  const pro = body.subscriber?.entitlements?.pro;
  if (!pro) return { isPro: false, expiresAt: null, verified: true };

  // A null expires_date is a lifetime/non-expiring entitlement, not an expired one.
  const expiresAt = pro.expires_date ? Date.parse(pro.expires_date) : null;
  return { isPro: expiresAt === null || expiresAt > Date.now(), expiresAt, verified: true };
}

/**
 * Ask RevenueCat, then write the answer onto the user row. The ONE writer.
 *
 * Returns the entitlement so callers can re-sign a token from it.
 */
export async function syncEntitlementFor(
  userId: string,
  rcAppUserId: string,
  claimedPro = false,
): Promise<Entitlement> {
  const result = await checkEntitlement(rcAppUserId, claimedPro);

  /*
   * Detach the id from any OTHER row first.
   *
   * `uq_users_rc` is UNIQUE, and before the app called `Purchases.logIn()` the
   * id was an anonymous `$RCAnonymousID:` that changed on every reinstall — so a
   * user who reinstalled and restored hit ER_DUP_ENTRY against their own
   * abandoned row and got a 500 on the one flow that was meant to give them
   * their subscription back. The id is now `users.id`, which cannot collide, but
   * this stays for every row written before that.
   */
  await db.execute(sql`
    UPDATE users SET rc_app_user_id = NULL
     WHERE rc_app_user_id = ${rcAppUserId} AND id <> ${userId}
  `);

  await db.execute(sql`
    UPDATE users
       SET rc_app_user_id         = ${rcAppUserId},
           is_pro                 = ${result.isPro ? 1 : 0},
           entitlement_expires_at = ${result.expiresAt},
           updated_at             = ${Date.now()}
     WHERE id = ${userId}
  `);

  // Never the rc id or the email — it is an account identifier like any other.
  log.info('rc.sync', { isPro: result.isPro, verified: result.verified });
  return result;
}
