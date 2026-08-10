import assert from 'node:assert/strict';

import { assertSafetyRails, coachParts, type CoachProfile } from './prompts.ts';

/**
 * `coachParts` is what makes the onboarding questions worth asking — if it
 * silently returns nothing, the quiz still runs, still stores answers, and the
 * model never sees them. That failure is invisible: the app works, the output
 * is just generic. Hence a check.
 *
 * Run: `node --import tsx src/ai/prompts.selfcheck.ts`
 */

// Nothing known → nothing said. An empty preferences block invites the model to
// invent a user, which is worse than no block at all.
assert.equal(coachParts(undefined).length, 0, 'undefined coach must add no parts');
assert.equal(coachParts({}).length, 0, 'empty coach must add no parts');
assert.equal(coachParts({ apps: [] }).length, 0, 'empty app list must add no parts');

const full: CoachProfile = { apps: ['tinder', 'whatsapp'], struggle: 'asking_out', style: 'dry' };
const [part] = coachParts(full);
assert.ok(part, 'a full coach profile must produce one part');
assert.match(part.text, /Tinder, WhatsApp/, 'apps render as display labels');
assert.match(part.text, /meeting up/, 'struggle changes the instruction, not just the label');
assert.match(part.text, /deadpan/, 'style changes the instruction, not just the label');
assert.match(part.text, /not facts about anything in the image/, 'must be framed as preferences');

// One answer is enough — a user who skips two questions still gets the third.
const [styleOnly] = coachParts({ style: 'short' });
assert.ok(styleOnly, 'a single answer still personalises');
assert.doesNotMatch(styleOnly.text, /messaging on/, 'no apps → no apps line');

// The rails guard is the reason this file's sibling exists; assert it still runs.
assert.doesNotThrow(assertSafetyRails, 'them-mode safety rails must be intact');

console.log('prompts.selfcheck ok');
