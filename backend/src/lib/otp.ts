import { createHash, randomInt } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { db } from '../db/client.ts';
import { log } from './logger.ts';
import { sweeper } from './sweep.ts';

/**
 * Six-digit email codes: issue, verify, expire.
 *
 * See migration 0005 for the table and why it is shaped the way it is. The short
 * version of the security model, because it is easy to reach for the wrong knob:
 *
 *   A six-digit code is 1e6 possibilities. That is NOT a lot — it is only safe
 *   because a code is single-use, dies after 5 wrong guesses and expires in ten
 *   minutes. Guessing is bounded at 5 tries per code, and asking for a fresh
 *   code REPLACES the old one, so resending does not buy an attacker more
 *   guesses either. Every one of those three is load-bearing. Lengthening the
 *   code instead would buy far less than any of them and cost every user four
 *   more digits to type.
 *
 * The IP-scoped bucket in app.ts is the other half: it bounds how fast codes can
 * be requested at all.
 */

/** Ten minutes. Long enough for a slow mail hop, short enough that a leaked mailbox ages out. */
export const OTP_TTL_MS = 10 * 60_000;
/** Wrong guesses before the code is dead and the user must request another. */
export const MAX_OTP_ATTEMPTS = 5;
/**
 * Minimum gap between sends to one address.
 *
 * Not a rate limit on us — a rate limit on THEM: without it anyone can point
 * this endpoint at a stranger's inbox and hold the send button. Enforced per
 * address, which the IP bucket cannot do (an attacker changes IP; the victim's
 * address is the fixed thing).
 */
export const RESEND_COOLDOWN_MS = 60_000;

/**
 * Total sends to one address in 24h, cooldown or no cooldown.
 *
 * **The cooldown alone did not bound this.** It sets a MINIMUM GAP between
 * sends; it never caps the total. An attacker rotating IPs (to get past the
 * bucket in app.ts) and pacing to 60 seconds delivers 1,440 emails a day into
 * one person's inbox — each one billed to us, sent from our domain, and marked
 * as spam by the recipient. The cooldown made that slow. It did not make it
 * stop.
 *
 * 10 is generous for the real user it must not block: a signup, a couple of
 * "it didn't arrive" resends, and a recovery login all in one day is maybe five.
 *
 * Silent when hit, exactly like the cooldown — `issueOtp` returns null and the
 * caller answers as though it sent. A "you have requested too many codes"
 * message would confirm to the attacker that the address is worth attacking.
 */
export const MAX_SENDS_PER_WINDOW = 10;
/** Fixed 24h window; see migration 0007 for why fixed rather than sliding. */
export const SEND_WINDOW_MS = 24 * 60 * 60_000;

export type OtpPurpose = 'signup' | 'login';

/**
 * Retention, in two layers, because neither is sufficient alone.
 *
 *   1. A VERIFIED code is deleted the moment it is verified — see `verifyOtp`,
 *      where the DELETE *is* the check. There is no window in which a spent code
 *      still exists, which is what makes single-use single-use.
 *   2. An UNVERIFIED code expires in ten minutes and is deleted by this sweep,
 *      which is opportunistic: triggered by a request, throttled to once every
 *      thirty minutes per instance. Fast on a service with traffic, and it never
 *      fires at all on a quiet one.
 *
 * (2) is why migration 0006 adds a MySQL EVENT: a daily, traffic-independent
 * backstop that guarantees nothing unverified survives 7 days even if this sweep
 * never runs. This one is still worth having — it clears rows in minutes rather
 * than days whenever the service is actually being used.
 *
 * **It sweeps on `created_at`, not `expires_at`, and that is load-bearing.** It
 * used to drop rows ten minutes after issue, which is fine for a code and fatal
 * for the send counter added in migration 0007: the row carrying `sends` is the
 * only record that this address has been mailed today, so deleting it reset the
 * daily cap every ten minutes and the cap bounded nothing. The row now lives for
 * the length of the window it is counting.
 *
 * A surviving row is NOT a live code. `verifyOtp` has `expires_at > now` in its
 * DELETE predicate, so a code is dead on the dot at ten minutes whatever the row
 * does afterwards — what lingers is a SHA-256 and a small integer.
 */
const sweepExpired = sweeper(
  30 * 60_000,
  (now) => sql`DELETE FROM email_otps WHERE created_at < ${now - SEND_WINDOW_MS} LIMIT 5000`,
);

/**
 * A uniformly random six-digit string.
 *
 * `randomInt`, not `Math.random()`: this is a credential. Also not
 * `randomBytes % 1e6`, which is biased — 2^32 is not a multiple of a million, so
 * the low codes come up slightly more often, and "slightly" is measurable over
 * a table of them. `randomInt` does the rejection sampling for you.
 *
 * Leading zeros are kept (`padStart`), so the space really is 1e6 and not the
 * 900k you get by starting at 100000. The client field must therefore treat the
 * code as a STRING — `parseInt('012345')` is a different code.
 */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Bound to the row it was issued for.
 *
 * Including email and purpose means one precomputed table of a million SHA-256
 * digests does not unlock every row in a dump — an attacker needs one table per
 * address. It also makes a code physically un-replayable across purposes even if
 * the SQL that separates them were ever got wrong.
 */
export function hashCode(email: string, purpose: OtpPurpose, code: string): string {
  return createHash('sha256').update(`${email}:${purpose}:${code}`).digest('hex');
}

/**
 * Mint and store a code, unless one was just sent or this address has had
 * enough for one day.
 *
 * Returns `null` for BOTH refusals, and the caller answers the user identically
 * either way — so a swallowed resend is invisible to anyone probing, and the
 * person who genuinely double-tapped still has the code already on its way.
 *
 * The INSERT ... ON DUPLICATE KEY UPDATE resets `attempts` along with the hash.
 * That is intended: a NEW code is a clean slate. It is not a way around the
 * guess limit, because it also invalidates the code those guesses were spent on.
 */
export async function issueOtp(email: string, purpose: OtpPurpose): Promise<string | null> {
  const now = Date.now();
  sweepExpired(now);

  const rows = await db.execute(sql`
    SELECT created_at, sends, window_start
      FROM email_otps WHERE email = ${email} AND purpose = ${purpose} LIMIT 1
  `);
  const existing = (rows as unknown as [
    Array<{ created_at: number; sends: number; window_start: number }>,
  ])[0]?.[0];
  if (existing && now - existing.created_at < RESEND_COOLDOWN_MS) return null;

  const windowOpen = existing != null && now - existing.window_start < SEND_WINDOW_MS;
  if (windowOpen && existing.sends >= MAX_SENDS_PER_WINDOW) {
    // Not `log.warn` and no email in the line — the no-PII rule holds here too.
    // The `purpose` is enough to see a mailbomb in the aggregate.
    log.info('otp.capped', { purpose });
    return null;
  }

  /*
   * The counter is rolled in SQL rather than computed above and written back.
   *
   * Read-then-write here would let two concurrent requests both see `sends: 9`
   * and both write 10, which is one free send per race — the same reasoning as
   * `attempts + 1` in `verifyOtp`. The 60-second cooldown makes the race narrow
   * rather than impossible, and narrow races are the ones that ship.
   *
   * `sends` MUST be assigned before `window_start`: MySQL evaluates ODKU
   * assignments left to right, so the IF on this line still sees the OLD
   * `window_start`. Swap the two lines and every send opens a fresh window and
   * the cap never fires.
   *
   * ponytail: the check above is still read-then-decide, so a burst arriving
   * inside one round trip can overshoot the cap by the size of the burst. The
   * IP bucket and the cooldown both have to be beaten first, and the cost of
   * overshooting is a couple of extra emails. A single conditional UPDATE would
   * close it, at the price of not knowing whether to send.
   */
  const code = generateCode();
  const windowExpiredAt = now - SEND_WINDOW_MS;
  await db.execute(sql`
    INSERT INTO email_otps
      (email, purpose, code_hash, attempts, expires_at, created_at, sends, window_start)
    VALUES
      (${email}, ${purpose}, ${hashCode(email, purpose, code)}, 0,
       ${now + OTP_TTL_MS}, ${now}, 1, ${now})
    ON DUPLICATE KEY UPDATE
      code_hash    = VALUES(code_hash),
      attempts     = 0,
      expires_at   = VALUES(expires_at),
      created_at   = VALUES(created_at),
      sends        = IF(window_start < ${windowExpiredAt}, 1, sends + 1),
      window_start = IF(window_start < ${windowExpiredAt}, ${now}, window_start)
  `);
  return code;
}

/**
 * Consume a code. True exactly once per issued code.
 *
 * **One statement, on purpose.** The obvious version is SELECT, compare, DELETE
 * — and that has a window: two requests carrying the same correct code both read
 * the row, both compare true, and the code is spent twice. On /login that is a
 * second session handed out from one proof; on /signup, two accounts. Matching
 * the hash inside the DELETE's own predicate makes "check it and burn it" a
 * single atomic operation, and `affectedRows` IS the answer.
 *
 * The expiry and the attempt cap are in the same predicate for the same reason,
 * and it means a dead code takes precisely the same path as a wrong one.
 *
 * The hash comparison happens in MySQL rather than through `timingSafeEqual`.
 * The value compared is a SHA-256 of the code, not the code, so a byte-position
 * timing leak reveals nothing about which digits to try — and the attempt cap,
 * not comparison timing, is what bounds guessing here.
 */
export async function verifyOtp(email: string, purpose: OtpPurpose, code: string): Promise<boolean> {
  const now = Date.now();
  /*
   * Here as well as in `issueOtp`. The two are not the same trigger: a burst of
   * signups that all complete leaves plenty of ABANDONED rows from people who
   * never came back, and if the last `/otp` call was hours ago nothing else on
   * this instance would clear them. Costs one timestamp comparison — see sweep.ts.
   */
  sweepExpired(now);
  const [result] = await db.execute(sql`
    DELETE FROM email_otps
     WHERE email      = ${email}
       AND purpose    = ${purpose}
       AND code_hash  = ${hashCode(email, purpose, code)}
       AND expires_at > ${now}
       AND attempts   < ${MAX_OTP_ATTEMPTS}
  `);
  if ((result as { affectedRows: number }).affectedRows > 0) return true;

  /*
   * Wrong, expired, already used, or never existed — all indistinguishable from
   * here, which is the point. Charge an attempt against whatever row is there;
   * if there is none this updates nothing and costs one indexed no-op.
   *
   * `attempts + 1` in SQL rather than a read-then-write, so concurrent wrong
   * guesses cannot both write back the same number and give an attacker free
   * tries.
   */
  await db.execute(sql`
    UPDATE email_otps SET attempts = attempts + 1
     WHERE email = ${email} AND purpose = ${purpose}
  `);
  log.info('otp.rejected', { purpose });
  return false;
}
