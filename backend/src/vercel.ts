/**
 * The Vercel entrypoint. `src/index.ts` is still the entrypoint everywhere else.
 *
 * The adapter is `@hono/node-server/vercel`, NOT `hono/vercel`. That is not a
 * style choice: `hono/vercel` is the Web-standard handler, which on Vercel means
 * the Edge runtime, and the Edge runtime has no TCP sockets. mysql2 opens a raw
 * TCP connection to Aiven, so on Edge this service cannot reach its own database.
 * `@hono/node-server` was already a dependency — nothing new is installed.
 *
 * What `src/index.ts` does that this deliberately cannot:
 *
 *   - Query the DB before serving and exit(1) if unreachable. There is no "before
 *     serving" here; a bad DATABASE_URL surfaces as 500s on live traffic instead
 *     of a failed deploy.
 *   - Drain in-flight requests on SIGTERM. Serverless has no SIGTERM. This is why
 *     `maxDuration` in vercel.json must stay ABOVE the 45s AbortSignal.timeout in
 *     ai/gateway.ts — the gateway's own abort is the only thing left that lets
 *     charged() run its refund. Invert those two numbers and a slow Gemini call
 *     bills the user a credit for nothing.
 *
 * Reached via the catch-all rewrite in vercel.json. Vercel preserves the original
 * request URL through a rewrite into a function, so Hono still sees `/v1/ai/...`
 * and needs no basePath().
 */
import { handle } from '@hono/node-server/vercel';

import { app } from './app.ts';

export default handle(app);
