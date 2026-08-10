/**
 * The one API client. Every engine calls through here.
 *
 * This replaces `gemini.ts`, which called Google directly with
 * `EXPO_PUBLIC_GEMINI_API_KEY` — a value embedded in the JS bundle and therefore
 * readable by anyone who unzips the APK, with no server-side quota behind it.
 * The exposure was an open-ended bill, not a bounded one.
 *
 * What moved to the server: the key, every system prompt, every `responseSchema`,
 * the model choice, the thinking fix, credit enforcement and rate limiting. What
 * stayed here: building the request, and falling back to mock seeds on failure.
 *
 * Throws on any failure — callers catch and serve their mock data, exactly as
 * they did before.
 */

import { apiUrl, accessToken, reportCredits, type Credits } from '@/state/session';
import { reportError, track, type EngineName } from './analytics';

export { isLiveApi } from '@/state/session';

/** Server-side twin of the old `imagePart()`. Mime is re-sniffed from magic bytes there. */
export interface ImagePayload {
  data: string;
  mime_type: string;
}

export function imagePayload(base64: string, mimeType: string): ImagePayload {
  return { data: base64, mime_type: mimeType };
}

/** `code` mirrors the server envelope, so callers branch on it and never on the message. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope<T> {
  result: T;
  credits?: Credits;
  error?: { code: string; message: string; retryable: boolean };
}

const TIMEOUT_MS = 60_000;

async function post(path: string, body: unknown, token: string, signal?: AbortSignal): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  return fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: combinedSignal,
  });
}

/**
 * Instrumented here rather than in each engine: one choke point, so `ai_success`
 * and `ai_fail` cannot drift apart across four call sites, and a fifth engine
 * gets tracking for free. The engine name is the route, so it needs no argument.
 */
export async function callApi<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const engine = path.replace('/v1/ai/', '') as EngineName;
  const started = Date.now();

  try {
    let res = await post(path, body, await accessToken(), signal);

    // Exactly one retry, and only on 401: the 24h token expired, or
    // `/v1/user/pro` changed the entitlement underneath it. Retrying anything
    // else would double a charge that already succeeded server-side.
    if (res.status === 401) {
      res = await post(path, body, await accessToken(true));
    }

    const data = (await res.json().catch(() => null)) as Envelope<T> | null;

    if (!res.ok || !data) {
      const err = data?.error;
      throw new ApiError(
        err?.code ?? 'NETWORK',
        err?.message ?? `Request failed (${res.status})`,
        err?.retryable ?? true,
      );
    }

    // The server's count is the truth; the local one is an optimistic cache that
    // exists so the paywall can appear without a round trip.
    if (data.credits) reportCredits(data.credits);

    track({ name: 'ai_success', engine, ms: Date.now() - started });
    return data.result;
  } catch (error) {
    // `code`, never `message` — a server message could one day quote input.
    track({
      name: 'ai_fail',
      engine,
      code: error instanceof ApiError ? error.code : 'NETWORK',
    });
    // Every engine swallows this into a mock fallback, so without Crashlytics a
    // total outage is indistinguishable from normal use.
    reportError(error, `ai:${engine}`);
    throw error;
  }
}
