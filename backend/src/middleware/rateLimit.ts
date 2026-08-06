import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';

import { db } from '../db/client.ts';
import { Errors } from '../lib/errors.ts';
import { log } from '../lib/logger.ts';

/**
 * Two token buckets, and which one you get is a security decision.
 *
 * `rateLimit()` is in-process. Correct for ONE long-lived instance; on a
 * serverless target every warm lambda starts with an empty Map, so the limit is
 * really "N per instance" for an N the platform picks. That is acceptable for
 * the AI and user routes, where it is only the cheap layer — the thing actually
 * protecting the Gemini bill is the per-day cap inside the credit gate, which
 * lives in the database and survives both restarts and horizontal scaling.
 *
 * `dbRateLimit()` is shared, and the credential paths use it. It is not
 * acceptable for `/v1/auth/*` to be per-instance: there is no password reset in
 * this product, so an account taken by brute force is taken permanently, and
 * "the limiter evaporates if the platform scales out" is not a property you can
 * have in front of that. It costs two round-trips on a low-volume path, which is
 * the correct trade.
 *
 * ponytail: MySQL rather than Redis. The database is already here, already
 * pooled and already the store of record for the other limit that matters; a
 * second stateful service earns its keep when auth volume makes two extra
 * queries per attempt show up in a latency profile, and not before.
 */
interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

function take(key: string, capacity: number, refillPerSec: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.updatedAt) / 1000) * refillPerSec);
  b.updatedAt = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}

/** Unbounded maps are how a long-running process leaks. Sweep idle buckets. */
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [k, b] of buckets) if (b.updatedAt < cutoff) buckets.delete(k);
}, 60_000).unref();

/**
 * The caller's IP, taken from the hop OUR proxy appended.
 *
 * `X-Forwarded-For` accumulates left to right — `client, proxy1, proxy2` — so the
 * LEFTMOST entry is whatever the client felt like sending. Keying a bucket on it
 * meant an attacker could send a fresh random value per request and get a fresh
 * full bucket every time: a 100% bypass of every IP limit in the service,
 * including the one in front of `/v1/auth/login` on a product with no password
 * reset. The rightmost entry is the one the platform wrote and the client cannot
 * reach.
 *
 * ⚠️ This assumes EXACTLY ONE trusted proxy in front of the app, which is what
 * Render and Vercel both give you. Put a CDN or a second load balancer in front
 * and the trusted hop moves — count from the right and skip the ones you added,
 * or you will silently collapse every user into one shared bucket.
 */
export function clientIp(headers: {
  get(name: string): string | null | undefined;
}): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((h) => h.trim()).filter(Boolean);
    const trusted = hops[hops.length - 1];
    if (trusted) return trusted;
  }
  // Vercel's own header, then the generic one. Both are set by the platform.
  return headers.get('x-vercel-forwarded-for') ?? headers.get('x-real-ip') ?? 'unknown';
}

export function rateLimit(opts: { capacity: number; refillPerSec: number; by: 'user' | 'ip' }): MiddlewareHandler {
  return async (c, next) => {
    const id = opts.by === 'user' ? c.get('user')?.sub : clientIp(c.req.raw.headers);
    if (!take(`${opts.by}:${id}`, opts.capacity, opts.refillPerSec)) throw Errors.rateLimited();
    await next();
  };
}

// ── Shared bucket, for the paths where per-instance is not good enough ────────

/**
 * The refilled balance, as SQL, so the WHERE and the SET cannot disagree.
 *
 * Written twice in the statement below on purpose: MySQL has no way to name an
 * expression in the same UPDATE that tests it, and computing it in JS from a
 * value we read a moment ago is exactly the read-then-write race the row lock is
 * here to close.
 */
function refilled(capacity: number, refillPerSec: number, now: number) {
  return sql`LEAST(${capacity}, tokens + ((${now} - updated_at) / 1000) * ${refillPerSec})`;
}

/**
 * Idle rows are dead weight — a bucket untouched for an hour has refilled to
 * capacity, which is indistinguishable from not existing. Swept opportunistically
 * rather than on a timer because a serverless instance may not live long enough
 * for a timer to fire, and never awaited: a failed sweep must not fail a login.
 */
let sweptAt = 0;
function sweep(now: number): void {
  if (now - sweptAt < 10 * 60_000) return;
  sweptAt = now;
  void db
    .execute(sql`DELETE FROM rate_limits WHERE updated_at < ${now - 60 * 60_000} LIMIT 500`)
    .catch((err) => log.error('ratelimit.sweep', err));
}

/**
 * Take one token from a bucket shared by every instance.
 *
 * Two statements rather than one upsert, for the same reason `chargeCredit` is a
 * conditional UPDATE: `affectedRows` is what tells you whether you won, and an
 * `ON DUPLICATE KEY UPDATE` always reports success. The INSERT IGNORE seeds a
 * full bucket and is a no-op forever after; the UPDATE takes the token under the
 * row lock, so two concurrent attempts cannot both see the last one.
 *
 * Fails OPEN on a database error. This is the opposite of `chargeCredit`, which
 * fails closed, and the asymmetry is deliberate: a broken database that also
 * locks every user out of their account turns a degraded service into a total
 * outage, and the per-account lockout in routes/auth.ts is still standing.
 */
export function dbRateLimit(opts: {
  capacity: number;
  refillPerSec: number;
  by: 'user' | 'ip';
  scope: string;
}): MiddlewareHandler {
  return async (c, next) => {
    const id = opts.by === 'user' ? c.get('user')?.sub : clientIp(c.req.raw.headers);
    const bucket = `${opts.scope}:${opts.by}:${id}`;
    const now = Date.now();
    const balance = refilled(opts.capacity, opts.refillPerSec, now);

    // Decided inside the try, thrown outside it — otherwise the catch that is
    // supposed to swallow database errors also swallows the 429.
    let allowed = true;
    try {
      await db.execute(sql`
        INSERT IGNORE INTO rate_limits (bucket, tokens, updated_at)
        VALUES (${bucket}, ${opts.capacity}, ${now})
      `);
      const [result] = await db.execute(sql`
        UPDATE rate_limits
           SET tokens = ${balance} - 1, updated_at = ${now}
         WHERE bucket = ${bucket} AND ${balance} >= 1
      `);
      allowed = (result as { affectedRows: number }).affectedRows > 0;
      sweep(now);
    } catch (err) {
      log.error('ratelimit.db', err, { scope: opts.scope });
    }

    if (!allowed) throw Errors.rateLimited();
    await next();
  };
}
