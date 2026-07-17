import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { FREE_ANALYSIS_LIMIT } from '@/constants';
import type { FeedItem, SavedItem } from '@/types';
import { nextSwipeState, todayKey } from './limits';
import { zustandStorage } from './storage';

interface RizzState {
  savedItems: SavedItem[];
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

  toggleSave: (item: Omit<SavedItem, 'savedAt'>) => void;
  removeSaved: (id: string) => void;
  clearVault: () => void;
  incrementAnalysis: () => void;
  incrementSwipe: () => void;
  setPro: (isPro: boolean) => void;
  setDailyFeed: (items: FeedItem[], date: string) => void;
  setFeedback: (id: string, value: 'up' | 'down') => void;
}

export const useRizzStore = create<RizzState>()(
  persist(
    (set) => ({
      savedItems: [],
      analysisCount: 0,
      swipeCount: 0,
      swipeDate: null,
      isPro: false,
      dailyFeed: [],
      dailyFeedDate: null,
      feedback: {},

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

      incrementAnalysis: () => set((state) => ({ analysisCount: state.analysisCount + 1 })),

      // Free swipes are a DAILY allowance — see state/limits.ts.
      incrementSwipe: () =>
        set((state) => nextSwipeState(state.swipeCount, state.swipeDate, todayKey())),

      setPro: (isPro) => set({ isPro }),

      setDailyFeed: (items, date) => set({ dailyFeed: items, dailyFeedDate: date }),

      setFeedback: (id, value) =>
        set((state) => ({ feedback: { ...state.feedback, [id]: value } })),
    }),
    {
      name: 'rizzcoach-store',
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({
        savedItems: state.savedItems,
        analysisCount: state.analysisCount,
        swipeCount: state.swipeCount,
        swipeDate: state.swipeDate,
        isPro: state.isPro,
        dailyFeed: state.dailyFeed,
        dailyFeedDate: state.dailyFeedDate,
        feedback: state.feedback,
      }),
    },
  ),
);

/** Reactive "is this line saved" selector. */
export const useIsSaved = (id: string) =>
  useRizzStore((state) => state.savedItems.some((saved) => saved.id === id));

/**
 * Free AI credits exhausted. One definition shared by Lab, Bio Optimizer and
 * Profile Scan so the gate can never drift between them.
 */
export const useOutOfCredits = () =>
  useRizzStore((state) => !state.isPro && state.analysisCount >= FREE_ANALYSIS_LIMIT);
