import assert from 'node:assert/strict';

import { resizeFor } from './resizeFor.ts';

/**
 * The resize decision in `prepareImage`. Run: node src/utils/resizeFor.selfcheck.ts
 *
 * Guards two things that are easy to get backwards and silent when you do:
 * enlarging an image that was already small (a bigger payload than we started
 * with), and capping the wrong axis on a portrait screenshot (which is every
 * screenshot this app takes, so it would have left the payload untouched).
 */

// The case that caused the bug: a 6.9" iPhone screenshot. Portrait, so the cap
// lands on HEIGHT — capping width here would change almost nothing.
assert.deepEqual(resizeFor(1290, 2796), { height: 2048 }, 'iPhone 15 Pro Max screenshot');
assert.deepEqual(resizeFor(1170, 2532), { height: 2048 }, 'iPhone 13/14 screenshot');
assert.deepEqual(resizeFor(750, 1334), null, 'iPhone SE screenshot is already under the cap');

// Landscape and square take the other branch.
assert.deepEqual(resizeFor(4032, 3024), { width: 2048 }, 'landscape photo caps width');
assert.deepEqual(resizeFor(3000, 3000), { width: 2048 }, 'square caps width (>= wins)');

// Downscale only — never enlarge.
assert.equal(resizeFor(400, 300), null, 'small image is left alone');
assert.equal(resizeFor(2048, 1024), null, 'exactly at the cap is left alone');
assert.deepEqual(resizeFor(2049, 1024), { width: 2048 }, 'one pixel over does resize');

// Degenerate metadata must not produce a resize to NaN.
for (const [w, h] of [[0, 0], [-1, 100], [NaN, 100], [100, NaN]]) {
  assert.equal(resizeFor(w, h), null, `degenerate ${w}x${h} is left alone`);
}

// The whole point: the result is meaningfully smaller than the input.
const shot = resizeFor(1290, 2796);
assert.ok(shot && 'height' in shot);
const scale = shot.height / 2796;
assert.ok(scale < 0.8, `must actually shrink — got ${(scale * 100).toFixed(0)}%`);
assert.ok(scale > 0.6, `must not shrink so far that chat text stops being legible — got ${(scale * 100).toFixed(0)}%`);

console.log(`resizeFor.selfcheck: ok — iPhone screenshot scales to ${(scale * 100).toFixed(0)}%`);
