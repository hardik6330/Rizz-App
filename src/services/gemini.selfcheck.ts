/**
 * Runnable self-check for the shared Gemini client.
 *   node --env-file=.env src/services/gemini.selfcheck.ts
 *
 * Pure checks always run. The network check runs only with a live key and makes
 * one real (tiny) API call.
 *
 * The network check deliberately uses a SMALL maxOutputTokens: that is exactly
 * what exposed the original bug — with thinking left on, the model spent ~188
 * tokens thinking, returned finishReason MAX_TOKENS, and the truncated JSON blew
 * up JSON.parse. If someone removes `thinkingConfig`, this check fails loudly
 * instead of the app silently serving mock data.
 */
import assert from 'node:assert/strict';

import { callGemini, imagePart, isLiveKey } from './gemini.ts';

// --- pure: mime clamping -----------------------------------------------------
assert.deepEqual(imagePart('QUJD', 'image/png'), {
  inlineData: { mimeType: 'image/png', data: 'QUJD' },
});
assert.deepEqual(imagePart('QUJD', 'image/heic'), {
  inlineData: { mimeType: 'image/heic', data: 'QUJD' },
});
// Unsupported types clamp to jpeg rather than erroring the whole request.
assert.deepEqual(imagePart('QUJD', 'image/gif'), {
  inlineData: { mimeType: 'image/jpeg', data: 'QUJD' },
});
assert.deepEqual(imagePart('QUJD', ''), {
  inlineData: { mimeType: 'image/jpeg', data: 'QUJD' },
});
console.log('✅ imagePart clamping OK');

// --- network: auth + model + thinking fix + schema + parse -------------------
if (!isLiveKey) {
  console.log('⏭  no live key — skipped the network check');
  process.exit(0);
}

const result = await callGemini<{ ok: boolean; word: string }>({
  system: 'You reply only in the given JSON schema.',
  parts: [{ text: 'Set ok to true and word to "pong".' }],
  schema: {
    type: 'OBJECT',
    required: ['ok', 'word'],
    properties: { ok: { type: 'BOOLEAN' }, word: { type: 'STRING' } },
  },
  maxOutputTokens: 200, // small on purpose — fails if thinking is ever re-enabled
  temperature: 0,
});

assert.equal(typeof result.ok, 'boolean', 'schema field ok should be a boolean');
assert.equal(typeof result.word, 'string', 'schema field word should be a string');
console.log('✅ gemini client self-check passed —', JSON.stringify(result));
