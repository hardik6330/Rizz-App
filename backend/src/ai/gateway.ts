import { createHash } from 'node:crypto';

import { env } from '../env.ts';
import { Errors } from '../lib/errors.ts';
import { log } from '../lib/logger.ts';

/**
 * The ONE place this service talks to Gemini — the server-side twin of the
 * client's `callGemini`.
 *
 * The client keeps that rule because when model, auth, the thinking fix, error
 * handling and JSON parsing were copy-pasted across four engines, a single bug
 * had to be fixed three times and was missed in the fourth. Same rule here: no
 * route may call `fetch` against Gemini directly.
 */

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

/** Mirrors SUPPORTED_MIME_TYPES in src/services/gemini.ts. */
const SUPPORTED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export function imagePart(base64: string, mimeType: string): Part {
  return {
    inlineData: {
      mimeType: SUPPORTED_MIME.includes(mimeType) ? mimeType : 'image/jpeg',
      data: base64,
    },
  };
}

/**
 * Pinned, not the rolling alias.
 *
 * `gemini-flash-latest` silently rolled to Gemini 3, which rejected the old
 * `thinkingBudget` key with HTTP 400 on EVERY call — the whole app served mock
 * data until a human noticed. Pinning here means the next roll is a deploy we
 * choose, not an outage we discover. Canary a new model before promoting it.
 */
const MODEL = 'gemini-flash-latest';

/**
 * Prompt version = the first 8 hex of sha256(prompt text).
 *
 * Derived, not declared. A hand-maintained `PROMPT_VERSION = 3` is wrong the
 * first time someone tweaks a prompt without bumping it, and you only discover
 * that while trying to explain why quality moved — which is exactly the question
 * versioning exists to answer. A hash cannot drift from the text it names.
 *
 * Logged on every call, so `engine + promptVersion + outputTokens` attributes
 * both a quality change and a cost change to a specific prompt edit. To roll
 * back, restore the text; the old hash reappears on its own.
 */
const versions = new Map<string, string>();

export function promptVersion(system: string): string {
  let v = versions.get(system);
  if (!v) {
    v = createHash('sha256').update(system).digest('hex').slice(0, 8);
    versions.set(system, v);
  }
  return v;
}

export interface Usage {
  model: string;
  promptTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  /**
   * Gemini's own total — NOT `prompt + output`.
   *
   * Thinking tokens are billed and are not included in `candidatesTokenCount`,
   * so summing the two under-reports every call on a thinking model. Take the
   * number the API bills against.
   */
  totalTokens?: number;
  latencyMs: number;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string };
}

export interface GenerateOptions {
  /** For logs and cost attribution only — never sent to the model. */
  engine: string;
  system: string;
  parts: Part[];
  schema: object;
  maxOutputTokens?: number;
  temperature?: number;
}

export async function generate<T>(opts: GenerateOptions): Promise<{ data: T; usage: Usage }> {
  const prompt = promptVersion(opts.system);
  const started = Date.now();
  const url = `${env.GEMINI_BASE_URL}/models/${MODEL}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: opts.parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: opts.schema,
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
      temperature: opts.temperature ?? 0.9,
      /*
       * LOAD-BEARING — do not remove, do not raise.
       *
       * gemini-flash-latest is a thinking model and thinking tokens count
       * against maxOutputTokens. Left on, they starve the answer, the JSON comes
       * back truncated and the parse throws.
       *
       * It read `thinkingBudget: 0` until the alias reached Gemini 3, which
       * replaced the numeric budget with a level and now rejects the old key
       * outright. Valid levels are "low", "minimal" and "high"; there is no
       * "none", and "high" reproduces the original truncation.
       *
       * Do not "buy headroom" by raising maxOutputTokens either — Gemini 3 sizes
       * thinking as a fraction of the cap, so a bigger cap buys more thinking,
       * latency and cost for an identical answer.
       */
      thinkingConfig: { thinkingLevel: 'low' },
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Key in a header, never the URL — it would land in access logs.
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    log.error('gemini.network', err, { engine: opts.engine, prompt });
    throw Errors.aiUnavailable();
  }

  const data = (await res.json()) as GeminiResponse;
  const latencyMs = Date.now() - started;

  if (!res.ok) {
    // No retry on 4xx: a 400 here is the thinkingLevel class of bug, and
    // retrying a guaranteed failure just triples the latency and the log noise.
    log.error('gemini.http', data.error?.message, { engine: opts.engine, prompt, status: res.status, latencyMs });
    throw Errors.aiUnavailable();
  }
  if (data.promptFeedback?.blockReason) {
    log.warn('gemini.blocked', { engine: opts.engine, prompt, reason: data.promptFeedback.blockReason });
    throw Errors.aiUnavailable();
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) {
    log.error('gemini.empty', undefined, { engine: opts.engine, prompt, latencyMs });
    throw Errors.aiUnavailable();
  }

  const usage: Usage = {
    model: MODEL,
    promptTokens: data.usageMetadata?.promptTokenCount,
    outputTokens: data.usageMetadata?.candidatesTokenCount,
    thoughtTokens: data.usageMetadata?.thoughtsTokenCount,
    totalTokens: data.usageMetadata?.totalTokenCount,
    latencyMs,
  };

  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch (err) {
    // Truncation looks exactly like this. usageMetadata tells you whether
    // thinking ate the budget — measure before changing any cap.
    log.error('gemini.parse', err, {
      engine: opts.engine,
      prompt,
      finishReason: data.candidates?.[0]?.finishReason,
      outputTokens: usage.outputTokens,
      thoughtTokens: usage.thoughtTokens,
    });
    throw Errors.aiUnavailable();
  }

  log.info('gemini.ok', { engine: opts.engine, prompt, ...usage });
  return { data: parsed, usage };
}
