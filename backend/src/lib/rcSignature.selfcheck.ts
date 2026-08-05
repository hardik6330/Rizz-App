/**
 * Framework-free check for lib/rcSignature.ts.
 *
 *   node --import tsx src/lib/rcSignature.selfcheck.ts
 *
 * A wrong verify here is silent in both directions and both are expensive: too
 * strict and every renewal webhook 401s until RevenueCat gives up after five
 * retries, so subscriptions quietly stop renewing on our side; too loose and
 * anyone who finds the URL can POST themselves a free subscription.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { verifyWebhook } from './rcSignature.ts';

const SECRET = 'whsec_test_secret';
const BODY = '{"event":{"id":"abc","type":"RENEWAL"}}';
const NOW = 1_700_000_000_000;
const T = String(Math.floor(NOW / 1000));

const sign = (t: string, body: string, secret = SECRET) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

const hmac = (signature: string, body = BODY, now = NOW) =>
  verifyWebhook(SECRET, body, { signature }, now);

assert.equal(hmac(sign(T, BODY)), true, 'a correct signature verifies');
assert.equal(hmac(sign(T, BODY), '{"event":{}}'), false, 'a tampered body does not');
assert.equal(hmac(sign(T, BODY, 'other')), false, 'the wrong secret does not');
assert.equal(hmac(`t=${T},v1=deadbeef`), false, 'a garbage mac does not');

// The signature covers "<t>.<body>", so a mac cannot be lifted onto another t.
const lifted = sign(T, BODY).replace(`t=${T}`, `t=${Number(T) - 1}`);
assert.equal(hmac(lifted), false, 't is part of the signed string');

// Replay window: a valid signature must not stay valid for ever.
assert.equal(hmac(sign(T, BODY), BODY, NOW + 4 * 60_000), true, 'inside the 5m window');
assert.equal(hmac(sign(T, BODY), BODY, NOW + 6 * 60_000), false, 'outside it');
assert.equal(hmac(sign(T, BODY), BODY, NOW - 6 * 60_000), false, 'and outside it backwards');

// Malformed headers are a reject, never a throw.
for (const bad of ['', 'garbage', 't=abc,v1=def', `t=${T}`, `v1=x`]) {
  assert.equal(hmac(bad), false, `malformed header rejected: ${bad || '(empty)'}`);
}

// Static-header mode, with and without the Bearer prefix.
assert.equal(verifyWebhook(SECRET, BODY, { authorization: SECRET }), true, 'static header');
assert.equal(verifyWebhook(SECRET, BODY, { authorization: `Bearer ${SECRET}` }), true, 'Bearer form');
assert.equal(verifyWebhook(SECRET, BODY, { authorization: 'nope' }), false, 'wrong static header');
assert.equal(verifyWebhook(SECRET, BODY, {}), false, 'no credential at all');

// An unset secret must never make everything valid.
assert.equal(verifyWebhook('', BODY, { authorization: '' }), false, 'empty secret rejects');
assert.equal(verifyWebhook('', BODY, { signature: sign(T, BODY, '') }), false, 'empty secret rejects hmac');

console.log('rcSignature.selfcheck: ok');
