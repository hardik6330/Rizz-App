import assert from 'node:assert/strict';

import { assertSafetyRails, chatPrompt, coachParts, type CoachProfile } from './prompts.ts';

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

/*
 * The chat prompt's three load-bearing instructions.
 *
 * This is the only engine whose output is never seen before it is used: the
 * reply goes straight to the clipboard and the user pastes and sends it. So the
 * failure modes are silent and they land in someone's real conversation — a
 * message written ABOUT the user instead of AS them, a reply aimed at the wrong
 * side of the thread, or a paragraph three registers above how the user actually
 * writes. None of those throw, and none show up in a log.
 */
const chat = chatPrompt('');
assert.match(chat, /YOU ARE WRITING AS THE USER/, 'the reply is sent as the user, not advice about them');
assert.match(chat, /FIRST PERSON/, 'first person, addressed to the other person');
assert.match(chat, /WHICH SIDE IS WHICH/, 'the side anchor survives — the tags come from a heuristic');
assert.match(chat, /LAST line of the transcript/, 'the fallback when the side tags are inverted');
assert.match(chat, /MATCH THE USER'S ACTUAL VOICE/, "the user's own lines are the voice reference");
assert.match(chat, /the transcript wins/, 'observed style outranks the stored onboarding enum');

// A tone is appended, never substituted: dropping the base would take all three
// rules above with it and nothing downstream would notice.
const roast = chatPrompt('roast');
assert.ok(roast.startsWith(chat), 'a tone extends the base prompt rather than replacing it');
assert.match(roast, /ROAST/, 'the requested tone reaches the model');
assert.equal(chatPrompt('nonsense'), chat, 'an unknown tone falls back to the base, not to an empty rule set');

console.log('prompts.selfcheck ok');
