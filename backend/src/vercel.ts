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
 * The adapter is `hono/vercel`, NOT `@hono/node-server/vercel`.
 *
 * The node-server adapter builds the request with `Readable.toWeb(incoming)`, and
 * Vercel's launcher has ALREADY drained that stream into `req.body`. The reader
 * therefore never yields, `await c.req.json()` never settles, and every POST in
 * the service hung until Vercel killed the function at maxDuration — logged as a
 * runtime timeout with no error, while GETs were fine. Client-side that looks
 * exactly like an outage: `callApi` throws and all four engines serve mock data.
 *
 * `hono/vercel` is `(req) => app.fetch(req)` — Vercel's Node runtime accepts a
 * Web-standard handler and hands it a real `Request`, body included. Web-shaped
 * is NOT Edge-shaped: the runtime is still Node unless something declares
 * otherwise, so mysql2 keeps its raw TCP socket to Aiven. Do not add
 * `export const runtime = 'edge'` — that has no sockets and the DB dies.
 *
 * One `export default` too — named `GET`/`POST`/`PUT` exports are the Next.js App
 * Router convention and are not detected by a plain Vercel function, so a file
 * exporting only those has no handler at all.
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
import { handle } from 'hono/vercel';

import { app } from './app.ts';

export default handle(app);
