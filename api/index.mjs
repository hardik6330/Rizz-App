/*
 * Vercel serves functions from `/api` relative to the project root, and the
 * project root here must be the REPO root — `backend/src/lib/limits.ts`
 * re-exports the app's `src/state/limits.ts`, which a Root Directory of
 * `backend/` would put outside the build context.
 *
 * Plain .mjs, and one line, on purpose. Vercel discovers functions by scanning
 * `api/` in the SOURCE tree, so this file has to exist in git before the build
 * runs — a generated entrypoint is never found. It must also contain no
 * TypeScript and no `.ts` import specifier, because Vercel's per-file transpile
 * leaves specifiers alone and Node then cannot resolve them.
 *
 * `backend/dist/vercel.mjs` is the esbuild bundle, written by the buildCommand in
 * vercel.json. It is gitignored; Vercel's tracer picks it up after the build.
 */
export { default } from '../backend/dist/vercel.mjs';
