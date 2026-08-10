/**
 * What the server is required to have sent back, checked before anything renders.
 *
 * `src/types.ts` and `backend/src/ai/schemas.ts` describe the same four payloads
 * in two languages, kept in step by hand — and `callApi<T>` only ever *cast* the
 * response, so nothing enforced it. They also ship on different schedules: the
 * backend deploys separately from an OTA, and an installed build cannot be rolled
 * back. A field renamed or dropped server-side therefore reached the renderers as
 * `undefined` and painted blank cards, with no error anywhere.
 *
 * These guards close that. They are hand-written rather than zod because the only
 * thing needed is "did the shape we render survive the trip" — a schema library
 * would be a new dependency in the bundle to answer a yes/no question.
 *
 * **Check only what a renderer dereferences unconditionally.** A guard stricter
 * than the UI turns a cosmetic server change into a hard failure for the user;
 * a guard looser than the UI is the blank card we started with. Optional fields
 * (`name`, `tagline`, `rejectionReason`) are deliberately unchecked.
 *
 * On failure `callApi` throws `ApiError('SCHEMA')`, which lands in the mock
 * fallback every engine already has — so the user sees a visibly canned result
 * and a toast rather than an empty report, and Crashlytics gets the trace.
 */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/** A `{ score, note }` slot. Both are rendered directly. */
const isScore = (v: unknown): boolean => isObj(v) && isNum(v.score) && isStr(v.note);

/**
 * Lab. Sections are scoped by mode — asking for all four burned ~3x the output
 * tokens — so `replies` / `vibe` / `roast` are each optional and only checked
 * when present. `read` is not optional: it is first in every mode's `required`
 * list server-side, and it is the grounding the whole engine is built around.
 */
function checkLab(r: Record<string, unknown>): boolean {
  const read = r.read;
  if (!isObj(read) || !isStr(read.lastMessage) || !isStr(read.thread)) return false;

  if (r.replies !== undefined) {
    if (!Array.isArray(r.replies) || r.replies.length === 0) return false;
    if (!r.replies.every((x) => isObj(x) && isStr(x.id) && isStr(x.style) && isStr(x.text))) {
      return false;
    }
  }
  if (r.vibe !== undefined) {
    const v = r.vibe;
    if (!isObj(v) || !isStr(v.persona) || !isNum(v.interest) || !isStr(v.verdict)) return false;
    if (!isStrArray(v.traits) || !isStrArray(v.redFlags)) return false;
  }
  if (r.roast !== undefined) {
    const roast = r.roast;
    if (!isObj(roast) || !isStr(roast.text) || !isNum(roast.brutality)) return false;
  }
  // At least one section, or the Lab renders a quote card above nothing.
  return r.replies !== undefined || r.vibe !== undefined || r.roast !== undefined;
}

/**
 * Profile Scan. A rejection is a valid, fully-formed answer that carries none of
 * the report — `isProfile: false` is checked before anything else is read, and
 * the credit is refunded server-side — so it must pass without the rest.
 */
function checkProfile(r: Record<string, unknown>): boolean {
  if (typeof r.isProfile !== 'boolean') return false;
  if (!r.isProfile) return true;

  return (
    isStr(r.summary) &&
    isScore(r.swipeStopper) &&
    isScore(r.intentClarity) &&
    isStrArray(r.workingAndFix) &&
    isStrArray(r.bioLines) &&
    isStr(r.quickWin) &&
    isStrArray(r.photoTuneUp) &&
    isStrArray(r.competition)
  );
}

/** Bio. Three cards, each of which renders label, tone and text. */
function checkBio(r: Record<string, unknown>): boolean {
  const { bios } = r;
  if (!Array.isArray(bios) || bios.length === 0) return false;
  return bios.every((b) => isObj(b) && isStr(b.id) && isStr(b.tone) && isStr(b.label) && isStr(b.text));
}

/**
 * Feed. `feedEngine` maps these into `FeedItem`s and supplies the visuals
 * itself, so only the fields it reads off the wire are checked here.
 */
function checkFeed(r: Record<string, unknown>): boolean {
  const { lines } = r;
  if (!Array.isArray(lines) || lines.length === 0) return false;
  return lines.every((l) => isObj(l) && isStr(l.text) && isStr(l.category));
}

const CHECKS: Record<string, (r: Record<string, unknown>) => boolean> = {
  '/v1/ai/lab': checkLab,
  '/v1/ai/profile': checkProfile,
  '/v1/ai/bio': checkBio,
  '/v1/ai/feed': checkFeed,
};

/**
 * True when `result` is safe to render for `path`.
 *
 * An unknown path passes: a new engine should not be blocked by a guard nobody
 * has written yet, and forgetting one is a silent no-op rather than an outage.
 */
export function isValidResult(path: string, result: unknown): boolean {
  const check = CHECKS[path];
  if (!check) return true;
  return isObj(result) && check(result);
}
