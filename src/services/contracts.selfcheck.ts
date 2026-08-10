/**
 * Runnable self-check for the API response guards.
 *   node src/services/contracts.selfcheck.ts
 *
 * The guards exist to catch a server contract drift the client cannot see, so
 * the cases that matter are the near-misses: a renamed field, a section that
 * came back empty, a number that arrived as a string. Each of those used to
 * render as a blank card.
 */
import assert from 'node:assert/strict';

import { isValidResult } from './contracts.ts';

const ok = (path: string, result: unknown, why: string) =>
  assert.equal(isValidResult(path, result), true, `should PASS: ${why}`);
const bad = (path: string, result: unknown, why: string) =>
  assert.equal(isValidResult(path, result), false, `should FAIL: ${why}`);

// ── Lab ─────────────────────────────────────────────────────────────────────
const read = { lastMessage: 'hey', lastFrom: 'them', thread: 'small talk' };
const replies = [{ id: 'a', style: 'Smooth', text: 'hi', spice: 1 }];

ok('/v1/ai/lab', { read, replies }, 'rizz mode: read + replies');
ok(
  '/v1/ai/lab',
  { read, vibe: { persona: 'p', emoji: '🙂', interest: 70, traits: [], redFlags: [], verdict: 'v', confidence: 80 } },
  'vibe mode carries no replies — sections are scoped by mode',
);
ok('/v1/ai/lab', { read, roast: { text: 'oof', brutality: 4, tagline: 't' } }, 'roast mode');

bad('/v1/ai/lab', { replies }, 'no `read` — the grounding is required in every mode');
bad('/v1/ai/lab', { read }, 'read but no section at all: a quote card above nothing');
bad('/v1/ai/lab', { read, replies: [] }, 'an empty replies array renders three blank cards');
bad('/v1/ai/lab', { read, replies: [{ id: 'a', style: 'Smooth' }] }, 'a reply with no text');
bad('/v1/ai/lab', { read: { lastMessage: 'hey' }, replies }, 'read missing `thread`');
bad('/v1/ai/lab', null, 'not an object');

// ── Profile Scan ────────────────────────────────────────────────────────────
const report = {
  isProfile: true,
  summary: 's',
  swipeStopper: { score: 7, note: 'n' },
  intentClarity: { score: 6, note: 'n' },
  workingAndFix: ['a'],
  bioLines: ['b'],
  quickWin: 'q',
  photoTuneUp: ['p'],
  competition: ['c'],
};

ok('/v1/ai/profile', report, 'a full report');
ok('/v1/ai/profile', { ...report, name: 'Sam', tagline: 'GJ 21' }, 'optional fields present');
ok(
  '/v1/ai/profile',
  { isProfile: false, rejectionReason: 'that is a receipt' },
  'a rejection carries none of the report and must still pass — the credit is refunded',
);

bad('/v1/ai/profile', { ...report, isProfile: undefined }, 'isProfile missing');
bad('/v1/ai/profile', { ...report, swipeStopper: { score: '7', note: 'n' } }, 'score as a string');
bad('/v1/ai/profile', { ...report, swipeStopper: { note: 'n' } }, 'a score slot with no score');
bad('/v1/ai/profile', { ...report, bioLines: [1, 2] }, 'bioLines that are not strings');
bad('/v1/ai/profile', { ...report, quickWin: undefined }, 'a renamed/dropped field');

// ── Bio ─────────────────────────────────────────────────────────────────────
const bios = [{ id: 'a', tone: 'Playful', label: 'Playful & Witty', text: 'hi' }];
ok('/v1/ai/bio', { bios }, 'three cards worth of bios');
bad('/v1/ai/bio', { bios: [] }, 'no bios at all');
bad('/v1/ai/bio', { bios: [{ id: 'a', tone: 'Playful' }] }, 'a bio with no text to render');
bad('/v1/ai/bio', {}, 'the whole array missing');

// ── Feed ────────────────────────────────────────────────────────────────────
ok('/v1/ai/feed', { lines: [{ text: 'hey', category: 'Opener' }] }, 'a day of lines');
bad('/v1/ai/feed', { lines: [] }, 'an empty feed');
bad('/v1/ai/feed', { lines: [{ text: 'hey' }] }, 'a line with no category to file it under');

// ── Unknown routes ──────────────────────────────────────────────────────────
ok('/v1/ai/whatever', { anything: true }, 'a new engine is not blocked by a guard nobody wrote');

console.log('api contracts: ok');
