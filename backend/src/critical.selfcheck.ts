/**
 * The four critical fixes, asserted.
 *
 *   cd backend && node --env-file=.env --import tsx src/critical.selfcheck.ts
 *
 * Pure: no database, no network. Every behaviour here was extracted into a
 * function specifically so it could be tested without either — the alternative
 * is a comment claiming the branch is right, which is what each of these four
 * bugs already had.
 *
 * C2 is not here. Its failure mode is "a row written by a doomed attempt blocks
 * the retry", which is a sequence against a real UNIQUE key and has nothing left
 * to assert once mocked away. It gets a database test of its own —
 * `webhooks.selfcheck.ts`, same pattern as `auth.selfcheck.ts`.
 */
import assert from 'node:assert/strict';

import { signAccess, verifyAccess } from './lib/jwt.ts';
import { shouldPersist, type Entitlement } from './lib/revenuecat.ts';
import { LOCKOUT_MS, MAX_FAILED_LOGINS, nextFailureState } from './routes/auth.ts';

// ── C1 · an unverified entitlement must never be persisted ───────────────────
{
  const ent = (isPro: boolean, verified: boolean): Entitlement => ({
    isPro,
    expiresAt: null,
    verified,
  });

  // The bug: RevenueCat 500s / times out / 429s → checkEntitlement fails closed
  // with {isPro:false, verified:false} → the old code wrote is_pro = 0, and
  // requireAuth reads is_pro off the row on every request, so a paying
  // subscriber hit the paywall within milliseconds and stayed there.
  assert.equal(
    shouldPersist(ent(false, false), true),
    false,
    'C1: a network/5xx failure must NOT overwrite a real entitlement',
  );

  // 404 from RevenueCat is knowledge, not absence of it: "never purchased".
  assert.equal(
    shouldPersist(ent(false, true), true),
    true,
    'C1: a verified "not entitled" IS written — that is how a lapse takes effect',
  );

  assert.equal(
    shouldPersist(ent(true, true), true),
    true,
    'C1: a verified entitlement is written',
  );

  // Mock mode has no secret key, so `claimedPro` is the only signal there is.
  // Refusing to write would break every preview build.
  assert.equal(
    shouldPersist(ent(true, false), false),
    true,
    'C1: mock mode still writes — verified is always false without a key',
  );
}

// ── C3 · a device token is distinguishable from an account token ─────────────
{
  const device = await signAccess({ sub: 'u1', pro: false, ep: 0, dev: true });
  const account = await signAccess({ sub: 'u1', pro: false, ep: 0 });

  assert.equal((await verifyAccess(device.token)).dev, true, 'C3: dev survives a round trip');
  assert.equal(
    (await verifyAccess(account.token)).dev,
    false,
    'C3: an account token is not a device token',
  );

  // Deploy-day safety. Tokens already in the field carry no `dev` claim at all,
  // and they were minted for real sessions — reading absent as `true` would lock
  // every existing user out of sign-out and account deletion on the deploy.
  const legacy = await signAccess({ sub: 'u1', pro: false, ep: 0 });
  const payload = JSON.parse(Buffer.from(legacy.token.split('.')[1]!, 'base64url').toString());
  assert.equal('dev' in payload, false, 'C3: an account token omits the claim entirely');
  assert.equal((await verifyAccess(legacy.token)).dev, false, 'C3: absent means account');

  // The whole point: the epoch bump from /logout is only a revocation if a
  // device token cannot mint its way back into the account. That is enforced by
  // `username: null` on the response and `requireAccount` on the two
  // account-mutating routes; both are integration-shaped, so what is asserted
  // here is the claim they branch on.
}

// ── C4 · an expired lockout resets the counter ───────────────────────────────
{
  const now = 1_000_000;

  // The attack: 10 wrong guesses, wait out the lock, then ONE guess every 15
  // minutes holds the account shut for ever. With no password reset, the owner
  // has no recovery at all.
  const afterExpiry = nextFailureState(
    { failed_logins: MAX_FAILED_LOGINS, locked_until: now - 1 },
    now,
  );
  assert.equal(afterExpiry.failed, 1, 'C4: an expired lock is a clean slate');
  assert.equal(afterExpiry.lockedUntil, null, 'C4: and does not immediately re-lock');

  // A live lock still accumulates — serving the sentence does not pause it.
  const duringLock = nextFailureState(
    { failed_logins: MAX_FAILED_LOGINS, locked_until: now + 60_000 },
    now,
  );
  assert.equal(duringLock.failed, MAX_FAILED_LOGINS + 1, 'C4: a live lock keeps counting');

  // Normal accumulation is unchanged.
  assert.deepEqual(
    nextFailureState({ failed_logins: 0, locked_until: null }, now),
    { failed: 1, lockedUntil: null },
    'C4: the first failure does not lock',
  );
  assert.deepEqual(
    nextFailureState({ failed_logins: MAX_FAILED_LOGINS - 1, locked_until: null }, now),
    { failed: MAX_FAILED_LOGINS, lockedUntil: now + LOCKOUT_MS },
    'C4: the tenth consecutive failure locks',
  );

  // Boundary: locked_until exactly now. Treated as expired, matching the route's
  // own `locked_until > now` gate — get these two out of step and there is a
  // millisecond in which the user is neither locked out nor forgiven.
  assert.equal(
    nextFailureState({ failed_logins: 12, locked_until: now }, now).failed,
    1,
    'C4: locked_until == now is expired, same as the route gate',
  );
}

console.log('critical.selfcheck: ok');
