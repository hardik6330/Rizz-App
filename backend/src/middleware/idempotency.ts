import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';

import { db } from '../db/client.ts';
import { ApiError } from '../lib/errors.ts';
import { log } from '../lib/logger.ts';
import { sweeper } from '../lib/sweep.ts';

/**
 * Replay protection for the endpoints that spend a credit.
 *
 * **The problem.** `/v1/ai/*` charges before it calls Gemini, and Gemini takes
 * 3–15 seconds. A client that retries a timed-out request — which React Native
 * does on transient network failures, and which `api.ts` does on its own for a
 * 401 — pays twice for one user action. On the free tier that is a third of the
 * trial, spent on a flaky connection, at the exact moment the user is deciding
 * whether the product works.
 *
 * **The contract.** The client sends `Idempotency-Key: <uuid>`, generated once
 * per user action and reused verbatim across that action's retries. Same key →
 * same answer, replayed from storage, no second charge.
 *
 * Absent header → straight through. The header is opt-in on purpose: this is
 * useless without a client that sends it, and a server that started *requiring*
 * it would break every build already in the field.
 *
 * **What is stored, and what is not.** Only 2xx. A failure is not a completed
 * action — the credit was already refunded by `charged()` and the retry should
 * genuinely re-attempt. Replaying a stored 503 would turn one bad minute into a
 * permanently broken key.
 */

/**
 * 15 minutes. **This was 24 hours, and 24 hours was a privacy defect.**
 *
 * `body` is the whole response envelope, and for `/v1/ai/*` that envelope's
 * `result` is the generated content: profile reports about a named third party,
 * rewritten bios, opening lines, chat replies. db/schema.ts opens with "NEVER
 * add: images, transcripts, replies, reports, or saved items… anything derived
 * from what a user analysed still has nowhere to live here" — a rule written at
 * migration 0003 and quietly broken by this table at 0004. The app tells users
 * "Screenshots and conversations are never saved" on the account screen, so this
 * was not just an internal rule being bent.
 *
 * The body cannot simply go: replaying it IS the feature, and a retry with no
 * stored answer means the user pays a second credit for the analysis they
 * already bought. What was wrong was the DURATION. A retry is something a client
 * does while the user is still looking at a spinner — seconds, or minutes across
 * a network drop and a resume. Nothing retries a request from yesterday, so the
 * other 23¾ hours were pure retention of content we promised not to keep.
 *
 * The sweep interval is tightened to match. Both together bound the worst case
 * at ~25 minutes rather than a day, and the read below refuses to replay a row
 * older than the window even if the sweep has not run yet — so correctness does
 * not depend on the sweep firing.
 *
 * ponytail: the ceiling is that a client which retried after 15 minutes gets a
 * fresh charge. Nothing in this app does; if some future offline queue does,
 * store a hash of the request and re-derive rather than lengthening this.
 */
const RETENTION_MS = 15 * 60_000;

const sweepKeys = sweeper(
  10 * 60_000,
  (now) => sql`DELETE FROM idempotency WHERE created_at < ${now - RETENTION_MS} LIMIT 5000`,
);

/** In flight: claimed by a request that has not finished yet. */
const IN_FLIGHT = 0;

/** Chain AFTER `requireAuth` — the key is scoped per user. */
export const idempotent: MiddlewareHandler = async (c, next) => {
  const key = c.req.header('idempotency-key');
  if (!key) return next();

  /*
   * Scoped by user, and length-capped.
   *
   * Without the user prefix one client's key collides with another's and returns
   * somebody else's analysis — a cross-account data leak out of a feature meant
   * to prevent double-billing. The cap keeps `id` inside VARCHAR(200): a 36-char
   * user id, a colon, and 128 characters of key is more than any sane client
   * sends and less than the column holds.
   */
  const id = `${c.get('user').sub}:${key.slice(0, 128)}`;
  const now = Date.now();

  /*
   * Claim it. `INSERT IGNORE` + `affectedRows` rather than a read-then-write,
   * for the same reason as `chargeCredit`: two concurrent retries must not both
   * decide they are the first one.
   */
  let claimed: boolean;
  try {
    const [result] = await db.execute(sql`
      INSERT IGNORE INTO idempotency (id, status, body, created_at)
      VALUES (${id}, ${IN_FLIGHT}, NULL, ${now})
    `);
    claimed = (result as { affectedRows: number }).affectedRows > 0;
  } catch (err) {
    /*
     * Fail OPEN, like `dbRateLimit` and unlike `chargeCredit`.
     *
     * A database blip here must not stop people using the product. The downside
     * of proceeding is the double-charge this exists to prevent — which is the
     * behaviour of every build shipped so far, so failing open is no worse than
     * not having the feature. Failing closed would be an outage.
     */
    log.error('idempotency.claim', err);
    return next();
  }

  if (!claimed) {
    const rows = await db.execute(sql`
      SELECT status, body, created_at FROM idempotency WHERE id = ${id} LIMIT 1
    `);
    const prior = (rows as unknown as [
      Array<{ status: number; body: string | null; created_at: number }>,
    ])[0]?.[0];

    /*
     * The age is checked HERE, not only by the sweep. The sweep is opportunistic
     * and per-instance, so a row outlives RETENTION_MS on a quiet service — and
     * the one thing that must never happen is generated content being handed
     * back long after we told the user it was gone. Enforcing the window on the
     * read means correctness does not depend on a timer firing; the sweep is
     * only reclaiming space.
     *
     * A stale row is dropped and the request proceeds unprotected — the same
     * fail-open posture as the claim above, and the alternative (a 409 on a key
     * whose answer we deliberately discarded) would be a dead end the client
     * cannot retry out of. It needs a client reusing one key across 15 minutes,
     * which no build in the field does.
     */
    if (prior && now - prior.created_at >= RETENTION_MS) {
      log.info('idempotency.expired');
      await db.execute(sql`DELETE FROM idempotency WHERE id = ${id}`).catch(() => {});
      return next();
    }

    if (prior && prior.status !== IN_FLIGHT && prior.body != null) {
      // The replay. This is the whole feature.
      return c.body(prior.body, prior.status as 200, { 'content-type': 'application/json' });
    }

    /*
     * Claimed but unfinished: the original request is still running, or died
     * without ever writing a result. 409 rather than a wait — the first attempt
     * may be 15 seconds into a Gemini call, and holding a second connection open
     * beside it on a pool of 1 is how a serverless instance deadlocks itself.
     *
     * Not retryable: retrying the SAME key hits this again. The client should
     * surface the original request's outcome, or start a new action with a new
     * key.
     */
    throw new ApiError(409, 'IN_FLIGHT', 'That request is already running', false);
  }

  try {
    await next();
  } catch (err) {
    // Release the claim so a genuine retry is not answered with 409 for 24h.
    // Same reasoning as the webhook claim in routes/webhooks.ts.
    await db.execute(sql`DELETE FROM idempotency WHERE id = ${id}`).catch(() => {});
    throw err;
  }

  const res = c.res;
  if (res.status >= 200 && res.status < 300) {
    // `clone()` before reading: a Response body is a single-use stream, and
    // reading it here would leave nothing for the client.
    const body = await res.clone().text();
    await db
      .execute(sql`
        UPDATE idempotency SET status = ${res.status}, body = ${body} WHERE id = ${id}
      `)
      .catch((err) => log.error('idempotency.store', err));
  } else {
    // Not a completed action. Let the retry actually retry.
    await db.execute(sql`DELETE FROM idempotency WHERE id = ${id}`).catch(() => {});
  }

  sweepKeys(now);
};
