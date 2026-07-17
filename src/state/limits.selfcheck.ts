/**
 * Runnable self-check for the free-swipe allowance rules.
 *   node src/state/limits.selfcheck.ts
 * No framework — fails loudly if the daily rollover ever breaks again.
 */
import assert from 'node:assert/strict';

import { isLiveRevenueCatKey, nextSwipeState, swipesUsedToday, todayKey } from './limits.ts';

const TODAY = '2026-07-16';
const YESTERDAY = '2026-07-15';
const LIMIT = 10;

// todayKey formats as YYYY-MM-DD
assert.equal(todayKey(new Date('2026-07-16T09:30:00Z')), TODAY);

// Fresh user: nothing used.
assert.equal(swipesUsedToday(0, null, TODAY), 0);

// Same day: the count stands.
assert.equal(swipesUsedToday(7, TODAY, TODAY), 7);

// THE BUG THIS EXISTS FOR: yesterday's maxed-out count must not gate today.
assert.equal(swipesUsedToday(LIMIT, YESTERDAY, TODAY), 0);
assert.ok(swipesUsedToday(LIMIT, YESTERDAY, TODAY) < LIMIT, 'a new day must unlock the feed');

// Same day increments.
assert.deepEqual(nextSwipeState(4, TODAY, TODAY), { swipeCount: 5, swipeDate: TODAY });

// New day rolls over to 1, not 11.
assert.deepEqual(nextSwipeState(LIMIT, YESTERDAY, TODAY), { swipeCount: 1, swipeDate: TODAY });

// First-ever swipe.
assert.deepEqual(nextSwipeState(0, null, TODAY), { swipeCount: 1, swipeDate: TODAY });

// A free user can swipe the full allowance every day, forever.
let count = 0;
let date: string | null = null;
for (const day of ['2026-07-16', '2026-07-17', '2026-07-18']) {
  for (let i = 0; i < LIMIT; i += 1) {
    assert.ok(swipesUsedToday(count, date, day) < LIMIT, `locked out on ${day} at swipe ${i}`);
    ({ swipeCount: count, swipeDate: date } = nextSwipeState(count, date, day));
  }
  assert.equal(swipesUsedToday(count, date, day), LIMIT, `should be gated after ${LIMIT} on ${day}`);
}

// --- RevenueCat key detection -----------------------------------------------
// THE BUG THIS EXISTS FOR: an `appl_`-only check put every Android build into
// mock mode, where purchasePlan() hands out Pro for free.
assert.equal(isLiveRevenueCatKey('goog_abcdef123456'), true, 'Google Play keys must read as live');
assert.equal(isLiveRevenueCatKey('appl_abcdef123456'), true, 'Apple keys must read as live');

// Stubs and blanks must fall back to mock mode.
assert.equal(isLiveRevenueCatKey('appl_mock_key'), false);
assert.equal(isLiveRevenueCatKey('goog_mock_key'), false);
assert.equal(isLiveRevenueCatKey('goog_MOCK_key'), false, 'mock detection is case-insensitive');
assert.equal(isLiveRevenueCatKey(''), false);
assert.equal(isLiveRevenueCatKey(undefined), false, 'an unset platform key is not live');
assert.equal(isLiveRevenueCatKey(null), false);

// A key for the wrong shape entirely is not live.
assert.equal(isLiveRevenueCatKey('sk_live_deadbeef'), false);

console.log('✅ limits self-check passed');
