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

/** 24h. Long past any retry a client will still be attempting. */
const RETENTION_MS = 24 * 60 * 60_000;

const sweepKeys = sweeper(
  60 * 60_000,
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
      SELECT status, body FROM idempotency WHERE id = ${id} LIMIT 1
    `);
    const prior = (rows as unknown as [Array<{ status: number; body: string | null }>])[0]?.[0];

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
