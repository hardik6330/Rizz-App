/**
 * The Vercel entrypoint. `src/index.ts` is still the entrypoint everywhere else.
 *
 * NOT loaded from source. `npm run build:vercel` bundles this file into
 * `dist/vercel.mjs` and `api/index.mjs` at the repo root re-exports that. The
 * indirection is not optional: every import in this codebase carries a `.ts`
 * extension, Vercel's Node builder transpiles TypeScript file-by-file WITHOUT
 * rewriting specifiers, and the result throws
 * `ERR_MODULE_NOT_FOUND … '/var/task/backend/src/ai/prompts.ts'` on the first
 * request. esbuild resolves all of it at build time instead.
 *
 * The adapter is `@hono/node-server/vercel`, NOT `hono/vercel`. mysql2 opens a
 * raw TCP socket to Aiven, so this has to be the Node runtime; `hono/vercel` is
 * the Web/Edge-shaped handler and Edge has no sockets. One `export default` too
 * — named `GET`/`POST`/`PUT` exports are the Next.js App Router convention and
 * are not detected by a plain Vercel function, so a file exporting only those
 * has no handler at all.
 *
 * What `src/index.ts` does that this deliberately cannot:
 *
 *   - Query the DB before serving and exit(1) if unreachable. There is no
 *     "before serving" here; a bad DATABASE_URL surfaces as 500s on live traffic
 *     instead of a failed deploy.
 *   - Drain in-flight requests on SIGTERM. Serverless has no SIGTERM. This is why
 *     `maxDuration` in vercel.json must stay ABOVE the 45s AbortSignal.timeout in
 *     ai/gateway.ts — the gateway's own abort is the only thing left that lets
 *     charged() run its refund. Invert those two numbers and a slow Gemini call
 *     bills the user a credit for nothing.
 *
 * Reached via the catch-all rewrite in vercel.json. Vercel preserves the original
 * request URL through a rewrite into a function, so Hono still sees `/v1/ai/…`
 * and needs no basePath().
 */
import { handle } from '@hono/node-server/vercel';

import { app } from './app.ts';

export default handle(app);
