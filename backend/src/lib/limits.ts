/**
 * The free-tier rules — RE-EXPORTED from the app, never forked.
 *
 * `src/state/limits.ts` is pure, self-checked (`node src/state/limits.selfcheck.ts`)
 * and already the single definition of this rule on the client. The server is the
 * second caller, not a second implementation: when the store and the screen each
 * had their own copy of the swipe rule, they disagreed and permanently locked free
 * users out of a feed that refreshes daily. Two languages would be worse.
 *
 * The build runs from the repo root so this path resolves — see render.yaml.
 * esbuild inlines it into dist/index.js, so nothing outside backend/ is needed
 * at runtime, only at build time.
 */
export { todayKey, swipesUsedToday, nextSwipeState, isLiveRevenueCatKey } from '../../../src/state/limits.ts';

/** Mirrors src/constants.ts. Returned to the client so there is one definition. */
export const FREE_ANALYSIS_LIMIT = 3;

/** Hard ceiling per install per day — applies to Pro too. One compromised
 *  account must not be able to run up an unbounded Gemini bill. */
export const DAILY_CALL_CAP = 200;
