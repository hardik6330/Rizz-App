/**
 * Exercises `claimInstall` against a real database, on synthetic rows.
 *
 *   cd backend && node --env-file=.env --import tsx src/routes/auth.selfcheck.ts
 *
 * Unlike the other selfchecks in this service this one is NOT pure — the whole
 * behaviour under test is three ordered statements against a UNIQUE, NOT NULL
 * column, and there is nothing left to assert once you mock that away. What
 * breaks if this is wrong is a user's credits and a silent sign-out, so it is
 * worth a real connection.
 *
 * Refuses to run against production, and deletes everything it wrote.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { db, pool } from '../db/client.ts';
import { env } from '../env.ts';
import { anonymousGc, claimInstall } from './auth.ts';

if (env.NODE_ENV === 'production') {
  throw new Error('refusing to write synthetic rows to a production database');
}

const DEVICE = randomUUID();
const anonId = randomUUID();
const otherAccountId = randomUUID();
const targetId = randomUUID();
/** H-4: an anonymous row that owns a subscription, and the person who displaces it. */
const subscriberId = randomUUID();
const newcomerId = randomUUID();
const written = [anonId, otherAccountId, targetId, subscriberId, newcomerId];
/** Seeded on `targetId` so `/otp` has a real name to clash against. */
const TAKEN_NAME = `taken_${randomUUID().slice(0, 8)}`;

async function seed(
  id: string,
  installId: string,
  email: string | null,
  rcAppUserId: string | null = null,
  /** Null for the anonymous rows — `uq_users_username` allows repeated NULLs. */
  username: string | null = null,
): Promise<void> {
  const now = Date.now();
  await db.execute(sql`
    INSERT INTO users (id, install_id, platform, email, username, rc_app_user_id, analysis_count, created_at, updated_at)
    VALUES (${id}, ${installId}, 'android', ${email}, ${username}, ${rcAppUserId}, 2, ${now}, ${now})
  `);
}

async function installOf(id: string): Promise<string | undefined> {
  const rows = await db.execute(sql`SELECT install_id FROM users WHERE id = ${id} LIMIT 1`);
  return (rows as unknown as [Array<{ install_id: string }>])[0]?.[0]?.install_id;
}

try {
  // ── 1. The device's row is anonymous: it is deleted and the id handed over ──
  await seed(anonId, DEVICE, null);
  await seed(targetId, randomUUID(), 'target@example.test', null, TAKEN_NAME);
  await claimInstall(targetId, DEVICE, Date.now());

  assert.equal(await installOf(targetId), DEVICE, 'the account now owns the device');
  assert.equal(await installOf(anonId), undefined, 'the unreachable anonymous row is gone');

  // ── 2. Idempotent: logging in again on the same device is a no-op ───────────
  await claimInstall(targetId, DEVICE, Date.now());
  assert.equal(await installOf(targetId), DEVICE, 'claiming an id we already hold is safe');

  // ── 3. The device's row is a REAL account: it is re-homed, never deleted ────
  //
  // Two people sharing one phone. Without the second UPDATE in claimInstall this
  // is an ER_DUP_ENTRY against uq_users_install — a 500 on a valid login.
  await seed(otherAccountId, randomUUID(), 'other@example.test');
  await claimInstall(otherAccountId, DEVICE, Date.now());

  assert.equal(await installOf(otherAccountId), DEVICE, 'the newest login owns the device');
  const rehomed = await installOf(targetId);
  assert.ok(rehomed, 'the displaced account still EXISTS — it has an email to log back in with');
  assert.notEqual(rehomed, DEVICE, 'and no longer owns the device');

  // ── 4. H-4 · an anonymous row holding a SUBSCRIPTION is re-homed, not deleted
  //
  // Someone subscribes before signing up: their entitlement sits on a row with
  // no email. When a second person logs in on that phone, step 1 used to delete
  // it — and RevenueCat then kept billing a card for a user that no longer
  // existed, every renewal landing as `rc.webhook.unknown_user`, entitling
  // nobody. `rc_app_user_id IS NULL` in the DELETE is what keeps it reachable.
  const DEVICE2 = randomUUID();
  await seed(subscriberId, DEVICE2, null, `rc-${subscriberId}`);
  await seed(newcomerId, randomUUID(), 'newcomer@example.test');
  await claimInstall(newcomerId, DEVICE2, Date.now());

  assert.equal(await installOf(newcomerId), DEVICE2, 'the new account owns the device');
  const survivor = await installOf(subscriberId);
  assert.ok(survivor, 'H-4: the anonymous SUBSCRIBER row still exists');
  assert.notEqual(survivor, DEVICE2, 'H-4: re-homed rather than deleted');

  // And the webhook can still find it, which is the whole point of keeping it.
  const found = await db.execute(sql`
    SELECT id FROM users WHERE rc_app_user_id = ${`rc-${subscriberId}`} LIMIT 1
  `);
  assert.equal(
    (found as unknown as [Array<{ id: string }>])[0]?.[0]?.id,
    subscriberId,
    'H-4: the subscription is still resolvable by rc_app_user_id',
  );

  // ── 5. The account-existence answers ──────────────────────────────────────
  //
  // `/otp` and `/login` used to answer identically whether or not an address had
  // an account, which is why a signup into a taken address produced "check your
  // email" and no email. Five codes now say which case it is, and the CLIENT
  // branches on them — account.tsx moves the user to the other tab on
  // EMAIL_TAKEN / NO_ACCOUNT, and back to the details step on USERNAME_TAKEN —
  // so a rename here is a silently broken screen.
  //
  // Through the full `app`, not the `auth` router: the codes are written by
  // `onError`, which only exists on the app. Under the IP buckets too (otp 4,
  // login 8), so this stays at three otp calls and two login.
  const { app } = await import('../app.ts');
  const post = async (path: string, body: unknown) => {
    const res = await app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { error?: { code: string } };
    return { status: res.status, code: json.error?.code };
  };

  const taken = 'target@example.test';
  const unknown = `nobody-${randomUUID()}@example.test`;

  assert.deepEqual(
    await post('/v1/auth/otp', { email: taken, purpose: 'signup' }),
    { status: 409, code: 'EMAIL_TAKEN' },
    'signup code for an address that already has an account',
  );
  assert.deepEqual(
    await post('/v1/auth/otp', { email: unknown, purpose: 'login' }),
    { status: 404, code: 'NO_ACCOUNT' },
    'recovery code for an address with no account',
  );
  /*
   * The username pre-check. A FRESH address on purpose: it has to get past the
   * email branch above to reach the username one, and asserting it with a taken
   * address would pass for the wrong reason.
   *
   * This is the case the pre-check exists for. Without it the clash came from
   * the INSERT inside `/signup` — after the code was mailed, read and typed —
   * so the user was told to pick another name at the one moment their code had
   * just been burnt.
   */
  assert.deepEqual(
    await post('/v1/auth/otp', {
      email: `fresh-${randomUUID()}@example.test`,
      purpose: 'signup',
      username: TAKEN_NAME,
    }),
    { status: 409, code: 'USERNAME_TAKEN' },
    'signup code for a username that already exists',
  );
  assert.deepEqual(
    await post('/v1/auth/login', { email: unknown, password: 'whatever-long-enough' }),
    { status: 404, code: 'NO_ACCOUNT' },
    'login with an unknown email',
  );
  // The seeded row has a NULL password_hash, so `verifyPassword` rejects — which
  // is the wrong-password path, and it must not leak back into NO_ACCOUNT.
  assert.deepEqual(
    await post('/v1/auth/login', { email: taken, password: 'definitely-not-it' }),
    { status: 401, code: 'WRONG_PASSWORD' },
    'login with the wrong password',
  );

  /*
   * ── The anonymous GC ───────────────────────────────────────────────────────
   *
   * Four stale rows, one of which is genuinely dead. The other three are the
   * ways this DELETE could eat something a user still owns, so each column of
   * the predicate gets exactly one row that depends on it.
   */
  const stale = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const gc = { dead: randomUUID(), used: randomUUID(), account: randomUUID(), sub: randomUUID() };
  written.push(...Object.values(gc));
  const seedStale = (id: string, email: string | null, rc: string | null, count: number) =>
    db.execute(sql`
      INSERT INTO users (id, install_id, platform, email, rc_app_user_id, analysis_count, created_at, updated_at)
      VALUES (${id}, ${randomUUID()}, 'android', ${email}, ${rc}, ${count}, ${stale}, ${stale})
    `);
  await seedStale(gc.dead, null, null, 0);
  await seedStale(gc.used, null, null, 2);
  await seedStale(gc.account, `gc-${randomUUID()}@example.test`, null, 0);
  await seedStale(gc.sub, null, `rc_${randomUUID()}`, 0);

  await db.execute(anonymousGc(Date.now()));
  const alive = async (id: string) => (await installOf(id)) != null;
  assert.equal(await alive(gc.dead), false, 'the abandoned anonymous row is collected');
  assert.equal(await alive(gc.used), true, 'a row that spent credits is kept');
  assert.equal(await alive(gc.account), true, 'a row with an email is kept');
  assert.equal(await alive(gc.sub), true, 'a row with a subscription is kept');

  // Fresh rows are never in range, whatever else is true of them.
  await db.execute(sql`UPDATE users SET updated_at = ${Date.now()} WHERE id = ${gc.used}`);
  await db.execute(sql`UPDATE users SET analysis_count = 0 WHERE id = ${gc.used}`);
  await db.execute(anonymousGc(Date.now()));
  assert.equal(await alive(gc.used), true, 'a row touched today is out of range');

  console.log('auth.selfcheck: ok');
} finally {
  // One statement per id: a parameterised `IN` would bind the whole list as a
  // single string.
  for (const id of written) await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
  await pool.end();
}
