import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { FREE_ANALYSIS_LIMIT } from '@/constants';
import type { FeedItem, ProfileScanResult, SavedItem } from '@/types';
import { nextScanHistory, nextSwipeState, todayKey } from './limits';
import { onAccountChanged, onCreditsChanged } from './session';
import { zustandStorage } from './storage';

/**
 * Reports kept in Profile Scan's history, newest first.
 *
 * Capped because these live in MMKV, which is memory-mapped and read whole on
 * launch: a report is a few KB of prose and an unbounded list would grow forever
 * on a screen that only ever shows the recent ones.
 *
 * ponytail: fixed cap, no pagination. Add paging only if someone actually wants
 * to scroll months back.
 */
const SCAN_HISTORY_LIMIT = 20;

interface RizzState {
  savedItems: SavedItem[];
  /** Past Profile Scan reports, newest first. Capped at SCAN_HISTORY_LIMIT. */
  scanHistory: ProfileScanResult[];
  analysisCount: number;
  /** Swipes used on `swipeDate`. Rolls over to 0 on a new day. */
  swipeCount: number;
  /** ISO date (YYYY-MM-DD) that swipeCount belongs to. */
  swipeDate: string | null;
  isPro: boolean;
  /** AI-generated openers for the current day (empty until first fetch). */
  dailyFeed: FeedItem[];
  /** ISO date (YYYY-MM-DD) the dailyFeed was generated for. */
  dailyFeedDate: string | null;
  /** Thumbs up/down per report or result id. */
  feedback: Record<string, 'up' | 'down'>;
  /**
   * Has the user been walked through the analyzer setup? Set once the first-run
   * screen is dismissed, whether or not they granted anything — nagging on every
   * launch is worse than letting them find it later in Profile Scan.
   */
  hasOnboarded: boolean;
  /**
   * Signed-in username, or null. **The single owner of "am I signed in".**
   *
   * Lives here rather than in `session.ts` because the launch sequence gates on
   * it and has to re-render the moment it changes — a plain MMKV read cannot do
   * that, so signing up left the app sitting on the auth wall. `session.ts`
   * pushes every change through `onAccountChanged`.
   */
  account: string | null;

  toggleSave: (item: Omit<SavedItem, 'savedAt'>) => void;
  removeSaved: (id: string) => void;
  clearVault: () => void;
  addScan: (result: ProfileScanResult) => void;
  removeScan: (id: string) => void;
  incrementAnalysis: () => void;
  incrementSwipe: () => void;
  setPro: (isPro: boolean) => void;
  setDailyFeed: (items: FeedItem[], date: string) => void;
  setFeedback: (id: string, value: 'up' | 'down') => void;
  setOnboarded: () => void;
}

export const useRizzStore = create<RizzState>()(
  persist(
    (set) => ({
      savedItems: [],
      scanHistory: [],
      analysisCount: 0,
      swipeCount: 0,
      swipeDate: null,
      isPro: false,
      dailyFeed: [],
      dailyFeedDate: null,
      feedback: {},
      hasOnboarded: false,
      account: null,

      toggleSave: (item) =>
        set((state) => {
          const exists = state.savedItems.some((saved) => saved.id === item.id);
          return {
            savedItems: exists
              ? state.savedItems.filter((saved) => saved.id !== item.id)
              : [{ ...item, savedAt: Date.now() }, ...state.savedItems],
          };
        }),

      removeSaved: (id) =>
        set((state) => ({ savedItems: state.savedItems.filter((saved) => saved.id !== id) })),

      clearVault: () => set({ savedItems: [] }),

      /**
       * Keyed by id so re-adding the same report replaces it rather than
       * duplicating — the scan screen calls this on every completed scan, and a
       * remount must not push a second copy of the report already on screen.
       */
      addScan: (result) =>
        set((state) => ({
          scanHistory: nextScanHistory(state.scanHistory, result, SCAN_HISTORY_LIMIT),
        })),

      removeScan: (id) =>
        set((state) => ({ scanHistory: state.scanHistory.filter((scan) => scan.id !== id) })),

      incrementAnalysis: () => set((state) => ({ analysisCount: state.analysisCount + 1 })),

      // Free swipes are a DAILY allowance — see state/limits.ts.
      incrementSwipe: () =>
        set((state) => nextSwipeState(state.swipeCount, state.swipeDate, todayKey())),

      setPro: (isPro) => set({ isPro }),

      setDailyFeed: (items, date) => set({ dailyFeed: items, dailyFeedDate: date }),

      setFeedback: (id, value) =>
        set((state) => ({ feedback: { ...state.feedback, [id]: value } })),

      setOnboarded: () => set({ hasOnboarded: true }),
    }),
    {
      name: 'rizzcoach-store',
      storage: createJSONStorage(() => zustandStorage),
      /*
       * v1 — one-time purge of scan history written before the engines stopped
       * substituting mock seeds for failed calls.
       *
       * Those reports look genuine and are indistinguishable from real ones on
       * the row: a user who scanned their own profile during an outage has a
       * "Maya · Bristol 26" entry — a stranger's name, a stranger's hobbies —
       * saved as if the AI had read their screenshot. There is no field that
       * marks a seed, so the only honest fix is to drop the list once. Everything
       * else (vault, credits, Pro, feedback) is untouched.
       */
      version: 1,
      migrate: (persisted, from) => {
        const state = persisted as Partial<RizzState>;
        if (from < 1) return { ...state, scanHistory: [] };
        return state;
      },
      partialize: (state) => ({
        savedItems: state.savedItems,
        scanHistory: state.scanHistory,
        analysisCount: state.analysisCount,
        swipeCount: state.swipeCount,
        swipeDate: state.swipeDate,
        isPro: state.isPro,
        dailyFeed: state.dailyFeed,
        dailyFeedDate: state.dailyFeedDate,
        feedback: state.feedback,
        // Must persist, or the first-run walkthrough reappears on every launch.
        hasOnboarded: state.hasOnboarded,
        account: state.account,
      }),
    },
  ),
);

/**
 * The server's credit count wins.
 *
 * `analysisCount` stays a local optimistic cache so the paywall can appear
 * without a round trip, but the server holds the real balance — it is the thing
 * that actually gates the Gemini call, and a device that reinstalls to reset
 * MMKV must not get three more free analyses. Every API response carries the
 * authoritative number and lands here.
 *
 * `isPro` is included because entitlement is now verified against RevenueCat
 * server-side (`POST /v1/user/pro`); trusting the device would make the credit
 * gate decorative.
 */
onCreditsChanged(({ is_pro, analysis_count }) => {
  useRizzStore.setState({ isPro: is_pro, analysisCount: analysis_count });
});

/** Signup, login, sign-out and delete all land here. See `account` above. */
onAccountChanged((account) => {
  useRizzStore.setState({ account });
});

/** Reactive "is this line saved" selector. */
export const useIsSaved = (id: string) =>
  useRizzStore((state) => state.savedItems.some((saved) => saved.id === id));

/**
 * Free AI credits exhausted. One definition shared by Lab, Bio Optimizer and
 * Profile Scan so the gate can never drift between them.
 */
export const useOutOfCredits = () =>
  useRizzStore((state) => !state.isPro && state.analysisCount >= FREE_ANALYSIS_LIMIT);
