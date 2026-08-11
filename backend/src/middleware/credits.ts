import { sql } from 'drizzle-orm';

import { db } from '../db/client.ts';
import { proNow } from '../lib/entitlement.ts';
import { Errors } from '../lib/errors.ts';
import { DAILY_CALL_CAP, FREE_ANALYSIS_LIMIT, todayKey } from '../lib/limits.ts';
import { log } from '../lib/logger.ts';
import { sweeper } from '../lib/sweep.ts';

/**
 * Append the movement to the ledger. Evidence, never state.
 *
 * `users.analysis_count` stays the balance — this is the audit trail it does not
 * have. Without it, "it charged me twice and gave me one answer" is
 * uninvestigable and uncorrectable except by editing a row, and the failure that
 * most needs a record leaves none at all: a process killed between the charge
 * and the refund burns a credit silently, and Vercel has no SIGTERM to catch.
 *
 * NOT awaited, and that is the trade. The counter is authoritative and already
 * durable, so a dropped ledger row costs evidence rather than money — and
 * awaiting it would put a second round trip to Bangalore on the hot path of
 * every AI request purely for bookkeeping.
 */
function record(userId: string, delta: 1 | -1, reason: string, now: number): void {
  void db
    .execute(sql`
      INSERT INTO credit_events (user_id, delta, reason, created_at)
      VALUES (${userId}, ${delta}, ${reason}, ${now})
    `)
    .catch((err) => log.error('credit.ledger', err, { reason }));
  sweepLedger(now);
}

/**
 * 90 days. Long enough to answer a billing dispute that arrives a
 * subscription-cycle late, short enough that the table does not become the
 * largest thing in the database.
 */
const LEDGER_RETENTION_MS = 90 * 24 * 60 * 60_000;
const sweepLedger = sweeper(
  6 * 60 * 60_000,
  (now) => sql`DELETE FROM credit_events WHERE created_at < ${now - LEDGER_RETENTION_MS} LIMIT 5000`,
);

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

  // After the guard: a refused charge is not a movement.
  record(userId, 1, 'charge', now);
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
  record(userId, -1, reason, now);
  // The userId is dropped: every other line in this service omits identifiers,
  // and the ledger row above is now the per-user record this was standing in for.
  log.info('credit.refund', { reason });
}

export interface CreditState {
  isPro: boolean;
  analysisCount: number;
  remaining: number;
}

/**
 * Balance → the shape everything downstream reads. One definition of
 * "remaining", because there are now two ways to arrive at a count: this
 * module's own SELECT, and the row `requireAuth` already read.
 */
export function creditsFrom(isPro: boolean, analysisCount: number): CreditState {
  return {
    isPro,
    analysisCount,
    remaining: isPro ? Number.MAX_SAFE_INTEGER : Math.max(0, FREE_ANALYSIS_LIMIT - analysisCount),
  };
}

/**
 * Read the balance. **A round trip — prefer `creditsAfter` in routes/ai.ts.**
 *
 * Still the right call for `/v1/user/credits`, whose entire job is to answer
 * with the authoritative number and which makes no other query.
 */
export async function creditsFor(userId: string): Promise<CreditState> {
  const rows = await db.execute(sql`
    SELECT ${proNow()} AS is_pro, analysis_count FROM users WHERE id = ${userId} LIMIT 1
  `);
  const row = (rows as unknown as [Array<{ is_pro: number; analysis_count: number }>])[0]?.[0];
  return creditsFrom(row?.is_pro === 1, row?.analysis_count ?? 0);
}

/**
 * The `credits` object every response carries, in the ONE shape the client reads.
 *
 * These key names are a contract with `Credits` in the app's `services/auth.ts`,
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
