/**
 * The high-severity fixes, asserted.
 *
 *   cd backend && node --env-file=.env --import tsx src/high.selfcheck.ts
 *
 * Database-backed, because most of these ARE database behaviour — a column
 * width, a primary key, an INSERT IGNORE race. Mocking that away would leave
 * nothing worth asserting.
 *
 * The idempotency test mounts the real middleware on a throwaway Hono app rather
 * than calling `/v1/ai/*`, so it exercises the actual claim/replay/release code
 * without spending a Gemini call or a credit on every run.
 *
 * Refuses to run against production, and deletes everything it wrote.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { app } from './app.ts';
import { db, pool } from './db/client.ts';
import { env } from './env.ts';
import { dummyHash } from './lib/password.ts';
import { idempotent } from './middleware/idempotency.ts';
import { chargeCredit, refundCredit } from './middleware/credits.ts';

if (env.NODE_ENV === 'production') {
  throw new Error('refusing to write synthetic rows to a production database');
}

const USER = randomUUID();
const KEY = `selfcheck-${randomUUID()}`;

/** The ledger is fire-and-forget; give the un-awaited INSERT a tick to land. */
const settle = () => new Promise((r) => setTimeout(r, 300));

try {
  // ── H-3 · rc_events.user_id is wide enough for a RevenueCat anonymous id ────
  {
    const rows = await db.execute(sql`
      SELECT character_maximum_length AS len
        FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'rc_events' AND column_name = 'user_id'
    `);
    const len = (rows as unknown as [Array<{ len: number }>])[0]?.[0]?.len;
    assert.equal(len, 128, 'H-3: user_id must hold $RCAnonymousID:<32 hex> = 46 chars');

    // The value that used to throw ER_DATA_TOO_LONG and 500 the whole webhook,
    // five retries deep, until RevenueCat gave up on the event.
    const anonId = `$RCAnonymousID:${'a'.repeat(32)}`;
    const eventId = `selfcheck-${randomUUID()}`;
    await db.execute(sql`
      INSERT INTO rc_events (event_id, user_id, type, created_at)
      VALUES (${eventId}, ${anonId}, 'SELFCHECK', ${Date.now()})
    `);
    await db.execute(sql`DELETE FROM rc_events WHERE event_id = ${eventId}`);
  }

  // ── H-5 · daily_feed's composite PK exists, so INSERT IGNORE ignores ────────
  {
    const rows = await db.execute(sql`
      SELECT column_name AS n
        FROM information_schema.key_column_usage
       WHERE table_schema = DATABASE() AND table_name = 'daily_feed'
         AND constraint_name = 'PRIMARY'
       ORDER BY ordinal_position
    `);
    const cols = (rows as unknown as [Array<{ n: string }>])[0].map((r) => r.n);
    assert.deepEqual(
      cols,
      ['feed_date', 'version'],
      'H-5: without this PK, generateFeed inserts a duplicate batch per request',
    );
  }

  // ── H-2 · every credit movement leaves a ledger row ─────────────────────────
  {
    const now = Date.now();
    await db.execute(sql`
      INSERT INTO users (id, install_id, platform, analysis_count, created_at, updated_at)
      VALUES (${USER}, ${randomUUID()}, 'android', 0, ${now}, ${now})
    `);

    await chargeCredit(USER);
    await refundCredit(USER, 'generation_failed');
    await settle();

    const rows = await db.execute(sql`
      SELECT delta, reason FROM credit_events WHERE user_id = ${USER} ORDER BY id
    `);
    const events = (rows as unknown as [Array<{ delta: number; reason: string }>])[0];
    assert.deepEqual(
      events,
      [
        { delta: 1, reason: 'charge' },
        { delta: -1, reason: 'generation_failed' },
      ],
      'H-2: a charge and its refund are both recorded',
    );

    // The counter is still the balance — the ledger is evidence, not state.
    const bal = await db.execute(sql`SELECT analysis_count AS n FROM users WHERE id = ${USER}`);
    assert.equal(
      (bal as unknown as [Array<{ n: number }>])[0]?.[0]?.n,
      0,
      'H-2: charge then refund nets to zero',
    );

    // A refused charge is not a movement: burn the free allowance, then confirm
    // the rejection adds nothing to the ledger.
    await db.execute(sql`UPDATE users SET analysis_count = 3 WHERE id = ${USER}`);
    await assert.rejects(() => chargeCredit(USER), 'out of credits still throws');
    await settle();
    const after = await db.execute(sql`
      SELECT COUNT(*) AS n FROM credit_events WHERE user_id = ${USER}
    `);
    assert.equal(
      Number((after as unknown as [Array<{ n: number }>])[0]?.[0]?.n),
      2,
      'H-2: a refused charge writes no ledger row',
    );
  }

  // ── H-1 · a replayed Idempotency-Key does not re-run the work ───────────────
  {
    let calls = 0;
    const test = new Hono();
    test.use('*', async (c, next) => {
      c.set('user', { sub: USER, pro: false, ep: 0, dev: false });
      await next();
    });
    test.use('*', idempotent);
    test.post('/ok', (c) => c.json({ call: ++calls }));
    test.post('/boom', () => {
      calls += 1;
      throw new Error('engine exploded');
    });

    const post = (path: string, key?: string) =>
      test.request(path, {
        method: 'POST',
        headers: key ? { 'Idempotency-Key': key } : {},
      });

    // First call runs.
    const a = await post('/ok', KEY);
    assert.deepEqual(await a.json(), { call: 1 }, 'H-1: the first request runs');

    // Second call with the SAME key replays the stored body without re-running.
    // This is the whole feature: a retry after a network timeout used to charge
    // a second credit for one user action — a third of the free tier.
    const b = await post('/ok', KEY);
    assert.deepEqual(await b.json(), { call: 1 }, 'H-1: a replay returns the stored answer');
    assert.equal(calls, 1, 'H-1: and the handler did NOT run twice');

    // A different key is a different action.
    const c = await post('/ok', `${KEY}-other`);
    assert.deepEqual(await c.json(), { call: 2 }, 'H-1: a new key runs again');

    // No header at all → straight through, unchanged. The header is opt-in, so
    // every client already in the field keeps working.
    const d = await post('/ok');
    assert.deepEqual(await d.json(), { call: 3 }, 'H-1: no key means no interception');

    // A FAILED call must release its claim, or one bad minute would poison that
    // key for 24 hours and the genuine retry would never get through.
    //
    // The throw propagates up through `idempotent` (which is what lets its catch
    // release the claim) and is then turned into a 500 by Hono's error handler —
    // so this asserts a response, not a rejection.
    const failKey = `${KEY}-fail`;
    const failed = await post('/boom', failKey);
    assert.equal(failed.status, 500, 'H-1: the failure surfaces as a 500');
    const stored = await db.execute(sql`
      SELECT COUNT(*) AS n FROM idempotency WHERE id = ${`${USER}:${failKey}`}
    `);
    assert.equal(
      Number((stored as unknown as [Array<{ n: number }>])[0]?.[0]?.n),
      0,
      'H-1: a failure releases the claim so the retry can actually retry',
    );

    // Keys are scoped per user — without the prefix, one client's key would
    // return another client's analysis.
    const mine = await db.execute(sql`
      SELECT id FROM idempotency WHERE id = ${`${USER}:${KEY}`}
    `);
    assert.equal(
      (mine as unknown as [Array<{ id: string }>])[0].length,
      1,
      'H-1: the stored key is namespaced by user id',
    );
  }

  // ── H-6 · /healthz actually checks the database ─────────────────────────────
  {
    const res = await app.request('/healthz');
    assert.equal(res.status, 200, 'H-6: healthy while the DB is reachable');
    assert.deepEqual(
      await res.json(),
      { ok: true, db: true },
      'H-6: and says so — an unconditional {ok:true} let Render route to a dead instance',
    );
  }

  // ── H-8 · CORS answers an allowed origin and refuses an unknown one ─────────
  {
    const allowed = await app.request('/v1/config', {
      headers: { Origin: 'https://rizz-app-five.vercel.app' },
    });
    assert.equal(
      allowed.headers.get('access-control-allow-origin'),
      'https://rizz-app-five.vercel.app',
      'H-8: the known origin is echoed back',
    );

    const evil = await app.request('/v1/config', { headers: { Origin: 'https://evil.example' } });
    assert.equal(
      evil.headers.get('access-control-allow-origin'),
      null,
      'H-8: never `*` — this API is bearer-authenticated',
    );
  }

  // ── H-9 · the dummy hash is built once, lazily ──────────────────────────────
  {
    const first = await dummyHash();
    const second = await dummyHash();
    assert.equal(first, second, 'H-9: memoised — not one scrypt per call');
    assert.ok(first.startsWith('scrypt$'), 'H-9: and it is a real hash');
  }

  console.log('high.selfcheck: ok');
} finally {
  await db.execute(sql`DELETE FROM credit_events WHERE user_id = ${USER}`);
  await db.execute(sql`DELETE FROM idempotency WHERE id LIKE ${`${USER}:%`}`);
  await db.execute(sql`DELETE FROM users WHERE id = ${USER}`);
  await pool.end();
}
