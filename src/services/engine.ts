import { ANALYZE_STAGES, MOCK_ANALYSES } from '@/data/mockAnalysis';
import type { AnalysisResult, EngineMode } from '@/types';
import { uid, wait } from '@/utils/misc';
import { callGemini, imagePart, isLiveKey } from './gemini';

/**
 * The Screenshot Intelligence Engine — powered by Google Gemini vision.
 *
 * With a real key this analyses the chat screenshot; with the stubbed mock key
 * (default) it runs a local simulation so the product is demoable offline.
 * Shared transport lives in `gemini.ts`.
 *
 * Scoped by `mode`: the Lab only ever renders one mode's cards, so we only ask
 * for that mode's sections. Asking for all four and showing one burned ~3x the
 * output tokens (and wall-clock) on every scan.
 */

export interface EngineInput {
  base64: string;
  mimeType: string;
}

/** Which result sections each mode actually renders. */
const MODE_SECTIONS: Record<EngineMode, ('replies' | 'vibe' | 'roast' | 'sims')[]> = {
  rizz: ['replies', 'sims'],
  vibe: ['vibe'],
  roast: ['roast'],
};

/**
 * @param temperature raise it on a reroll so "give me another" returns another.
 */
export async function analyzeScreenshot(
  input: EngineInput,
  mode: EngineMode = 'rizz',
  temperature?: number,
): Promise<AnalysisResult> {
  if (isLiveKey) {
    try {
      return await analyzeWithGemini(input, mode, temperature);
    } catch (error) {
      console.warn('[engine] live analysis failed — falling back to simulation', error);
    }
  }
  return simulateAnalysis();
}

// ---------------------------------------------------------------------------
// Live path — Gemini vision with a structured JSON response schema
// ---------------------------------------------------------------------------

const PROMPT_INTRO = `You are RizzCoach, an elite dating-conversation strategist. The user sends a screenshot of a chat (dating app or texts). You analyze the OTHER person's messages and the user's own game, then produce:`;

/** One block per result section — only the requested mode's blocks are sent. */
const PROMPT_SECTIONS: Record<'replies' | 'vibe' | 'roast' | 'sims', string> = {
  replies: `replies — exactly 3 messages the user could send next, ids "a", "b" and "c": one Smooth (warm, sincere), one Playful (teasing, funny), one Bold (direct, moves things forward). Set spice 1-3 per reply (1 safe, 2 flirty, 3 spicy).

These get copied straight into the chat, so each one must read as if the USER typed it on their phone — not as if an app wrote it:
- Mirror the user's own voice from the screenshot: their capitalisation (if they text in lowercase, you text in lowercase), punctuation habits, emoji use or total lack of it, slang, and typical message length. Match it, never upgrade it.
- Keep it short. Most real texts are under 15 words. Never write a paragraph.
- Answer the LAST thing the other person actually said, and reference something specific from it. If a reply would still make sense pasted into a stranger's chat, it is wrong — rewrite it.
- One idea per message. Do not stack a compliment, a joke and a question into a single text.
- Do not open with "Haha", "Lol", "That's so", or a compliment. Do not restate what they just said back to them.
- No em-dashes, no semicolons, no neatly balanced two-clause sentences, no word the user would not say out loud. Fragments are fine. A missing full stop at the end is normal.
- No pickup lines, no explaining the joke, no stage directions or asterisks, no meta commentary.
- A question is optional. One of the three can simply be a good line that gives them something to react to.

The three must differ in ANGLE, not just in adjectives — if two could be sent in the same moment for the same reason, replace one.

Never be creepy, manipulative, sexually explicit, or pushy. If the other person shows disinterest, is upset, or asks for space, all three replies must respect that gracefully — no persuading, no guilt-tripping, no jokes at their expense.`,
  vibe: `vibe — a psychological read of the other person's texting persona: a punchy archetype name, an emoji, interest level 0-100, 2-4 observable traits, 0-3 red flags, and a 2-3 sentence verdict with one concrete tactical suggestion.`,
  roast: `roast — a brutal, funny, shareable roast of the USER's own texting in the screenshot (never roast the other person). Punch at their effort and style, not at protected traits. 2-4 sentences, brutality 1-5, plus a one-line tagline.`,
  sims: `sims — one entry for EACH of the three reply options ("a", "b" and "c"): a simulated probable response thread with probability 0-100 and 1-2 short messages from "them" written in the other person's exact texting style (mirror their punctuation, emoji habits, energy).`,
};

const PROMPT_GROUNDING = `Ground everything in what is actually visible in the screenshot. If the image is not a readable chat, still return the schema with low-confidence, gently humorous content explaining you could not read a conversation.`;

function promptFor(mode: EngineMode): string {
  const blocks = MODE_SECTIONS[mode].map((key, i) => `${i + 1}. ${PROMPT_SECTIONS[key]}`);
  return `${PROMPT_INTRO}\n\n${blocks.join('\n')}\n\n${PROMPT_GROUNDING}`;
}

/** Gemini responseSchema sections (OpenAPI-subset format with uppercase types). */
const SECTION_SCHEMAS = {
  replies: {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      required: ['id', 'style', 'text', 'spice'],
      properties: {
        id: { type: 'STRING', enum: ['a', 'b', 'c'] },
        style: { type: 'STRING', enum: ['Smooth', 'Playful', 'Bold'] },
        text: { type: 'STRING' },
        spice: { type: 'INTEGER', description: '1 = safe, 2 = flirty, 3 = spicy' },
      },
    },
  },
  vibe: {
    type: 'OBJECT',
    required: ['persona', 'emoji', 'interest', 'traits', 'redFlags', 'verdict', 'confidence'],
    properties: {
      persona: { type: 'STRING' },
      emoji: { type: 'STRING' },
      interest: { type: 'INTEGER', description: '0-100' },
      traits: { type: 'ARRAY', items: { type: 'STRING' } },
      redFlags: { type: 'ARRAY', items: { type: 'STRING' } },
      verdict: { type: 'STRING' },
      confidence: { type: 'INTEGER', description: '0-100' },
    },
  },
  roast: {
    type: 'OBJECT',
    required: ['text', 'brutality', 'tagline'],
    properties: {
      text: { type: 'STRING' },
      brutality: { type: 'INTEGER', description: '1-5' },
      tagline: { type: 'STRING' },
    },
  },
  sims: {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      required: ['replyId', 'probability', 'messages'],
      properties: {
        replyId: { type: 'STRING', enum: ['a', 'b', 'c'] },
        probability: { type: 'INTEGER', description: '0-100' },
        messages: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            required: ['from', 'text'],
            properties: {
              from: { type: 'STRING', enum: ['them', 'you'] },
              text: { type: 'STRING' },
            },
          },
        },
      },
    },
  },
} as const;

/** Build a responseSchema holding only the sections this mode renders. */
function schemaFor(mode: EngineMode) {
  const keys = MODE_SECTIONS[mode];
  return {
    type: 'OBJECT',
    required: keys,
    properties: Object.fromEntries(keys.map((key) => [key, SECTION_SCHEMAS[key]])),
  };
}

async function analyzeWithGemini(
  { base64, mimeType }: EngineInput,
  mode: EngineMode,
  temperature = 0.9,
): Promise<AnalysisResult> {
  const parsed = await callGemini<Omit<AnalysisResult, 'id' | 'createdAt'>>({
    system: promptFor(mode),
    parts: [
      imagePart(base64, mimeType),
      { text: 'Analyze this chat screenshot and return the RizzCoach breakdown.' },
    ],
    schema: schemaFor(mode),
    temperature,
  });
  return { ...parsed, id: uid(), createdAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Simulation path — offline demo mode
// ---------------------------------------------------------------------------

let rotation = Math.floor(Math.random() * MOCK_ANALYSES.length);

async function simulateAnalysis(): Promise<AnalysisResult> {
  // Hold roughly one beat per stage so the scanning UI gets its moment.
  await wait(ANALYZE_STAGES.length * 850 + 400);
  const seed = MOCK_ANALYSES[rotation % MOCK_ANALYSES.length];
  rotation += 1;
  const clone = JSON.parse(JSON.stringify(seed)) as Omit<AnalysisResult, 'id' | 'createdAt'>;
  return { ...clone, id: uid(), createdAt: Date.now() };
}
