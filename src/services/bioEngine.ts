import type { BioInput, BioResult } from '@/types';
import { uid, wait } from '@/utils/misc';
import { callGemini, isLiveKey } from './gemini';

/**
 * The Bio Optimizer engine — Gemini text generation.
 *
 * With the stubbed mock key (default) it returns rotating hand-written bios so
 * the tool is demoable offline. Shared transport lives in `gemini.ts`.
 */

/** Staged status copy shown while a bio is being written. */
export const BIO_STAGES = [
  'Reading your interests…',
  'Finding your angle…',
  'Writing three drafts…',
  'Polishing the hooks…',
];

export async function optimizeBio(input: BioInput): Promise<BioResult> {
  if (isLiveKey) {
    try {
      return await optimizeWithGemini(input);
    } catch (error) {
      console.warn('[bioEngine] live optimize failed — falling back to simulation', error);
    }
  }
  return simulateBio();
}

// ---------------------------------------------------------------------------
// Live path — Gemini text with a structured JSON response schema
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are RizzCoach's Bio Lab — an elite dating-profile copywriter. Given a user's interests, a target vibe, and optionally their current bio, write exactly 3 dating-app bios, each a distinct style:

1. tone "Playful", label "Playful & Witty" — fun, teasing, self-aware, makes them smile.
2. tone "Sincere", label "Sincere & Charming" — warm, genuine, quietly confident, easy to reply to.
3. tone "Mysterious", label "Short & Mysterious" — punchy, intriguing, leaves them wanting more.

Rules: each bio is 1-3 short sentences (the Mysterious one can be a single line), written in first person, and sounds like a real human under 35. Weave the given interests in naturally — never just list them. Match the requested vibe. If a current bio is provided, keep what works and elevate the rest. Use tasteful emoji only where it lands. Avoid clichés ("love to laugh", "partner in crime", "fluent in sarcasm"). Never invent specific facts (job, city, age, height) the user did not give. Never be creepy, arrogant, or sexually explicit.`;

const RESULT_SCHEMA = {
  type: 'OBJECT',
  required: ['bios'],
  properties: {
    bios: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['id', 'tone', 'label', 'text'],
        properties: {
          id: { type: 'STRING', enum: ['a', 'b', 'c'] },
          tone: { type: 'STRING', enum: ['Playful', 'Sincere', 'Mysterious'] },
          label: { type: 'STRING' },
          text: { type: 'STRING' },
        },
      },
    },
  },
} as const;

function buildUserPrompt({ interests, vibe, currentBio }: BioInput): string {
  const bio = currentBio?.trim();
  return [
    `Interests: ${interests.join(', ')}`,
    `Target vibe: ${vibe}`,
    `Current bio: ${bio ? `"${bio}"` : 'none provided'}`,
    'Write the 3 optimized bios.',
  ].join('\n');
}

async function optimizeWithGemini(input: BioInput): Promise<BioResult> {
  const parsed = await callGemini<Omit<BioResult, 'id' | 'createdAt'>>({
    system: SYSTEM_PROMPT,
    parts: [{ text: buildUserPrompt(input) }],
    schema: RESULT_SCHEMA,
    maxOutputTokens: 4096,
    temperature: 1.0,
  });
  return { ...parsed, id: uid(), createdAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Simulation path — offline demo mode
// ---------------------------------------------------------------------------

type BioSeed = Omit<BioResult, 'id' | 'createdAt'>;

const MOCK_BIOS: BioSeed[] = [
  {
    bios: [
      {
        id: 'a',
        tone: 'Playful',
        label: 'Playful & Witty',
        text: "I'll trade you my best coffee-shop recommendation for your worst hiking story ⛰️ Warning: I take both very seriously.",
      },
      {
        id: 'b',
        tone: 'Sincere',
        label: 'Sincere & Charming',
        text: 'Happiest halfway up a trail or three chapters into a good book. Looking for someone to swap playlists and slow Sundays with.',
      },
      {
        id: 'c',
        tone: 'Mysterious',
        label: 'Short & Mysterious',
        text: 'Mountains, good coffee, better questions. Ask me the third one. ☕',
      },
    ],
  },
  {
    bios: [
      {
        id: 'a',
        tone: 'Playful',
        label: 'Playful & Witty',
        text: "Gym in the morning, tacos by night — I contain multitudes 🌮 Fluent in dog and mediocre at karaoke.",
      },
      {
        id: 'b',
        tone: 'Sincere',
        label: 'Sincere & Charming',
        text: "I build things for a living and cook when I'm stressed, so you'll never go hungry. Show me the music that means something to you.",
      },
      {
        id: 'c',
        tone: 'Mysterious',
        label: 'Short & Mysterious',
        text: 'Two rescue dogs, one good record player, zero small talk. 🎵',
      },
    ],
  },
];

let rotation = Math.floor(Math.random() * MOCK_BIOS.length);

async function simulateBio(): Promise<BioResult> {
  // ~7s so the staged writing animation gets its moment.
  await wait(BIO_STAGES.length * 1600 + 800);
  const seed = MOCK_BIOS[rotation % MOCK_BIOS.length];
  rotation += 1;
  const clone = JSON.parse(JSON.stringify(seed)) as BioSeed;
  return { ...clone, id: uid(), createdAt: Date.now() };
}
