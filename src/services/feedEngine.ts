import { BG, BG_FALLBACK } from '@/data/assets';
import type { FeedCategory, FeedItem } from '@/types';
import { uid } from '@/utils/misc';
import { callGemini, isLiveKey } from './gemini';

const BG_KEYS = Object.keys(BG) as (keyof typeof BG)[];

/**
 * Daily "fresh openers" engine — Gemini text generation.
 *
 * Generates a small batch of brand-new opening lines so the Discover feed
 * changes every day instead of showing the same curated set forever. Called
 * once per day by the Discover screen; the result is cached in the store.
 * Shared transport lives in `gemini.ts`.
 */

// One request either way — a bigger batch costs the same call and keeps the
// feed from dead-ending before the free swipe allowance runs out.
const BATCH_SIZE = 15;

const SYSTEM_PROMPT = `You are RizzCoach's line writer. Generate ${BATCH_SIZE} fresh, original dating opening/reply lines for a daily inspiration feed. Spread them across the four categories: Opener (first message), Comeback (witty reply), Recovery (re-engage after going quiet), Closer (ask them out). Each line: sounds like a real human under 35, clever and specific, never creepy, cheesy, sexual, or a tired pickup cliché. For each also give a short "context" (when to use it, max 6 words) and a realistic "successRate" integer 60-92.`;

const RESULT_SCHEMA = {
  type: 'OBJECT',
  required: ['lines'],
  properties: {
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['text', 'category', 'context', 'successRate'],
        properties: {
          text: { type: 'STRING' },
          category: { type: 'STRING', enum: ['Opener', 'Comeback', 'Recovery', 'Closer'] },
          context: { type: 'STRING' },
          successRate: { type: 'INTEGER', description: '60-92' },
        },
      },
    },
  },
} as const;

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
      id: uid(),
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
  if (!isLiveKey) return toFeedItems(MOCK_LINES);
  try {
    const parsed = await callGemini<{ lines: RawLine[] }>({
      system: SYSTEM_PROMPT,
      parts: [{ text: "Write today's fresh lines." }],
      schema: RESULT_SCHEMA,
      maxOutputTokens: 4096,
      temperature: 1.1,
    });
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
