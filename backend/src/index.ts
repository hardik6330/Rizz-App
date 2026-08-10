import { serve } from '@hono/node-server';

import { app } from './app.ts';
import { env } from './env.ts';
import { pool } from './db/client.ts';
import { log } from './lib/logger.ts';

/**
 * Where the database is, with the credentials stripped.
 *
 * `DATABASE_URL` contains a password, so it must never be logged whole — that is
 * how a connection string ends up in a log aggregator, or in a screenshot of a
 * terminal pasted into a chat. Host, port and database name are what you
 * actually need to answer "am I pointed at staging or prod?".
 */
function dbTarget(): string {
  try {
    const url = new URL(env.DATABASE_URL);
    return `${url.hostname}:${url.port || '3306'}${url.pathname}`;
  } catch {
    return 'unparseable';
  }
}

/**
 * Connect BEFORE serving, and refuse to start if the database is unreachable.
 *
 * mysql2's pool is lazy: it connects on first query, so without this the process
 * boots cleanly, `/healthz` returns ok, the platform marks the deploy healthy —
 * and then every real request 500s. Failing here instead means a bad
 * DATABASE_URL or an expired CA is caught at deploy time, and the platform
 * retries or rolls back rather than serving a broken instance. Same principle as
 * `env.ts` exiting on invalid config: fail loudly, never half-configured.
 */
try {
  const [rows] = await pool.query('SELECT VERSION() AS version');
  const { version } = (rows as [{ version: string }])[0];
  log.info('db.connected', {
    target: dbTarget(),
    version,
    // Verified TLS, not merely encrypted — see the comment in db/client.ts.
    tls: env.DATABASE_CA ? 'verified (custom CA)' : 'verified (system CAs)',
  });
} catch (err) {
  log.error('db.unreachable', err, { target: dbTarget() });
  process.exit(1);
}

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info('server.start', {
    url: `http://localhost:${info.port}`,
    port: info.port,
    env: env.NODE_ENV,
    // Loud, because entitlement is being taken on trust while this is false.
    revenueCat: env.REVENUECAT_SECRET_KEY ? 'verified' : 'MOCK (accepts client claim)',
  });
});

/**
 * Drain in-flight requests before exiting. A Gemini call takes 3-15s, so a hard
 * kill during a deploy would drop a request the user has already been charged
 * for — and the refund path never runs.
 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log.info('server.stop', { signal });
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  });
}
