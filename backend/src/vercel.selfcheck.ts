/**
 * Guards the Vercel entrypoint's body handling.
 *
 * Two published adapters shipped a 60s hang on every POST in production, logged
 * as a bare FUNCTION_INVOCATION_TIMEOUT, which the app renders as mock data. The
 * expensive part was that nothing failed locally — `src/index.ts` uses a real
 * Node server and never exercises this path. So exercise it here.
 *
 *   cd backend && node --env-file=.env --import tsx src/vercel.selfcheck.ts
 *
 * No network and no database: the assertions stop at a Zod rejection, which is
 * reached before any query. It needs --env-file only because importing the app
 * validates env at load.
 */
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import handler, { bodyOf } from './vercel.ts';

type Fake = Parameters<typeof bodyOf>[0];

function fakeReq(props: Record<string, unknown>, stream?: Readable): Fake {
  const base = stream ?? Readable.from([]);
  // `readableEnded` is a getter on Readable, so Object.assign throws on it.
  const { readableEnded, ...rest } = props;
  if (readableEnded !== undefined) {
    Object.defineProperty(base, 'readableEnded', { value: readableEnded, configurable: true });
  }
  return Object.assign(base, { headers: { host: 'x.test' }, complete: true, ...rest }) as Fake;
}

// ── bodyOf: every form the launcher might use ────────────────────────────────
assert.equal(await bodyOf(fakeReq({ method: 'GET', body: { a: 1 } })), undefined, 'GET has no body');
assert.equal(await bodyOf(fakeReq({ method: 'HEAD' })), undefined, 'HEAD has no body');

assert.equal(
  await bodyOf(fakeReq({ method: 'POST', body: { platform: 'android' } })),
  '{"platform":"android"}',
  'a pre-parsed JSON object is re-serialized',
);
assert.equal(await bodyOf(fakeReq({ method: 'POST', body: 'raw text' })), 'raw text', 'a string passes through');
assert.deepEqual(
  await bodyOf(fakeReq({ method: 'POST', body: Buffer.from('bytes') })),
  new Uint8Array(Buffer.from('bytes')),
  'a Buffer becomes bytes',
);

// THE regression. A spent stream with no parsed body must resolve to undefined,
// not wait for an 'end' that already fired. If this ever hangs, every POST in
// production hangs with it — that is the whole bug, and it times out silently.
const spent = await Promise.race([
  bodyOf(fakeReq({ method: 'POST', body: undefined, complete: true, readableEnded: true })),
  new Promise((_, reject) => setTimeout(() => reject(new Error('bodyOf HUNG on a spent stream')), 1000)),
]);
assert.equal(spent, undefined, 'spent stream yields no body');

// Unspent stream: still the right thing to read.
assert.deepEqual(
  await bodyOf(
    fakeReq({ method: 'POST', body: undefined, complete: false }, Readable.from([Buffer.from('{"a":1}')])),
  ),
  new Uint8Array(Buffer.from('{"a":1}')),
  'an unread stream is drained',
);

// ── handler: end to end, through the real Hono app ──────────────────────────
async function invoke(req: Record<string, unknown>, stream?: Readable) {
  const chunks: Buffer[] = [];
  let statusCode = 0;
  const res = {
    statusCode: 0,
    setHeader() {},
    end(chunk?: Buffer) {
      if (chunk) chunks.push(chunk);
      statusCode = res.statusCode;
    },
  };
  await Promise.race([
    handler(fakeReq({ headers: { host: 'x.test' }, ...req }, stream), res as never),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`handler HUNG on ${req.method} ${req.url}`)), 3000)),
  ]);
  return { status: statusCode, body: Buffer.concat(chunks).toString('utf8') };
}

const health = await invoke({ method: 'GET', url: '/healthz' });
assert.equal(health.status, 200, 'GET /healthz responds');
assert.deepEqual(JSON.parse(health.body), { ok: true });

// A POST whose body the launcher pre-parsed. Zod rejects it, so no DB is touched
// — but reaching a 400 at all proves the body arrived and nothing hung.
const bad = await invoke({ method: 'POST', url: '/v1/auth/device', body: { platform: 'martian' } });
assert.equal(bad.status, 400, 'POST body reaches the handler');
assert.equal(JSON.parse(bad.body).error.code, 'BAD_REQUEST');

// A POST with no body at all. Used to hang; must be a clean 400.
const empty = await invoke({ method: 'POST', url: '/v1/auth/device', body: undefined, complete: true });
assert.equal(empty.status, 400, 'an empty POST fails fast instead of hanging');

console.log('vercel.selfcheck: ok');
process.exit(0);
