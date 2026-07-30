import assert from 'node:assert/strict';

import { generate, imagePart, promptVersion } from './gateway.ts';
import { assertSafetyRails } from './prompts.ts';

/**
 * Live guard for the gateway. One tiny API call.
 *
 *   node --env-file=.env --import tsx src/ai/gateway.selfcheck.ts
 *
 * Replaces the client's `gemini.selfcheck.ts`, which was deleted with the
 * client's Gemini path. The thing it protects has not changed:
 * `thinkingConfig.thinkingLevel` is load-bearing, and when it breaks NOTHING
 * fails loudly — every engine catches the error and serves mock data, so the app
 * looks fine while the AI is off. That has happened twice.
 *
 * `maxOutputTokens` is deliberately small. Thinking tokens count against the
 * cap, so a tight budget is what makes the check sensitive: if the thinking
 * config regresses, thinking eats the budget, the JSON comes back truncated and
 * the parse throws — here, on purpose, instead of in production silently.
 */

assertSafetyRails();
console.log('✅ them-mode safety rails present');

// Derived, not declared — the same text must always produce the same version.
const a = promptVersion('You are a test prompt.');
assert.equal(a, promptVersion('You are a test prompt.'));
assert.notEqual(a, promptVersion('You are a test prompt!'));
assert.match(a, /^[0-9a-f]{8}$/);
console.log('✅ prompt versioning stable and content-derived');

// 1x1 red PNG — exercises the vision path without shipping a fixture file.
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const { data, usage } = await generate<{ ok: boolean; word: string }>({
  engine: 'selfcheck',
  system: 'Reply with ok=true and word="pong". Nothing else.',
  parts: [imagePart(PIXEL, 'image/png'), { text: 'ping' }],
  schema: {
    type: 'OBJECT',
    required: ['ok', 'word'],
    properties: { ok: { type: 'BOOLEAN' }, word: { type: 'STRING' } },
  },
  maxOutputTokens: 256,
  temperature: 0,
});

assert.equal(data.ok, true);
assert.equal(typeof data.word, 'string');

// Non-zero thoughts are EXPECTED — Gemini 3 cannot disable thinking, and 'low'
// means less, not none. This prints them so a regression is visible as a number
// rather than as a mystery truncation.
console.log(
  `✅ live call OK — out=${usage.outputTokens} thoughts=${usage.thoughtTokens} ${usage.latencyMs}ms`,
);
