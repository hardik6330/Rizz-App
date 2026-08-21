/**
 * The downscale decision for a picked image. Pure, and in its own module for
 * exactly one reason: `prepareImage.ts` imports `expo-image-manipulator`, which
 * Node cannot parse, so nothing in that file can have a selfcheck. This is the
 * half with the branches in it, so this is the half that gets tested.
 *
 * (Same constraint `theme/layout.ts` documents. There the answer was to leave the
 * arithmetic unguarded rather than duplicate it; here the split costs one file and
 * no duplication, so it is worth taking.)
 */

/**
 * Cap on the LONGEST edge — not the width.
 *
 * A chat screenshot is portrait (1290×2796 on a 6.9" iPhone), so capping width
 * would leave the pixel count essentially untouched, which is how you ship a
 * "downscale" that downscales nothing.
 *
 * 2048 rather than the 1280 that `backend/src/routes/ai.ts` used to claim,
 * because **this is not a cost optimisation and must not become one.** The model
 * has to read small chat text out of these; 1280 against a 2796px-tall screenshot
 * scales that text to 46%, which trades an outage for quietly worse answers.
 * 2048 is ~73%, roughly halves the pixels, and lands a screenshot comfortably
 * under the server's 4 MB base64 cap. Raise the cap before lowering this.
 */
export const MAX_EDGE = 2048;

/**
 * The resize to apply, or `null` for "leave it alone".
 *
 * One dimension only — the manipulator derives the other, and that is what
 * preserves the ratio. Returning `null` below the cap is the downscale-only
 * guard: asking for `width: 2048` on a 400px thumbnail would ENLARGE it and hand
 * the server a bigger payload than it started with.
 */
export function resizeFor(
  width: number,
  height: number,
): { width: number } | { height: number } | null {
  // `!(x > 0)` rather than `x <= 0` so NaN is caught too.
  if (!(width > 0) || !(height > 0)) return null;
  if (Math.max(width, height) <= MAX_EDGE) return null;
  return width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE };
}
