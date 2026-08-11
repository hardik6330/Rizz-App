/**
 * Demo-mode seed rotation, shared by the engines that have more than one seed.
 *
 * Each engine wrote this out itself — a module-level `rotation`, a modulo index
 * and a JSON round-trip to clone. The clone is the part worth centralising: a
 * seed handed out by reference gets mutated by whatever renders it, and the next
 * pass through the demo shows the damage.
 */

/**
 * Returns a function handing back the next seed, deep-cloned, on every call.
 *
 * Starts at a random offset so two installs demoing side by side do not show the
 * same seed first. `[T, ...T[]]` makes an empty seed list a compile error rather
 * than an `undefined` in the offline demo.
 *
 * JSON round-trip rather than `structuredClone`: the seeds are plain JSON by
 * construction, and this is what shipped before.
 */
export function seedRotator<T>(seeds: readonly [T, ...T[]]): () => T {
  let rotation = Math.floor(Math.random() * seeds.length);
  return () => {
    const seed = seeds[rotation % seeds.length];
    rotation += 1;
    return JSON.parse(JSON.stringify(seed)) as T;
  };
}
