/**
 * How long things take. Four roles, and the app had none.
 *
 * Twelve distinct durations were in the tree — 160, 220, 240, 250, 260, 280,
 * 300, 320, 420, 500, 600, 700 — chosen one call site at a time. Nobody decided
 * that a toast should take 250ms and a card 260ms; those are the same intention
 * typed twice. Colour, type, spacing and radii were all tokenised and this was
 * the last axis still being eyeballed.
 *
 * The roles are about PURPOSE, not length, which is what makes them pickable:
 *
 * - `instant` — confirming a touch. Below ~140ms reads as simultaneous with the
 *   finger, which is the entire job; anything slower feels like lag rather than
 *   feedback.
 * - `quick` — something small appearing or leaving that the user did not have to
 *   wait for. Toasts, chips, inline reveals.
 * - `standard` — the default. Screen content, cards, list rows.
 * - `deliberate` — the reveal the user has been waiting through a spinner for.
 *   Long enough to read as an arrival rather than a repaint. Used sparingly:
 *   the result, the paywall, a celebration.
 *
 * Exits are shorter than entrances on purpose — a thing leaving has already been
 * read, so its animation is pure cost. Use `EXIT` rather than inventing a number.
 */
export const duration = {
  instant: 120,
  quick: 200,
  standard: 280,
  deliberate: 420,
} as const;

/** One exit length for everything. See the note above. */
export const EXIT = 160;

/**
 * Stagger between siblings in a list that enters together.
 *
 * 60ms is the gap that reads as "authored in order" rather than as a slow list:
 * six replies finish 300ms after the first, which is inside the window where the
 * whole group still reads as one arrival.
 */
export const STAGGER = 60;

/**
 * Spring damping for entrances. Reanimated's default (10) overshoots enough to
 * look bouncy, which is the wrong register for a product whose claim is that it
 * is thinking. 18 settles in one motion.
 */
export const DAMPING = 18;

/**
 * ⚠️ **The welcome demo is deliberately NOT on this scale.** `screens/welcome/*`
 * is a scripted performance whose timings are choreographed against the phase
 * holds in `shared.tsx` — its 600ms and 700ms ripples are not durations anyone
 * failed to tokenise, they are the length of a beat. Retiming them to four
 * generic roles would desynchronise the demo to make a grep look tidy. Leave it.
 */
