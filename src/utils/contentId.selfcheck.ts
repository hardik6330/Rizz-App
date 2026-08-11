/**
 * `contentId()` is what makes saving idempotent all the way to the database.
 *
 * A vault id is the server's PRIMARY KEY and `POST /v1/user/vault` upserts on
 * it, so "same text ⇒ same id" is not a nicety — it is the difference between
 * re-saving a line and inserting a duplicate row the user has to delete twice.
 * That bug shipped once, via `uid()` on the daily feed. These assertions are
 * what stops it shipping again.
 *
 * Run: node src/utils/contentId.selfcheck.ts
 */
import assert from 'node:assert/strict';

import { contentId } from './contentId.ts';

const line = "Okay, settle a debate for me: is matcha actually good or do people just like green?";

// The property the whole fix rests on: stable across calls, and therefore across
// refetches, launches, sign-outs and devices.
assert.equal(contentId('ai', line), contentId('ai', line));

// Different lines must not collide — a collision would merge two distinct lines
// into one vault row, which looks to the user like a save that silently ate
// something else.
const seen = new Map();
for (const text of [
  line,
  line + '.',
  line.toUpperCase(),
  line.slice(0, -1),
  'Bold of you to have a personality this good and expect me to play it cool.',
  'I have a strict no-small-talk policy.',
  '',
  'a',
  'b',
]) {
  const id = contentId('ai', text);
  assert.ok(!seen.has(id), `collision: ${JSON.stringify(text)} vs ${JSON.stringify(seen.get(id))}`);
  seen.set(id, text);
}

// The prefix separates namespaces, so a feed line and a future prefixed id built
// from identical text cannot land on the same primary key.
assert.notEqual(contentId('ai', line), contentId('bio', line));

// `saved_items.id` is VARCHAR(64) and the client mints it — an id that overflows
// would be truncated by MySQL into a key that no longer matches what the device
// holds, which is the same duplicate-row bug wearing a different hat.
assert.ok(contentId('ai', line).length <= 64, 'id must fit saved_items.id');

// Order matters to the hash — an anagram is a different line.
assert.notEqual(contentId('ai', 'ab'), contentId('ai', 'ba'));

console.log(`contentId.selfcheck: ok — ${seen.size} ids, no collisions, len ${contentId('ai', line).length}/64`);
