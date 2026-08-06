/**
 * Locks `clientIp` to the hop the PLATFORM wrote, never the one the client sent.
 *
 *   cd backend && node --env-file=.env --import tsx src/middleware/rateLimit.selfcheck.ts
 *
 * This used to read `xff.split(',')[0]` — the leftmost entry, which is entirely
 * client-controlled. An attacker sent a random value per request and got a fresh
 * full bucket every time: a total bypass of every IP limit in the service,
 * including the one in front of `/v1/auth/login` on a product with no password
 * reset. The bug is a one-character index change away in either direction and
 * nothing observable breaks when it is wrong, which is exactly why it is
 * asserted rather than reviewed.
 *
 * No DB and no network: clientIp is pure. `--env-file` is needed only because
 * importing the module loads db/client.ts, which validates env at import.
 */
import assert from 'node:assert/strict';

import { clientIp } from './rateLimit.ts';

/** Minimal stand-in for the `Headers` shape clientIp reads. */
function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

// One proxy — Render and Vercel both append exactly one hop.
assert.equal(clientIp(headers({ 'x-forwarded-for': '203.0.113.9' })), '203.0.113.9');

// THE BUG. Everything before the last comma is attacker-supplied.
assert.equal(
  clientIp(headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' })),
  '203.0.113.9',
  'takes the hop the proxy appended, never the value the client claimed',
);

// Spraying forged hops must not move the answer — this is the whole bypass.
const forged = Array.from({ length: 50 }, (_, i) => `10.0.0.${i}`).join(', ');
assert.equal(
  clientIp(headers({ 'x-forwarded-for': `${forged}, 203.0.113.9` })),
  '203.0.113.9',
  'a client cannot reach past the trusted hop no matter how many it sends',
);

// Whitespace and stray commas are normal in the wild and must not produce a
// distinct bucket key — '203.0.113.9' and ' 203.0.113.9' would be two buckets.
assert.equal(clientIp(headers({ 'x-forwarded-for': ' 1.2.3.4 ,  203.0.113.9 ,, ' })), '203.0.113.9');

// Fallbacks, in order, when there is no XFF at all.
assert.equal(clientIp(headers({ 'x-vercel-forwarded-for': '198.51.100.7' })), '198.51.100.7');
assert.equal(clientIp(headers({ 'x-real-ip': '198.51.100.8' })), '198.51.100.8');

// Never undefined: an undefined key would collapse every caller into one bucket
// named 'ip:undefined', which reads as a working limiter and is a global one.
assert.equal(clientIp(headers({})), 'unknown');
assert.equal(clientIp(headers({ 'x-forwarded-for': '' })), 'unknown');
assert.equal(clientIp(headers({ 'x-forwarded-for': ' , , ' })), 'unknown');

console.log('rateLimit.selfcheck: ok');
