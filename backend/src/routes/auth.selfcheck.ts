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
import { claimInstall } from './auth.ts';

if (env.NODE_ENV === 'production') {
  throw new Error('refusing to write synthetic rows to a production database');
}

const DEVICE = randomUUID();
const anonId = randomUUID();
const otherAccountId = randomUUID();
const targetId = randomUUID();
const written = [anonId, otherAccountId, targetId];

async function seed(id: string, installId: string, email: string | null): Promise<void> {
  const now = Date.now();
  await db.execute(sql`
    INSERT INTO users (id, install_id, platform, email, analysis_count, created_at, updated_at)
    VALUES (${id}, ${installId}, 'android', ${email}, 2, ${now}, ${now})
  `);
}

async function installOf(id: string): Promise<string | undefined> {
  const rows = await db.execute(sql`SELECT install_id FROM users WHERE id = ${id} LIMIT 1`);
  return (rows as unknown as [Array<{ install_id: string }>])[0]?.[0]?.install_id;
}

try {
  // ── 1. The device's row is anonymous: it is deleted and the id handed over ──
  await seed(anonId, DEVICE, null);
  await seed(targetId, randomUUID(), 'target@example.test');
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

  console.log('auth.selfcheck: ok');
} finally {
  await db.execute(sql`DELETE FROM users WHERE id IN (${written[0]}, ${written[1]}, ${written[2]})`);
  await pool.end();
}
