import type { MiddlewareHandler } from 'hono';

import { Errors } from '../lib/errors.ts';

/**
 * In-memory token bucket. Correct for ONE API instance, which is the v1 shape.
 *
 * ponytail: in-process counters, move to Redis when you run a second instance.
 * Until then a shared store is a stateful dependency bought for a problem that
 * does not exist. The day you scale out, this file is the only thing that
 * changes — see blueprint §10.
 *
 * This is the cheap layer. The layer that actually protects the Gemini bill is
 * the per-day cap inside the credit gate, which is in the database and therefore
 * survives both restarts and horizontal scaling.
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

export function rateLimit(opts: { capacity: number; refillPerSec: number; by: 'user' | 'ip' }): MiddlewareHandler {
  return async (c, next) => {
    const id =
      opts.by === 'user'
        ? c.get('user')?.sub
        : c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    if (!take(`${opts.by}:${id}`, opts.capacity, opts.refillPerSec)) throw Errors.rateLimited();
    await next();
  };
}
