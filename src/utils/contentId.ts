/**
 * A stable id derived from the text itself. **Use this for anything savable.**
 *
 * `uid()` mints a fresh id every call, which is correct for a throwaway list key
 * and wrong for anything the user can save: a vault id IS the server's primary
 * key, and `POST /v1/user/vault` upserts on it. Give the same line a new id on a
 * refetch and the upsert inserts instead of updating — the user sees the line
 * unsaved, taps save again, and ends up with two identical rows they have to
 * delete twice. That is exactly what happened to the daily feed, whose lines are
 * generated once globally per day but were decorated with `uid()` per fetch.
 *
 * Same text in, same id out, on every device and every launch — which is what
 * makes saving idempotent all the way to the database.
 *
 * FNV-1a, twice, at different offsets, concatenated to 64 bits. Not a hash for
 * anything that matters against an adversary; a collision here would merge two
 * distinct lines into one vault row, and 64 bits makes that not happen across a
 * feed of tens of items. Deliberately NOT `expo-crypto`: that is native, so it
 * would turn every id change into a rebuild rather than an OTA.
 */
export function contentId(prefix: string, text: string): string {
  const fnv = (seed: number): string => {
    let h = seed;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      // The FNV prime, via shifts: `h * 16777619` overflows past 2^53 and starts
      // losing low bits, which is where the collisions would come from.
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return h.toString(36).padStart(7, '0');
  };
  return `${prefix}-${fnv(0x811c9dc5)}${fnv(0x01000193)}`;
}
