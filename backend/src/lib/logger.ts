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
type Fields = Record<string, string | number | boolean | undefined>;

function emit(level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}) {
  console[level](JSON.stringify({ level, event, at: new Date().toISOString(), ...fields }));
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
