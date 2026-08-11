/**
 * `users.coach_json` had two validators and two writers before P2 — the AI
 * routes took closed enums, `POST /v1/user/coach` took `z.string().max(64)` and
 * wrote the column itself. These assertions are what keeps them one.
 *
 * Run: node --env-file=.env --import tsx src/lib/coach.selfcheck.ts
 * No DB and no network: `rememberCoach` is the only part that talks to MySQL,
 * and what is worth pinning here is what it will and will not be handed.
 */
import assert from 'node:assert/strict';

import { COACH_APPS, COACH_STRUGGLES, COACH_STYLES } from '../ai/prompts.ts';
import { Coach, storedCoach } from './coach.ts';

const valid = { apps: ['tinder', 'hinge'], struggle: 'opening', style: 'dry' };

// The happy path both routes rely on.
assert.deepEqual(Coach.parse(valid), valid);

// Values off the enum degrade to "no preferences" rather than reaching a prompt
// as a string nothing maps. This is the case the old `/v1/user/coach` accepted.
assert.equal(Coach.parse({ ...valid, style: 'shakespearean' }), undefined);
assert.equal(Coach.parse({ ...valid, struggle: 'ghosting' }), undefined);
assert.equal(Coach.parse({ apps: ['myspace'], struggle: 'opening', style: 'dry' }), undefined);

// `.catch(undefined)` means malformed input never throws — the route turns the
// undefined into a 400 itself.
assert.equal(Coach.parse(null), undefined);
assert.equal(Coach.parse('nope'), undefined);

/*
 * The column is VARCHAR(255). Every value the enums permit, all at once, must
 * still fit — otherwise MySQL truncates mid-string and every later read fails to
 * parse, silently dropping the user's personalisation until they re-onboard.
 *
 * Adding an app or lengthening a style key is what would break this, and it will
 * break here rather than in production.
 */
const largest = JSON.stringify({
  apps: COACH_APPS,
  struggle: [...COACH_STRUGGLES].sort((a, b) => b.length - a.length)[0],
  style: [...COACH_STYLES].sort((a, b) => b.length - a.length)[0],
});
assert.ok(
  largest.length <= 255,
  `widest possible coach_json is ${largest.length} chars — VARCHAR(255) will truncate it`,
);

// A row written by an older build survives a rename as "no preferences", and an
// unparseable row (the old truncation bug) never throws on read.
assert.deepEqual(storedCoach(JSON.stringify(valid)), valid);
assert.equal(storedCoach('{"style":"gone"}'), undefined);
assert.equal(storedCoach('{"apps":["tinder"'), undefined);
assert.equal(storedCoach(null), undefined);

console.log(`coach.selfcheck: ok — widest coach_json ${largest.length}/255 chars`);
