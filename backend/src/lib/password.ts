import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

import { Errors } from './errors.ts';

/**
 * Password hashing, on `node:crypto` and nothing else.
 *
 * scrypt is OWASP-listed, ships in the standard library, and needs no native
 * build step — which matters here because the deploy target is a plain Node
 * runtime and argon2/bcrypt would both drag a compiled dependency into it.
 *
 * N=2^15, r=8, p=2 is ~32MB and ~100ms per hash: expensive enough that an
 * offline crack of a leaked table is not casual, cheap enough that a login burst
 * does not exhaust a 512MB instance. Memory is per CONCURRENT hash, so raise N
 * only alongside the rate limits on /v1/auth/*.
 *
 * The parameters are stored inside the hash, so N can be raised later without
 * invalidating anything already written — `verify` reads them back off the row.
 *
 * Self-check: `node --import tsx src/lib/password.selfcheck.ts`
 */
// Hand-wrapped rather than promisify()'d: promisify picks the 3-argument
// overload and drops the options object, which is where N/r/p live.
function scryptAsync(
  plain: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const N = 32768;
const R = 8;
const P = 2;
const KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * scrypt needs 128 × N × r bytes — 32MB at these parameters — and Node's default
 * `maxmem` is exactly 32MB, so the call fails with
 * `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` without this. Raise it with N, or the first
 * thing that happens after tuning is that every login 500s.
 */
const MAXMEM = 64 * 1024 * 1024;

/**
 * Cap concurrent hashes, because the memory cost is per CONCURRENT hash.
 *
 * 32MB each on a 512MB instance means ~15 simultaneous logins exhaust the box.
 * The comment above says to raise N only alongside the rate limits on
 * /v1/auth/* — true, but those limits are per-IP and `/login` hashes even for an
 * unknown email (DUMMY_HASH, deliberately, so the response time is not an
 * account-existence oracle). So the cost is paid by every attempt, valid or not,
 * and one host behind enough IPs pays it as often as it likes.
 *
 * Rejecting is better than queueing: an unbounded queue converts a memory
 * problem into a latency problem and then into the same memory problem. Six is
 * ~192MB, which leaves the rest of the instance somewhere to live.
 *
 * ponytail: a per-instance counter, which is all this needs — it is protecting
 * one process's heap, and every process has its own.
 */
const MAX_CONCURRENT_HASHES = 6;
let hashing = 0;

async function withHashSlot<T>(run: () => Promise<T>): Promise<T> {
  // 429, so the client's existing retryable-error handling covers it and the
  // caller does not have to learn a new code.
  if (hashing >= MAX_CONCURRENT_HASHES) throw Errors.rateLimited();
  hashing += 1;
  try {
    return await run();
  } finally {
    hashing -= 1;
  }
}

/**
 * NFKC-normalise before hashing.
 *
 * "é" can be one code point or two, and iOS and Android keyboards do not always
 * agree on which. Without this, a password typed on one platform can fail to
 * verify on the other — and with no reset flow that is an unrecoverable account.
 */
function normalize(plain: string): string {
  return plain.normalize('NFKC');
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await withHashSlot(() =>
    scryptAsync(normalize(plain), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM }),
  );
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Constant-time compare against a stored hash.
 *
 * A malformed row is a failed login, not a 500 — that has not changed. What it
 * now DOES throw is a 429, when too many hashes are already in flight: refusing
 * the work is the whole point of the cap, and swallowing that into `false` would
 * turn an overload into a wrong-password message and lock people out of their
 * own accounts via the failed-login counter.
 */
export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, key] = parts as [string, string, string, string, string, string];

  const expected = Buffer.from(key, 'base64');
  if (expected.length === 0) return false;

  // Outside the try: a 429 must propagate, and everything inside is the
  // malformed-row case that must not.
  return withHashSlot(async () => {
    try {
      const actual = await scryptAsync(
        normalize(plain),
        Buffer.from(salt, 'base64'),
        expected.length,
        { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM },
      );
      // timingSafeEqual, never ===: a byte-by-byte compare leaks the hash prefix.
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  });
}

/**
 * A hash of nothing, to verify against when the email does not exist.
 *
 * Without it `/login` returns in ~1ms for an unknown email and ~100ms for a
 * known one, which is an account-existence oracle that no amount of careful
 * error copy can hide.
 *
 * LAZY, and that matters on serverless. It used to be built at module load, so
 * every cold start paid a full scrypt — ~100ms and a 32MB allocation — including
 * the cold starts that go on to serve `/healthz` or `/v1/config` and will never
 * verify a password. Now the cost lands on the first login an instance handles,
 * and is memoised for the rest of its life, which is exactly where it belongs.
 */
let dummy: Promise<string> | undefined;

export function dummyHash(): Promise<string> {
  return (dummy ??= hashPassword(randomBytes(32).toString('hex')));
}
