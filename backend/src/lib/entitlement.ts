import { sql } from 'drizzle-orm';

/**
 * "Is this row Pro *right now*?" — as a SQL fragment, so every caller agrees.
 *
 * `is_pro` alone is a lie the moment a subscription lapses: it is only rewritten
 * when the app calls /v1/user/pro or a webhook lands, and both can fail. The
 * expiry column was already being written by checkEntitlement() and read by
 * nobody, which meant a cancelled subscriber kept unlimited AI forever — the
 * whole cost of an expired account, invisible in every dashboard.
 *
 * A function rather than a const because `Date.now()` must be evaluated per
 * query, not once at module load.
 *
 * NULL expires_at is NOT expired: RevenueCat sends a null `expires_date` for
 * non-expiring entitlements, including promo grants made from their dashboard.
 */
export function proNow() {
  return sql`(is_pro = 1 AND (entitlement_expires_at IS NULL OR entitlement_expires_at > ${Date.now()}))`;
}
