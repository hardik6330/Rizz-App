import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { FREE_ANALYSIS_LIMIT } from '@/constants';
import type { CoachProfile, FeedItem, ProfileScanResult, SavedItem } from '@/types';
import { nextScanHistory, nextSwipeState, todayKey } from './limits';
import {
  clearVaultItems,
  deleteScan,
  deleteVaultItem,
  isLiveApi,
  onAccountChanged,
  onAccountDeleted,
  onCreditsChanged,
  saveCoachProfile,
  saveVaultItem,
} from './session';
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
   * The first-run answers, or null while they are still unanswered.
   *
   * **null is what makes `/onboarding` appear** — same shape as `account` gating
   * the auth wall. So this is also the "have they done the quiz" flag; a separate
   * boolean alongside it would be a second source of truth for one question, and
   * the two would eventually disagree about whether to show a modal.
   *
   * Read by every engine through `coachPayload()`. Cleared on account deletion,
   * because the next person to use this install is a different person.
   */
  coach: CoachProfile | null;
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
  setCoach: (coach: CoachProfile) => void;
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
      coach: null,
      account: null,

      toggleSave: (item) =>
        set((state) => {
          const exists = state.savedItems.some((saved) => saved.id === item.id);
          if (exists) {
            void deleteVaultItem(item.id);
            return { savedItems: state.savedItems.filter((saved) => saved.id !== item.id) };
          } else {
            const newItem = { ...item, savedAt: Date.now() };
            void saveVaultItem(newItem);
            return { savedItems: [newItem, ...state.savedItems] };
          }
        }),

      removeSaved: (id) => {
        void deleteVaultItem(id);
        set((state) => ({ savedItems: state.savedItems.filter((saved) => saved.id !== id) }));
      },

      clearVault: () => {
        void clearVaultItems();
        set({ savedItems: [] });
      },

      /**
       * Keyed by id so re-adding the same report replaces it rather than
       * duplicating — the scan screen calls this on every completed scan, and a
       * remount must not push a second copy of the report already on screen.
       */
      addScan: (result) =>
        set((state) => ({
          scanHistory: nextScanHistory(state.scanHistory, result, SCAN_HISTORY_LIMIT),
        })),

      /**
       * Deletes the server row too — same rule as `removeSaved`, and for the
       * same reason it lives HERE rather than at the call site.
       *
       * `profile.tsx` used to call `deleteScan()` itself, so the sync was a
       * property of one screen rather than of the action: a second caller of
       * `removeScan` would drop the local copy and leave the row on the server
       * forever, with nothing to notice it. Both writes belong to whoever owns
       * the list. `deleteScan` no-ops offline and swallows its own failures, so
       * there is nothing to guard here.
       */
      removeScan: (id) => {
        void deleteScan(id);
        set((state) => ({ scanHistory: state.scanHistory.filter((scan) => scan.id !== id) }));
      },

      /**
       * Count one analysis locally. **Only when there is no server to ask.**
       *
       * ## The bug this closes
       *
       * There were two writers to `analysisCount` and both fired on every live
       * analysis, so a free user was locked out after TWO of their three free
       * analyses:
       *
       *   1. `callApi` receives `{ result, credits }` and calls `reportCredits`,
       *      which sets `analysisCount` to the server's number — and that number
       *      ALREADY includes the charge for the request that just returned.
       *   2. The screen then awaited that same call and added its own +1.
       *
       *   analysis 1 → server says 1 → set to 1 → +1 → 2
       *   analysis 2 → server says 2 → set to 2 → +1 → 3 → out of credits
       *
       * It hid because the local increment is CORRECT offline: with no API there
       * is no envelope, so this is the only counter there is. It only
       * double-counts against a live server — which is the configuration that
       * ships, and the one nobody runs while developing against mock data.
       *
       * The guard lives here rather than at the three call sites (Lab, Bio,
       * Profile Scan, plus the chat-usage drain in _layout) for the same reason
       * `useOutOfCredits` is one selector: three copies of a freemium rule is
       * three chances for it to drift, and this one drifted silently for money.
       *
       * `reportCredits` is the sole writer whenever `isLiveApi`. `refreshCredits`
       * on launch and resume is the backstop if a response ever arrives without
       * a credits envelope.
       */
      incrementAnalysis: () =>
        set((state) => (isLiveApi ? state : { analysisCount: state.analysisCount + 1 })),

      // Free swipes are a DAILY allowance — see state/limits.ts.
      incrementSwipe: () =>
        set((state) => nextSwipeState(state.swipeCount, state.swipeDate, todayKey())),

      setPro: (isPro) => set({ isPro }),

      setDailyFeed: (items, date) => set({ dailyFeed: items, dailyFeedDate: date }),

      setFeedback: (id, value) =>
        set((state) => ({ feedback: { ...state.feedback, [id]: value } })),

      setOnboarded: () => set({ hasOnboarded: true }),

      setCoach: (coach) => {
        void saveCoachProfile(coach);
        set({ coach });
      },
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
        // Same — and it is also the personalisation every engine reads.
        coach: state.coach,
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
onCreditsChanged(({ is_pro, analysis_count, coach }) => {
  useRizzStore.setState({ isPro: is_pro, analysisCount: analysis_count });
  adoptCoach(coach);
});

/**
 * Take the server's onboarding answers — but ONLY when this device has none.
 *
 * This is what makes the answers survive a reinstall: MMKV is empty on a fresh
 * install, so the launch that follows the login pulls them back and the setup
 * screen never appears. Everything else the account owns already worked this
 * way; personalisation was the one thing that silently did not.
 *
 * **The device wins whenever it has an opinion**, and that asymmetry is load
 * bearing in two directions. Answers just given while offline must not be
 * overwritten by an older row on the next resume. And `coach` is absent from
 * every response except `/v1/user/credits`, so treating a missing value as
 * "cleared" would wipe the profile on the next analysis and drop the user back
 * into onboarding — the failure would look random, because it would depend on
 * which request happened to land last.
 */
function adoptCoach(raw: string | null | undefined): void {
  if (!raw || useRizzStore.getState().coach) return;
  try {
    // Written by this app, but parsed defensively all the same: a build that
    // renamed an answer would otherwise put a value nothing maps into the store,
    // and from there into a prompt.
    const parsed = JSON.parse(raw) as CoachProfile;
    if (parsed?.style && parsed?.struggle) useRizzStore.setState({ coach: parsed });
  } catch {
    // Unparseable means no personalisation, not a broken launch.
  }
}

/** Signup, login, sign-out and delete all land here. See `account` above. */
onAccountChanged((account) => {
  useRizzStore.setState({ account });
});

/**
 * Account deleted — drop the local copy of everything it owned.
 *
 * `setState`, deliberately, and not `clearVault()` / `removeScan()`: those actions
 * mirror to the API, and by the time this fires the token is already gone and the
 * rows were deleted server-side in one transaction. Calling them would fire 401s
 * at a user that no longer exists.
 *
 * Sign-out does NOT come through here — see `onAccountDeleted` in session.ts.
 */
onAccountDeleted(() => {
  useRizzStore.setState({ savedItems: [], scanHistory: [], coach: null });
});

/**
 * Free AI credits exhausted. One definition shared by Lab, Bio Optimizer and
 * Profile Scan so the gate can never drift between them.
 */
export const useOutOfCredits = () =>
  useRizzStore((state) => !state.isPro && state.analysisCount >= FREE_ANALYSIS_LIMIT);

/**
 * The onboarding answers as an API payload, or undefined.
 *
 * One definition for the three engines that send it (Lab, Profile Scan, Bio Lab)
 * — same reasoning as `useOutOfCredits`. `undefined` rather than `null` so it
 * drops out of the JSON body entirely when unanswered, which is exactly what the
 * optional field on the server expects.
 *
 * Not a hook: it is read inside an async request, not during render.
 */
export const coachPayload = (): CoachProfile | undefined =>
  useRizzStore.getState().coach ?? undefined;
