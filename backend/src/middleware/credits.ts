import { sql } from 'drizzle-orm';

import { db } from '../db/client.ts';
import { proNow } from '../lib/entitlement.ts';
import { Errors } from '../lib/errors.ts';
import { DAILY_CALL_CAP, FREE_ANALYSIS_LIMIT, todayKey } from '../lib/limits.ts';
import { log } from '../lib/logger.ts';

/**
 * The credit gate — one atomic statement, no transaction, no application lock.
 *
 * The trap: a user double-taps, two requests read analysis_count = 2
 * concurrently, both see a credit, both proceed. A conditional UPDATE closes it
 * — InnoDB takes the row lock and affectedRows tells you who won. Fails CLOSED:
 * if the row does not match, nobody is charged and nobody gets a call.
 *
 * `todayKey()` is UTC (it comes from the app's limits.ts). The pool is opened
 * with timezone 'Z' to match. Never use CURDATE().
 */
export async function chargeCredit(userId: string): Promise<void> {
  const today = todayKey();
  const now = Date.now();

  const [result] = await db.execute(sql`
    UPDATE users
       SET analysis_count   = analysis_count + 1,
           daily_call_count = IF(daily_call_date = ${today}, daily_call_count + 1, 1),
           daily_call_date  = ${today},
           updated_at       = ${now}
     WHERE id = ${userId}
       AND banned_at IS NULL
       AND (${proNow()} OR analysis_count < ${FREE_ANALYSIS_LIMIT})
       AND (daily_call_date <> ${today} OR daily_call_count < ${DAILY_CALL_CAP})
  `);

  if ((result as { affectedRows: number }).affectedRows === 0) {
    throw Errors.outOfCredits();
  }
}

/**
 * Give the credit back.
 *
 * Rejected work must not charge — `profile.tsx` already returns before
 * `incrementAnalysis()` when `isProfile` is false, and the server has to match
 * or the two disagree about the balance. Also used when the AI call fails after
 * the charge: the user got nothing, so they pay nothing.
 */
export async function refundCredit(userId: string, reason: string): Promise<void> {
  const now = Date.now();
  await db.execute(sql`
    UPDATE users
       SET analysis_count   = GREATEST(analysis_count - 1, 0),
           daily_call_count = GREATEST(daily_call_count - 1, 0),
           updated_at       = ${now}
     WHERE id = ${userId}
  `);
  log.info('credit.refund', { userId, reason });
}

export async function creditsFor(userId: string): Promise<{
  isPro: boolean;
  analysisCount: number;
  remaining: number;
}> {
  const rows = await db.execute(sql`
    SELECT ${proNow()} AS is_pro, analysis_count FROM users WHERE id = ${userId} LIMIT 1
  `);
  const row = (rows as unknown as [Array<{ is_pro: number; analysis_count: number }>])[0]?.[0];
  const isPro = row?.is_pro === 1;
  const analysisCount = row?.analysis_count ?? 0;
  return {
    isPro,
    analysisCount,
    remaining: isPro ? Number.MAX_SAFE_INTEGER : Math.max(0, FREE_ANALYSIS_LIMIT - analysisCount),
  };
}

/**
 * The `credits` object every response carries, in the ONE shape the client reads.
 *
 * These key names are a contract with `Credits` in the app's `state/session.ts`,
 * and `useRizzStore` writes them into the store verbatim. Drift is not a display
 * bug: `/v1/ai/*` once returned `{ is_pro, remaining }`, so `analysis_count`
 * arrived `undefined`, the meter rendered `NaN/3 free`, and — the expensive part —
 * `useOutOfCredits` evaluated `undefined >= 3` as false and handed free users
 * unlimited analyses. Rename a key here only alongside the app and the Kotlin
 * chat client. Guarded by credits.selfcheck.ts.
 */
export function creditsEnvelope(credits: { isPro: boolean; analysisCount: number; remaining: number }) {
  return {
    is_pro: credits.isPro,
    analysis_count: credits.analysisCount,
    // null, not MAX_SAFE_INTEGER: the client renders a Pro chip instead of a meter.
    credits_remaining: credits.isPro ? null : credits.remaining,
  };
}
