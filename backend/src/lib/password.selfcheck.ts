/**
 * Framework-free check for lib/password.ts.
 *
 *   node --import tsx src/lib/password.selfcheck.ts
 *
 * Every assertion here is a failure mode that is silent in production: a wrong
 * verify returns `false` and reads as "wrong password", which with no reset flow
 * is an account nobody can get back into.
 */
import assert from 'node:assert/strict';

import { DUMMY_HASH, hashPassword, verifyPassword } from './password.ts';

const PLAIN = 'correct horse battery staple';

const hash = await hashPassword(PLAIN);

assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$[\w+/=]+\$[\w+/=]+$/, 'hash format is scrypt$N$r$p$salt$key');
assert.ok(hash.length <= 255, 'hash must fit password_hash VARCHAR(255)');

assert.equal(await verifyPassword(PLAIN, hash), true, 'the right password verifies');
assert.equal(await verifyPassword('wrong', hash), false, 'the wrong password does not');
assert.equal(await verifyPassword(PLAIN + ' ', hash), false, 'trailing space is a different password');

// Salted: the same plaintext twice must not produce the same row.
assert.notEqual(await hashPassword(PLAIN), hash, 'each hash gets a fresh salt');

// NFKC: the same character composed two ways must be one password. iOS and
// Android keyboards do not agree, and without this a user is locked out on the
// other platform with no way back.
const composed = 'café';           // U+00E9
const decomposed = 'café';   // e + combining acute
assert.equal(
  await verifyPassword(decomposed, await hashPassword(composed)),
  true,
  'NFKC-equivalent passwords match',
);

// Malformed rows are a failed login, never a 500.
for (const bad of [null, '', 'garbage', 'scrypt$1$2$3', 'bcrypt$a$b$c$d$e']) {
  assert.equal(await verifyPassword(PLAIN, bad), false, `malformed stored hash rejected: ${bad}`);
}

// The dummy exists so an unknown email costs the same time as a known one.
assert.equal(await verifyPassword(PLAIN, await DUMMY_HASH), false, 'dummy hash never verifies');

console.log('password.selfcheck: ok');
