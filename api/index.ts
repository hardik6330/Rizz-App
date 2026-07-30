/**
 * Vercel serves functions from `/api` relative to the project root — and the
 * project root here has to be the REPO root, not `backend/`.
 *
 * `backend/src/lib/limits.ts` re-exports `src/state/limits.ts` from the app, so
 * that one rule is never forked into two languages. Setting Vercel's Root
 * Directory to `backend` puts that file outside the build context and the deploy
 * fails to resolve it. Hence this three-line shim at the top level: the real
 * adapter lives in `backend/src/vercel.ts`, where `hono` resolves from
 * `backend/node_modules`.
 */
export { default } from '../backend/src/vercel.ts';
