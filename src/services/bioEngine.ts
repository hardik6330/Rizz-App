import { coachPayload } from '@/state/useRizzStore';
import type { BioInput, BioResult } from '@/types';
import { uid, wait } from '@/utils/misc';
import { callApi, isLiveApi } from './api';

/**
 * The Bio Optimizer engine.
 *
 * Without `EXPO_PUBLIC_API_URL` it returns rotating hand-written bios so the
 * tool is demoable offline. Shared transport lives in `api.ts`; the system
 * prompt and response schema moved to the server with the Gemini key.
 */

/** Staged status copy shown while a bio is being written. */
export const BIO_STAGES = [
  'Reading your interests…',
  'Finding your angle…',
  'Writing three drafts…',
  'Polishing the hooks…',
];

/**
 * Mock seeds are DEMO MODE ONLY. A live failure throws — see profileEngine.ts.
 * This one had no tell at all: three canned bios about hiking and coffee look
 * exactly like three generated ones, whatever the user actually typed.
 * `bio.tsx` already catches and toasts.
 */
export async function optimizeBio(input: BioInput): Promise<BioResult> {
  if (!isLiveApi) return simulateBio();
  return optimizeViaApi(input);
}

// ---------------------------------------------------------------------------
// Live path — POST /v1/ai/bio
// ---------------------------------------------------------------------------

async function optimizeViaApi({ interests, vibe, currentBio }: BioInput): Promise<BioResult> {
  const parsed = await callApi<Omit<BioResult, 'id' | 'createdAt'>>('/v1/ai/bio', {
    interests,
    vibe,
    current_bio: currentBio?.trim() || undefined,
    coach: coachPayload(),
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
