import type { SQL } from 'drizzle-orm';

import { db } from '../db/client.ts';
import { log } from './logger.ts';

/**
 * Throttled, fire-and-forget retention deletes.
 *
 * Four tables now need one — `rate_limits`, `rc_events`, `credit_events` and
 * `idempotency` — and the first two had already grown their own copy of this,
 * with the same three properties each and no shared name for the pattern.
 *
 * Opportunistic rather than a cron, because a serverless instance may not live
 * long enough for a timer to fire, and the request path is the one thing
 * guaranteed to run whenever there are rows worth cleaning.
 *
 * Never awaited: a failed sweep must not fail the request that happened to
 * trigger it. `rc_events` is the sharpest case — RevenueCat reads anything but
 * 200 as "retry".
 *
 * Every caller MUST bound its DELETE with a LIMIT. An unbounded delete on a
 * table with a hot INSERT takes gap locks wide enough to block it.
 *
 * ponytail: per-instance throttle, so N instances sweep N times an interval.
 * That is bounded by instance count rather than by traffic, which is the part
 * that matters; the deletes are idempotent and indexed.
 */
export function sweeper(everyMs: number, build: (now: number) => SQL) {
  let sweptAt = 0;
  return (now: number): void => {
    if (now - sweptAt < everyMs) return;
    sweptAt = now;
    void db.execute(build(now)).catch((err) => log.error('sweep.failed', err));
  };
}
