/**
 * The only place this service writes logs, and it takes a typed event rather
 * than a string — on purpose.
 *
 * This app transmits screenshots of other people's private conversations. A
 * `console.log(body)` at 2am is the mistake everyone eventually makes, and it
 * would put a transcript in a log aggregator forever. There is no overload here
 * that accepts free-form data, so the mistake has nowhere to live.
 *
 * NEVER add: image bytes, base64, transcripts, replies, bios, profile names,
 * uiText, or anything else derived from user content.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

type Fields = Record<string, string | number | boolean | undefined>;

/**
 * The id of the request being served, threaded implicitly.
 *
 * **Why this is not a parameter.** Every log line in this service was previously
 * an island: five database calls, a Gemini call and possibly a refund all emit
 * separately, and nothing tied them to each other or to the request that caused
 * them. Reconstructing one incident from a log aggregator meant guessing from
 * timestamps, and on a platform that runs many instances concurrently the
 * timestamps interleave. Threading an id through every function that might log
 * would touch a hundred call sites and be forgotten at the hundred-and-first;
 * `AsyncLocalStorage` is the stdlib answer and costs nothing at the call sites.
 *
 * It is a REQUEST id, not a user id — the no-PII rule below is unchanged. Two
 * lines sharing an `rid` came from one request; that is all it says, and it is
 * exactly what incident response needs.
 */
const requestId = new AsyncLocalStorage<string>();

/** Run `fn` with every log line inside it tagged `rid`. See the middleware in app.ts. */
export function withRequestId<T>(id: string, fn: () => T): T {
  return requestId.run(id, fn);
}

function emit(level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}) {
  console[level](
    JSON.stringify({
      level,
      event,
      at: new Date().toISOString(),
      // Absent outside a request — migrations, boot, the cron. Omitted rather
      // than `null` so those lines stay the shape they have always been.
      ...(requestId.getStore() ? { rid: requestId.getStore() } : {}),
      ...fields,
    }),
  );
}

export const log = {
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  /** `err` is reduced to its name+message. Stacks are fine; bodies are not. */
  error: (event: string, err?: unknown, fields?: Fields) =>
    emit('error', event, {
      ...fields,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? ''),
    }),
};
