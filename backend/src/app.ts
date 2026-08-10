import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';

import { assertSafetyRails } from './ai/prompts.ts';
import { db } from './db/client.ts';
import { ApiError } from './lib/errors.ts';
import { log, withRequestId } from './lib/logger.ts';
import { requireAuth } from './middleware/auth.ts';
import { idempotent } from './middleware/idempotency.ts';
import { dbRateLimit, rateLimit } from './middleware/rateLimit.ts';
import { ai } from './routes/ai.ts';
import { auth } from './routes/auth.ts';
import { legal } from './routes/legal.ts';
import { user } from './routes/user.ts';
import { webhooks } from './routes/webhooks.ts';

// Refuse to boot if the them-mode safety rails have gone missing. See prompts.ts.
assertSafetyRails();

export const app = new Hono();

/*
 * A correlation id on every request, and on every log line it produces.
 *
 * FIRST, before CORS and before any limiter, so that a request rejected by one
 * of those is still traceable — the rejections are the lines you most want to
 * correlate. See `withRequestId` in lib/logger.ts for why it is ambient rather
 * than a parameter.
 *
 * An inbound `x-request-id` is honoured so a proxy or a load test can supply its
 * own and have both sides agree; otherwise one is minted. Echoed back on the
 * response, which is what lets a user paste an id from a failing client into a
 * bug report and have it find something.
 */
app.use('*', async (c, next) => {
  const rid = c.req.header('x-request-id')?.slice(0, 64) || randomUUID();
  c.header('x-request-id', rid);
  await withRequestId(rid, next);
});

/*
 * CORS, with an explicit allowlist and never `*`.
 *
 * The native app does not need this — it is not a browser and sends no Origin.
 * Three things do: the `web.output: "static"` target declared in app.json, any
 * future admin surface, and a developer poking the API from a browser console.
 * All of them currently fail with an opaque network error and no CORS header to
 * explain why.
 *
 * `*` is wrong here specifically because this API is bearer-authenticated: a
 * wildcard origin plus a token in localStorage is how a malicious page reads a
 * user's account. `credentials` is left off for the same reason — the token
 * travels in a header, never a cookie, so nothing needs it.
 */
const ORIGINS = ['https://rizz-app-five.vercel.app', 'http://localhost:8081'];
app.use(
  '/v1/*',
  cors({
    origin: (origin) => (ORIGINS.includes(origin) ? origin : null),
    allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    maxAge: 86_400,
  }),
);

/** Liveness: is the process up. Deliberately dumb — no dependencies. */
app.get('/', (c) => c.text('Server is running!'));

/**
 * Readiness: can this instance actually serve a request?
 *
 * It used to return `{ ok: true }` unconditionally, and `render.yaml` points its
 * health check at it. `index.ts` exits(1) on a database that is unreachable AT
 * BOOT, but a database that dies afterwards left a "healthy" instance 500ing
 * every request with the platform happily routing traffic to it.
 *
 * Short timeout: a health check that hangs is read as a failure anyway, and
 * hanging occupies a connection from a pool of 1 on Vercel.
 */
app.get('/healthz', async (c) => {
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('db timeout')), 2_000)),
    ]);
    return c.json({ ok: true, db: true });
  } catch (err) {
    log.error('healthz.db', err);
    return c.json({ ok: false, db: false }, 503);
  }
});

/*
 * Public, unauthenticated, and required to ship: the paywall links to both, and
 * a 404 there is an App Store rejection. Registered at the top so no auth or
 * rate-limit middleware can ever end up in front of them.
 */
app.route('/', legal);

/*
 * Middleware must be registered on `app` BEFORE the matching `route()`.
 *
 * Hono dispatches in registration order, so `auth.use('*', …)` chained onto the
 * sub-app lands after the handler that routes/auth.ts already declared, and
 * never runs. It reads like it works and silently does nothing — which left the
 * one unauthenticated endpoint in the service with no limit at all.
 */
/*
 * The credential paths get their OWN, much tighter buckets, registered before
 * the catch-all so they win.
 *
 * These are load-bearing, not hygiene: there is no password reset, so an
 * attacker who brute-forces an account takes it permanently and the owner has
 * no recovery. The per-account lockout in routes/auth.ts is the other half.
 *
 * `dbRateLimit`, not `rateLimit`: these three are the buckets that must survive
 * horizontal scaling. The in-process Map used to be here too, and on Vercel that
 * meant each warm lambda handed out a fresh set of attempts — a limit the
 * platform silently multiplied by however many instances it felt like starting.
 * The others below stay in-process on purpose; see middleware/rateLimit.ts.
 */
app.use('/v1/auth/login', dbRateLimit({ scope: 'login', capacity: 8, refillPerSec: 0.05, by: 'ip' }));
app.use('/v1/auth/signup', dbRateLimit({ scope: 'signup', capacity: 5, refillPerSec: 0.01, by: 'ip' }));
/*
 * `/otp` is the only endpoint here that spends real money and can be aimed at a
 * third party — every call is an email, billed by the provider and delivered to
 * an address the caller chose rather than one that belongs to them. So it gets
 * the tightest bucket of the three: 4 to start, refilling at one every ~50s.
 *
 * This is the IP half. The other half is the per-address cooldown in lib/otp.ts,
 * and both are needed for different attacks: the bucket stops one host mailing a
 * thousand different people, the cooldown stops a thousand hosts mailing one.
 */
app.use('/v1/auth/otp', dbRateLimit({ scope: 'otp', capacity: 4, refillPerSec: 0.02, by: 'ip' }));
app.use('/v1/auth/*', dbRateLimit({ scope: 'auth', capacity: 20, refillPerSec: 0.2, by: 'ip' }));
app.route('/v1/auth', auth);


/*
 * Webhooks are authenticated by SIGNATURE, not by JWT — RevenueCat has no token
 * — so this must stay outside every `requireAuth` prefix. Rate limited by IP all
 * the same: the signature check is cheap but the endpoint is public, and a burst
 * of forged POSTs should cost an attacker something.
 */
app.use('/v1/webhooks/*', rateLimit({ capacity: 60, refillPerSec: 1, by: 'ip' }));
app.route('/v1/webhooks', webhooks);

/*
 * Refuse an oversized body BEFORE reading it.
 *
 * `routes/ai.ts` caps images with zod — but zod runs after `c.req.json()` has
 * already buffered and parsed the whole thing. Three 4MB base64 images is ~12MB
 * of JSON, and V8 strings are UTF-16, so that is ~24MB resident before a single
 * validation rule has an opinion. On a 512MB function ten of those is an OOM,
 * and one free account can send them.
 *
 * 14MB, not 12: base64 plus JSON escaping plus the rest of the envelope. This is
 * a backstop against a body nobody should be sending, not the real limit — the
 * per-image cap in ai.ts still is.
 *
 * **This used to read `content-length` and nothing else, which a client can
 * simply not send.** A chunked request declared no length, `Number(undefined ??
 * 0)` came out 0, the guard passed, and the 24MB it exists to prevent was
 * buffered anyway — a check that only stops the honest caller. Hono's own
 * `bodyLimit` counts bytes off the stream as they arrive and aborts mid-read, so
 * there is nothing left to lie about. Stock middleware rather than a hand-rolled
 * reader: this is a hostile-input path and the shipped one has had more eyes.
 */
const MAX_BODY_BYTES = 14 * 1024 * 1024;
app.use(
  '/v1/ai/*',
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    // Thrown, not returned: `onError` wants a Response, and building one here
    // would be the one 413 in the service that skips the uniform envelope below.
    onError: () => {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'That image is too large', false);
    },
  }),
);
/*
 * Order matters: auth → limit → idempotency.
 *
 * `idempotent` keys on the user id, so it must come after `requireAuth`. It must
 * also come after the rate limiter, or a replayed key would consume a token from
 * a bucket the original request already paid into.
 */
app.use(
  '/v1/ai/*',
  requireAuth,
  rateLimit({ capacity: 10, refillPerSec: 0.17, by: 'user' }),
  idempotent,
);
app.route('/v1/ai', ai);

app.use('/v1/user/*', requireAuth, rateLimit({ capacity: 30, refillPerSec: 1, by: 'user' }));
app.route('/v1/user', user);

/** Uniform envelope. The client branches on `code`, never on the message. */
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { error: { code: err.code, message: err.message, retryable: err.retryable } },
      err.status as 400,
    );
  }
  log.error('unhandled', err, { path: c.req.path });
  return c.json(
    { error: { code: 'INTERNAL', message: 'Something went wrong', retryable: true } },
    500,
  );
});

app.notFound((c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'No such route', retryable: false } }, 404),
);
