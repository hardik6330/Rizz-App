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
app.use('/v1/auth/*', rateLimit({ capacity: 20, refillPerSec: 0.2, by: 'ip' }));
app.route('/v1/auth', auth);

app.route('/v1/config', config);

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
