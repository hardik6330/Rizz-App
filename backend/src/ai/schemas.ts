import { LAB_MODE_SECTIONS, type EngineMode } from './prompts.ts';

/**
 * Gemini `responseSchema` definitions (OpenAPI subset, uppercase types), lifted
 * verbatim from the client engines alongside their prompts.
 *
 * Schema-forced JSON is why the engines can `JSON.parse` without a repair step.
 * Keep the shapes identical to `src/types.ts` — the client parses these into
 * `AnalysisResult` / `ProfileScanResult` / `BioResult` with no adapter layer.
 */

const SECTION_SCHEMAS = {
  // First in the object AND first in every mode's `required` list: Gemini emits
  // properties in that order, so transcribing the last message happens before
  // the replies are written, not after. That ordering IS the grounding.
  read: {
    type: 'OBJECT',
    required: ['lastMessage', 'lastFrom', 'thread'],
    properties: {
      lastMessage: { type: 'STRING', description: 'verbatim, the last message in the screenshot' },
      lastFrom: { type: 'STRING', enum: ['them', 'you'] },
      thread: { type: 'STRING', description: 'one line: what the chat is about right now' },
    },
  },
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

/** Only the sections the requested mode renders — the client's token saving, kept. */
export function labSchema(mode: EngineMode) {
  const keys = LAB_MODE_SECTIONS[mode];
  return {
    type: 'OBJECT',
    required: keys,
    properties: Object.fromEntries(keys.map((k) => [k, SECTION_SCHEMAS[k]])),
  };
}

const SCORE = {
  type: 'OBJECT',
  required: ['score', 'note'],
  properties: {
    score: { type: 'INTEGER', description: '0-10' },
    note: { type: 'STRING' },
  },
} as const;

export const PROFILE_SCHEMA = {
  type: 'OBJECT',
  required: [
    'isProfile',
    'summary',
    'swipeStopper',
    'intentClarity',
    'workingAndFix',
    'bioLines',
    'quickWin',
    'photoTuneUp',
    'competition',
  ],
  properties: {
    isProfile: { type: 'BOOLEAN' },
    rejectionReason: { type: 'STRING' },
    name: { type: 'STRING' },
    tagline: { type: 'STRING' },
    summary: { type: 'STRING' },
    swipeStopper: SCORE,
    intentClarity: SCORE,
    workingAndFix: { type: 'ARRAY', items: { type: 'STRING' } },
    bioLines: { type: 'ARRAY', items: { type: 'STRING' } },
    quickWin: { type: 'STRING' },
    photoTuneUp: { type: 'ARRAY', items: { type: 'STRING' } },
    competition: { type: 'ARRAY', items: { type: 'STRING' } },
  },
} as const;

export const BIO_SCHEMA = {
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

export const FEED_SCHEMA = {
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

export const CHAT_SCHEMA = {
  type: 'OBJECT',
  required: ['reply'],
  properties: { reply: { type: 'STRING' } },
} as const;
