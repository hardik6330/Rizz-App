import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { FREE_ANALYSIS_LIMIT } from '@/constants';
import type { CoachProfile, FeedItem, ProfileScanResult, SavedItem } from '@/types';
import { nextScanHistory, nextSwipeState, todayKey } from './limits';
import {
  clearVaultItems,
  deleteScan,
  deleteVaultItem,
  fetchVault,
  isLiveApi,
  onAccountChanged,
  onAccountCleared,
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
   * Has the user watched the "what this app does" demo? Set on its CTA.
   *
   * **Gates `/account`, so it runs BEFORE the signup wall** — see the note on
   * the account gate in `_layout.tsx`, which spells out the cost of asking for
   * an email before the user has seen a single result. This is the answer to
   * that: show the product working, then ask.
   *
   * `_layout.tsx` treats an existing account as equivalent, so an install that
   * upgrades into this build is not shown a demo of an app it already uses.
   * That means this flag stays false for those users for ever, which is fine —
   * nothing else reads it.
   */
  hasSeenWelcome: boolean;
  /**
   * Has this install ever produced a successful analysis? **Activation.**
   *
   * Persisted, and that is the whole point: `ai_success` fires on every call and
   * cannot tell a first from a fiftieth, so without a durable flag there is no
   * way to count the one event that says the product worked for someone. A
   * reinstall correctly counts again — it is a new install; a relaunch does not.
   *
   * Set from `callApi`, not from the screens. It is a single choke point that
   * already knows the engine, and three screens setting a funnel flag is three
   * places for it to be forgotten when a fourth tool ships.
   */
  hasActivated: boolean;
  /**
   * Has the user agreed that their screenshots may be sent to Google Gemini?
   *
   * **false blocks every AI tool** — see `utils/useAiConsent.ts`. This is a
   * disclosure gate, not a feature flag and not a paywall: nothing about it
   * touches credits, plans or entitlement, and a Pro user is asked exactly like
   * a free one. The question is whether their private conversation may leave the
   * device, and money does not buy a different answer.
   *
   * Persisted, because asking again every launch trains people to tap through
   * consent screens without reading them — which is the failure mode the rule
   * exists to prevent. A reinstall asks again, correctly: that is a fresh device
   * with no record of the person having ever seen it.
   */
  aiConsent: boolean;
  /**
   * The first-run answers, or null while they are still unanswered.
   *
   * **null is what makes `/onboarding` appear** — same shape as `account` gating
   * the auth wall. So this is also the "have they done the quiz" flag; a separate
   * boolean alongside it would be a second source of truth for one question, and
   * the two would eventually disagree about whether to show a modal.
   *
   * Read by every engine through `coachPayload()`. Cleared on sign-out as well
   * as on deletion — the next account to sign in on this device is a different
   * person, and because this doubles as the "have they done the quiz" flag,
   * leaving it set meant they were never asked and inherited the previous
   * user's answers. See `onAccountCleared`.
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
  /** Records that the pre-signup demo was watched. See `hasSeenWelcome`. */
  seeWelcome: () => void;
  setCoach: (coach: CoachProfile) => void;
  /** Records agreement that uploads may go to Google Gemini. See `aiConsent`. */
  grantAiConsent: () => void;
  /** Marks activation and reports whether THIS call was the first. See `hasActivated`. */
  markActivated: () => boolean;
}

export const useRizzStore = create<RizzState>()(
  persist(
    (set, get) => ({
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
      hasSeenWelcome: false,
      hasActivated: false,
      aiConsent: false,
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

      seeWelcome: () => set({ hasSeenWelcome: true }),

      grantAiConsent: () => set({ aiConsent: true }),

      /**
       * Returns true exactly once per install — on the call that flips the flag.
       *
       * Read-then-write is safe here in a way it would not be for a credit:
       * JS is single-threaded, `set` is synchronous, and the worst case of a
       * miss is one under-counted analytics event rather than a free analysis.
       * Do NOT copy this shape for anything that gates spending.
       */
      markActivated: () => {
        if (get().hasActivated) return false;
        set({ hasActivated: true });
        return true;
      },

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
        hasSeenWelcome: state.hasSeenWelcome,
        // Must persist, or every launch re-reports the user as newly activated.
        hasActivated: state.hasActivated,
        // Must persist, or the app re-asks for upload consent on every launch —
        // which teaches people to tap through it without reading.
        aiConsent: state.aiConsent,
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
  if (account != null) void hydrateVault();
});

/**
 * Pull the vault from the server and take it as the truth. The ONE place that
 * does this — the vault screen used to run its own near-copy on mount.
 *
 * `null` is "could not ask" and leaves the local copy alone; `[]` is the server
 * genuinely saying the vault is empty, and is applied. That is what makes a
 * vault cleared on another device actually clear here. Both call sites used to
 * guard on `items.length > 0` instead, which meant an emptied vault came back
 * from the dead on every launch.
 *
 * Compared before writing because this runs on every open of the screen and a
 * fresh array reference would re-render the list for nothing.
 */
export async function hydrateVault(): Promise<void> {
  const page = await fetchVault();
  if (!page) return;

  /*
   * Drop lines already saved under a different id, and delete those rows.
   *
   * Cleanup for a bug that is fixed at the source: the daily feed decorated its
   * lines with `uid()`, so the same text came back with a new id on every fetch,
   * the card read as unsaved, and saving it again inserted a SECOND row instead
   * of upserting the first. `contentId()` in `feedEngine.ts` stopped new ones
   * from appearing; this clears the pairs already sitting in people's vaults,
   * which they would otherwise have to delete twice by hand.
   *
   * Newest wins because the list arrives `saved_at DESC` — the row the user most
   * recently interacted with is the one whose id the UI is checking against.
   *
   * Safe to leave in permanently: with stable ids it matches nothing and costs
   * one pass over a list already in memory. It is not a general "no two lines
   * may share text" rule — it only ever fires on rows that are byte-identical,
   * which is a duplicate by any definition the user would recognise.
   */
  const seen = new Set<string>();
  const deduped = page.items.filter((row) => {
    if (seen.has(row.text)) {
      // Fire-and-forget, exactly like `removeSaved`: `deleteVaultItem` no-ops
      // offline and swallows its own failures, and a retry is just the next
      // hydrate.
      void deleteVaultItem(row.id);
      return false;
    }
    seen.add(row.text);
    return true;
  });
  page.items = deduped;

  /*
   * Replace when the server sent everything; merge when it capped the response.
   *
   * Replacing is what makes a vault emptied on another device actually empty
   * here — but replacing a truncated page would delete the local copy of the
   * older lines the server deliberately held back. Merge keeps them, server
   * values winning on id collisions, so nothing is ever lost in either
   * direction. `has_more` only fires past 500 saved lines; this is the branch
   * nobody will hit and everybody would have got wrong.
   */
  const next = page.hasMore
    ? [
        ...(page.items as SavedItem[]),
        ...useRizzStore
          .getState()
          .savedItems.filter((local) => !page.items.some((row) => row.id === local.id)),
      ].sort((a, b) => b.savedAt - a.savedAt)
    : (page.items as SavedItem[]);

  // Compared before writing: this runs on every open of the screen, and a fresh
  // array reference would re-render the list for nothing.
  const current = useRizzStore.getState().savedItems;
  if (JSON.stringify(current) !== JSON.stringify(next)) {
    useRizzStore.setState({ savedItems: next });
  }
}

/**
 * The account no longer owns this device — sign-out or delete. Drop the local
 * copy of everything it owned.
 *
 * `setState`, deliberately, and not `clearVault()` / `removeScan()`: those actions
 * mirror to the API, and by the time this fires the token is already gone. On the
 * delete path the rows were removed server-side in one transaction, so calling
 * them would fire 401s at a user that no longer exists; on the sign-out path the
 * rows must SURVIVE on the server, and those actions would delete them.
 *
 * `coach` is in the list and is the reason sign-out was added to this channel. It
 * is persisted, so it used to outlive a sign-out — and `coachStepDone` in
 * `_layout.tsx` is `coach != null`, so the next account to sign up on this device
 * was never asked the three setup questions and was personalised with the
 * previous user's answers. See `onAccountCleared` in session.ts.
 *
 * ⚠️ Account-owned state only. `analysisCount` and `isPro` stay — they are
 * install-scoped, and wiping them here would make sign-out a way to reset the
 * free tier.
 */
onAccountCleared(() => {
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
