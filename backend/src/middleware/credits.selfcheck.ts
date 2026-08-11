/**
 * Locks the `credits` envelope to the key names the app reads.
 *
 *   cd backend && node --env-file=.env --import tsx src/middleware/credits.selfcheck.ts
 *
 * `/v1/ai/*` once returned `{ is_pro, remaining }` while `/v1/auth/device` and
 * `/v1/user/credits` returned `{ is_pro, analysis_count, credits_remaining }`.
 * Nothing failed. The app's `Credits` type said the fields existed, so
 * `analysis_count` arrived `undefined`, `useRizzStore` wrote it to the store, the
 * meter rendered `NaN/3 free` — and `useOutOfCredits` compared `undefined >= 3`,
 * which is false, so the paywall stopped existing for free users.
 *
 * A missing key is therefore a revenue bug that types cannot catch across the
 * client/server boundary. Assert the names.
 *
 * No DB and no network: creditsEnvelope is pure. It needs --env-file only because
 * importing the module loads db/client.ts, which validates env.
 */
import assert from 'node:assert/strict';

import { creditsEnvelope } from './credits.ts';

/** Exactly the fields of `Credits` in the app's src/services/auth.ts. */
const CLIENT_KEYS = ['is_pro', 'analysis_count', 'credits_remaining'] as const;

const free = creditsEnvelope({ isPro: false, analysisCount: 1, remaining: 2 });
assert.deepEqual(Object.keys(free).sort(), [...CLIENT_KEYS].sort(), 'envelope keys match Credits');
assert.equal(free.analysis_count, 1, 'analysis_count is present — the store reads it verbatim');
assert.equal(free.credits_remaining, 2, 'free users get a number');
assert.equal(free.is_pro, false);

// Every key must be a value the client can use. `undefined` is the failure mode:
// it survives JSON.stringify by vanishing, so the client sees a missing field.
for (const key of CLIENT_KEYS) {
  assert.notEqual(free[key], undefined, `${key} is never undefined`);
}

const pro = creditsEnvelope({ isPro: true, analysisCount: 9, remaining: Number.MAX_SAFE_INTEGER });
assert.equal(pro.credits_remaining, null, 'Pro sends null, not MAX_SAFE_INTEGER');
assert.equal(pro.analysis_count, 9, 'Pro still reports the count');
assert.equal(pro.is_pro, true);

// The count must survive a round trip through JSON — this is what the wire carries.
const wire = JSON.parse(JSON.stringify(free)) as Record<string, unknown>;
assert.equal(wire.analysis_count, 1, 'analysis_count survives serialization');
assert.equal(
  Number.isFinite(3 - (wire.analysis_count as number)),
  true,
  'LimitBadge arithmetic yields a number, not NaN',
);

console.log('credits.selfcheck: ok');
