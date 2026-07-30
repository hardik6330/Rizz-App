/**
 * Free-swipe allowance rules — pure, and in ONE place on purpose.
 *
 * The store (which counts swipes) and the Discover screen (which decides if the
 * feed is locked) must agree on this rule. When they didn't, a free user's
 * lifetime count kept growing and permanently locked them out of a feed that
 * refreshes daily. The allowance is per-day: yesterday never gates today.
 *
 * Self-check: `node src/state/limits.selfcheck.ts`
 */

/** Today as YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Swipes counted against today's allowance. A stale date means 0 used today. */
export function swipesUsedToday(
  swipeCount: number,
  swipeDate: string | null,
  today: string,
): number {
  return swipeDate === today ? swipeCount : 0;
}

/** Next swipe state, rolling the counter over to 1 on a new day. */
export function nextSwipeState(
  swipeCount: number,
  swipeDate: string | null,
  today: string,
): { swipeCount: number; swipeDate: string } {
  return swipeDate === today
    ? { swipeCount: swipeCount + 1, swipeDate: today }
    : { swipeCount: 1, swipeDate: today };
}

/**
 * Is this a real store key, or a stub that should drop us into mock mode?
 *
 * Lives here (pure, self-checked) rather than in `purchases.ts` because getting
 * it wrong does not fail loudly — it silently grants Pro for free. Apple keys
 * are `appl_`, Google Play keys are `goog_`; a check for only one of them makes
 * the other platform's paywall a no-op.
 */
export function isLiveRevenueCatKey(key: string | undefined | null): boolean {
  if (!key) return false;
  return /^(appl|goog)_/.test(key) && !key.toLowerCase().includes('mock');
}

/**
 * Next scan-history list: newest first, one entry per id, capped.
 *
 * Pure and here rather than inline in the store because `useRizzStore` cannot be
 * imported by a Node self-check (it reaches react-native and MMKV), and both
 * halves of this fail silently. Without the id filter a remount re-adds the
 * report already on screen and history shows it twice; without the cap MMKV grows
 * without bound, and it is memory-mapped and read whole on launch.
 */
export function nextScanHistory<T extends { id: string }>(
  history: T[],
  entry: T,
  limit: number,
): T[] {
  return [entry, ...history.filter((item) => item.id !== entry.id)].slice(0, limit);
}
