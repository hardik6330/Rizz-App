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
 * ## Why this is hand-rolled instead of an adapter
 *
 * Both published adapters fail here, in opposite directions, and both fail as a
 * 60s `FUNCTION_INVOCATION_TIMEOUT` with no error logged — which the client sees
 * as a total outage, so `callApi` throws and all four engines silently serve mock
 * data. "The AI ignores my screenshot" was this, for every POST, in production.
 *
 *   - `@hono/node-server/vercel` gets the shape right but the body wrong: it
 *     builds the request with `Readable.toWeb(incoming)`, and Vercel's launcher
 *     has already drained that stream. The reader never yields, so
 *     `await c.req.json()` never settles. GETs were fine; every POST hung.
 *   - `hono/vercel` is `(req) => app.fetch(req)`, which needs Vercel to invoke the
 *     function with a web `Request`. It does not — it passes Node's
 *     `(req, res)`. `app.fetch` receives an `IncomingMessage`, nothing is ever
 *     written to `res`, and now even `GET /` hangs. Strictly worse.
 *
 * So: Node signature, and read the body from wherever the launcher actually left
 * it. `bodyOf()` is the whole fix and its `complete` guard is the load-bearing
 * line — never await `end` on a stream that has already ended.
 *
 * Keep the default export a single function. Named `GET`/`POST` exports are the
 * Next.js App Router convention and are not detected by a plain Vercel function,
 * so a file exporting only those has no handler at all.
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
import type { IncomingMessage, ServerResponse } from 'node:http';

import { app } from './app.ts';

/** Vercel's launcher may hand the body over parsed, raw, or not at all. */
type VercelRequest = IncomingMessage & { body?: unknown };

/**
 * The body, however the platform chose to deliver it.
 *
 * `req.body` is what the launcher parsed: an object for `application/json`, a
 * string for text, a Buffer otherwise. Only when it is absent is the stream still
 * worth reading — and only if it has not already ended, because awaiting `end` on
 * a spent stream is precisely the hang this file exists to avoid.
 */
export async function bodyOf(req: VercelRequest): Promise<Uint8Array | string | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const parsed = req.body;
  if (parsed !== undefined && parsed !== null) {
    if (typeof parsed === 'string') return parsed;
    if (Buffer.isBuffer(parsed)) return new Uint8Array(parsed);
    return JSON.stringify(parsed);
  }

  if (req.readableEnded || req.complete) return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? new Uint8Array(Buffer.concat(chunks)) : undefined;
}

export default async function handler(req: VercelRequest, res: ServerResponse): Promise<void> {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https';
  const url = `${proto}://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key.startsWith(':')) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(key, one);
  }

  const body = await bodyOf(req);
  // A re-serialized body rarely matches the original length, and a wrong
  // content-length makes `Request` truncate or reject it.
  if (body !== undefined) headers.delete('content-length');

  const response = await app.fetch(new Request(url, { method: req.method, headers, body }));

  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
