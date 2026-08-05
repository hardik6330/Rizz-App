import { Hono } from 'hono';

import { assertSafetyRails } from './ai/prompts.ts';
import { ApiError } from './lib/errors.ts';
import { log } from './lib/logger.ts';
import { requireAuth } from './middleware/auth.ts';
import { rateLimit } from './middleware/rateLimit.ts';
import { ai } from './routes/ai.ts';
import { auth } from './routes/auth.ts';
import { config } from './routes/config.ts';
import { user } from './routes/user.ts';
import { webhooks } from './routes/webhooks.ts';

// Refuse to boot if the them-mode safety rails have gone missing. See prompts.ts.
assertSafetyRails();

export const app = new Hono();

app.get('/', (c) => c.text('Server is running!'));
app.get('/healthz', (c) => c.json({ ok: true }));

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
 * ⚠ In-process buckets are correct for ONE instance. On a serverless target
 * every warm lambda gets its own empty Map and this protection evaporates — see
 * the note in middleware/rateLimit.ts. Do not ship accounts to Vercel without
 * moving these to a shared store first.
 */
app.use('/v1/auth/login', rateLimit({ capacity: 8, refillPerSec: 0.05, by: 'ip' }));
app.use('/v1/auth/signup', rateLimit({ capacity: 5, refillPerSec: 0.01, by: 'ip' }));
app.use('/v1/auth/*', rateLimit({ capacity: 20, refillPerSec: 0.2, by: 'ip' }));
app.route('/v1/auth', auth);

app.route('/v1/config', config);

/*
 * Webhooks are authenticated by SIGNATURE, not by JWT — RevenueCat has no token
 * — so this must stay outside every `requireAuth` prefix. Rate limited by IP all
 * the same: the signature check is cheap but the endpoint is public, and a burst
 * of forged POSTs should cost an attacker something.
 */
app.use('/v1/webhooks/*', rateLimit({ capacity: 60, refillPerSec: 1, by: 'ip' }));
app.route('/v1/webhooks', webhooks);

app.use('/v1/ai/*', requireAuth, rateLimit({ capacity: 10, refillPerSec: 0.17, by: 'user' }));
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
