/**
 * C2 — a failed webhook must leave its event re-deliverable.
 *
 *   cd backend && node --env-file=.env --import tsx src/routes/webhooks.selfcheck.ts
 *
 * Not pure, for the same reason as `auth.selfcheck.ts`: the behaviour under test
 * IS the interaction between `INSERT IGNORE` and a UNIQUE primary key, and there
 * is nothing left to assert once that is mocked away. What breaks if this is
 * wrong is a subscription — a dropped CANCELLATION bills us for ever, a dropped
 * RENEWAL cuts off someone who paid — so it is worth a real connection.
 *
 * Refuses to run against production, and deletes everything it wrote.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { db, pool } from '../db/client.ts';
import { env } from '../env.ts';

if (env.NODE_ENV === 'production') {
  throw new Error('refusing to write synthetic rows to a production database');
}

const EVENT = `selfcheck-${randomUUID()}`;

/** The exact statement the route uses to claim an event. */
async function claim(eventId: string): Promise<boolean> {
  const [result] = await db.execute(sql`
    INSERT IGNORE INTO rc_events (event_id, user_id, type, created_at)
    VALUES (${eventId}, ${randomUUID()}, 'SELFCHECK', ${Date.now()})
  `);
  return (result as { affectedRows: number }).affectedRows > 0;
}

/** The release the catch block performs when the work throws. */
async function release(eventId: string): Promise<void> {
  await db.execute(sql`DELETE FROM rc_events WHERE event_id = ${eventId}`);
}

try {
  // ── 1. First delivery claims the event ─────────────────────────────────────
  assert.equal(await claim(EVENT), true, 'a fresh event is claimed');

  // ── 2. Re-delivery is a no-op. This is the idempotency the table exists for
  //       — and, before the fix, also the bug: the claim was written BEFORE the
  //       work, so an attempt that then failed left this row behind and every
  //       RevenueCat retry was swallowed as a duplicate. Five retries over ~3
  //       hours, then the event is abandoned. Silently.
  assert.equal(await claim(EVENT), false, 'a duplicate delivery is rejected');

  // ── 3. Releasing the claim is what makes the retry mean something ──────────
  await release(EVENT);
  assert.equal(
    await claim(EVENT),
    true,
    'C2: after a release, RevenueCat\'s retry can do the work',
  );

  // ── 4. …and the released-then-redone event is STILL idempotent afterwards ──
  //       Releasing must not make the event permanently re-processable, or a
  //       renewal that succeeded on retry gets processed again on the next
  //       delivery.
  assert.equal(await claim(EVENT), false, 'C2: a re-claimed event is idempotent again');

  console.log('webhooks.selfcheck: ok');
} finally {
  await release(EVENT);
  await pool.end();
}
