import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { COACH_APPS, COACH_STRUGGLES, COACH_STYLES } from '../ai/prompts.ts';
import { db } from '../db/client.ts';
import { log } from './logger.ts';

/**
 * Everything that touches `users.coach_json`, in one file.
 *
 * It lived in `routes/ai.ts` while that was the only writer. It stopped being
 * the only writer when `POST /v1/user/coach` was added, and the two disagreed:
 * this schema takes closed enums, that route took `z.string().max(64)`, and
 * neither knew the other existed. One column with two validators is a bug
 * waiting for whichever route the client happens to hit first.
 */

/**
 * The onboarding answers, optional everywhere.
 *
 * Closed enums, not strings — see the note on `coachParts` in ai/prompts.ts.
 * Anything the client sends that is not on these lists is dropped by zod before
 * it can reach a prompt, so an old build sending a since-renamed value degrades
 * to "no preferences" rather than 400ing a paying user's analysis.
 */
export const Coach = z
  .object({
    apps: z.array(z.enum(COACH_APPS)).max(COACH_APPS.length).optional(),
    struggle: z.enum(COACH_STRUGGLES).optional(),
    style: z.enum(COACH_STYLES).optional(),
  })
  .optional()
  .catch(undefined);

/**
 * Remember the answers on the account, so they survive a reinstall and so
 * `/v1/ai/chat` — whose caller is native and cannot send them — has something to
 * read. See migration 0010.
 *
 * Opportunistic on the AI routes: written as a side effect of the requests that
 * already carry it, rather than by an endpoint the client has to remember to
 * call. Three engines send it on every analysis, so the row converges on the
 * truth without a sync protocol. `POST /v1/user/coach` calls the same function
 * so the onboarding screen writes through exactly the same guards.
 *
 * The `<>` predicate is what keeps this from being a write per request: the
 * answers change roughly never, so after the first one MySQL matches no rows and
 * does no work. And it NEVER fails the request — a personalisation that did not
 * persist is not a reason to lose an analysis the user has already been charged
 * for, so the error is logged and swallowed.
 *
 * Returns whether the row now holds these answers, for the one caller
 * (`/v1/user/coach`) that has nothing else to report.
 */
export async function rememberCoach(userId: string, coach: unknown): Promise<boolean> {
  if (!coach) return false;
  const json = JSON.stringify(coach);
  // The column is VARCHAR(255) and the enums cannot reach it — but a silent
  // truncation would store JSON that no longer parses, so bail rather than write.
  if (json.length > 255) return false;
  try {
    await db.execute(sql`
      UPDATE users SET coach_json = ${json}
       WHERE id = ${userId} AND (coach_json IS NULL OR coach_json <> ${json})
    `);
    return true;
  } catch (err) {
    log.error('coach.save_failed', err);
    return false;
  }
}

/**
 * The stored answers, validated. For the engines whose caller cannot send them.
 *
 * Re-validated against the same zod enums as the wire input rather than trusted:
 * the row was written by an earlier build of the app, and a value that has since
 * been renamed must degrade to "no preferences" instead of reaching a prompt as
 * a string nothing maps. `Coach` carries `.catch(undefined)`, so the only thing
 * that can throw here is `JSON.parse`.
 */
export function storedCoach(raw: string | null): z.infer<typeof Coach> {
  if (!raw) return undefined;
  try {
    return Coach.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
