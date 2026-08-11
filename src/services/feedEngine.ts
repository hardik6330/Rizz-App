import { BG, BG_FALLBACK } from '@/data/assets';
import type { FeedCategory, FeedItem } from '@/types';
import { contentId } from '@/utils/contentId';
import { callApi, isLiveApi } from './api';

const BG_KEYS = Object.keys(BG) as (keyof typeof BG)[];

/**
 * Daily "fresh openers" engine.
 *
 * Generates a small batch of brand-new opening lines so the Discover feed
 * changes every day instead of showing the same curated set forever. Called
 * once per day by the Discover screen; the result is cached in the store.
 * Shared transport lives in `api.ts`.
 *
 * The batch is identical for every user, so the server generates it once per day
 * globally and serves the cached row after that. This used to be one generation
 * per device per day — the same prompt bought N times for the same answer.
 */

// One request either way — a bigger batch costs the same call and keeps the
// feed from dead-ending before the free swipe allowance runs out.
const BATCH_SIZE = 15;

/** One generated line, before it is decorated with a background and an id. */
interface RawLine {
  text: string;
  category: FeedCategory;
  context: string;
  successRate: number;
}

function toFeedItems(lines: RawLine[]): FeedItem[] {
  return lines.map((line, i) => {
    // Reuse the real bundled cinematic backgrounds so AI cards look premium.
    const key = BG_KEYS[i % BG_KEYS.length];
    return {
      /*
       * Derived from the line, NOT `uid()`.
       *
       * The server generates this batch once per day for everybody and serves
       * the cached row after that, so the same text comes back on every fetch —
       * but `uid()` gave it a new id each time. A vault id is the server's
       * primary key and the save is an upsert, so a re-minted id turned "save
       * this line" into a second row: the card showed unsaved, the user tapped
       * it again, and the vault held two identical entries. Refetches happen on
       * sign-out, on a new day, and on any cache miss, so this was reachable in
       * normal use rather than a corner case.
       *
       * The curated lines in `data/feed.ts` never had the bug — their ids are
       * hardcoded (`feed-01`…). This gives the generated ones the same property.
       */
      id: contentId('ai', line.text),
      category: line.category,
      text: line.text,
      context: line.context,
      successRate: Math.max(60, Math.min(line.successRate, 92)),
      // ponytail: sentinel age 0 = "Fresh today" tag; no fake tester invented.
      testedBy: { name: 'RizzCoach AI', age: 0, avatar: null },
      background: { image: BG[key], colors: BG_FALLBACK[key] },
    };
  });
}

/** Returns a fresh batch, or [] on failure so Discover falls back to the base feed. */
export async function generateFreshOpeners(): Promise<FeedItem[]> {
  if (!isLiveApi) return toFeedItems(MOCK_LINES);
  try {
    const parsed = await callApi<{ lines: RawLine[] }>('/v1/ai/feed', { count: BATCH_SIZE });
    return toFeedItems(parsed.lines ?? []);
  } catch (error) {
    console.warn('[feedEngine] daily generation failed — using base feed', error);
    return [];
  }
}

// Offline demo batch (mock key) so the "fresh today" row still appears.
const MOCK_LINES: RawLine[] = [
  { text: "I have a strict no-small-talk policy, so: weirdest thing you're irrationally passionate about?", category: 'Opener', context: 'Skip the boring intro', successRate: 84 },
  { text: 'Bold of you to have a personality this good and expect me to play it cool.', category: 'Comeback', context: 'They said something great', successRate: 79 },
  { text: 'I got distracted by real life and left the best conversation on read. Undo that with me?', category: 'Recovery', context: 'You went quiet first', successRate: 71 },
  { text: 'This chat has clearly outgrown the app. Coffee this week, or are you all talk?', category: 'Closer', context: 'Momentum is high', successRate: 76 },
];
