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
 * A webhook (blueprint Phase 3) is the eventual shape: it is push, so a
 * cancellation lands immediately instead of at the next call. This is the pull
 * version — one request, no public endpoint to secure, no signature to verify,
 * and it is enough while entitlement is only read on login and resume.
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
