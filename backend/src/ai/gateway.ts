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
 * Pinned, not the rolling alias. **This comment used to be aspirational.**
 *
 * The line below read `gemini-flash-latest` while this block claimed it was
 * pinned, and the alias has now moved twice underneath us:
 *
 *   1. It rolled to Gemini 3, which rejected the old `thinkingBudget` key with
 *      HTTP 400 on EVERY call — the whole app served mock data until a human
 *      noticed. That incident is what this comment was written about.
 *   2. It rolled again to `gemini-3.6-flash`, which lists at $1.50/$7.50 per
 *      million tokens against the $0.25/$1.50 of the tier below it. Nothing
 *      broke, nothing was logged, and the primary cost line of the business
 *      went up ~6x without a commit. That one is why the pin finally happened.
 *
 * An alias is a promise that someone else may change your model, your API
 * contract and your bill on their schedule. Pinning makes the next roll a
 * deploy we choose rather than an outage or an invoice we discover.
 *
 * ## The standing policy: pick the BEST model, not the cheapest
 *
 * This product sells the quality of one generated line. A user who gets a
 * mediocre reply does not come back, and no per-call saving is worth a churned
 * subscriber — so a cheaper tier is not an optimisation here, it is a product
 * regression with a smaller invoice attached.
 *
 * **Do not downgrade this to a Flash-Lite tier to cut COGS.** The list prices
 * below exist so `costUsd` can be computed and a 6x change is visible; they are
 * not an argument. If spend needs bounding, the levers are `DAILY_CALL_CAP` and
 * the size of the free tier — both of which cost nothing in output quality.
 *
 * Stable IDs and list prices per 1M tokens (in / out), verified Aug 2026:
 *
 *   gemini-3.6-flash        $1.50 / $7.50   ← current. Newest stable Flash.
 *   gemini-3.5-flash        $1.50 / $7.50     same price; evaluate head-to-head
 *   gemini-3.5-flash-lite   $0.30 / $2.50     cheaper, weaker — not for this app
 *   gemini-3.1-flash-lite   $0.25 / $1.50     cheaper, weaker — not for this app
 *
 * A Pro tier is deliberately not listed: only preview IDs exist today, pinning
 * production to a preview model reinstates the exact instability this pin
 * removes, and the user is watching a spinner — Pro's latency is a real cost to
 * them even when the money is not the objection.
 *
 * ## Changing this value
 *
 * One line, and it is a REAL change — canary it, do not just ship it:
 *
 *   cd backend && node --env-file=.env --import tsx src/ai/gateway.selfcheck.ts
 *
 * The selfcheck makes one live call under a deliberately small token cap, which
 * catches both the "invalid argument" class of failure (a model that rejects
 * `thinkingLevel`) and the truncation class. It cannot tell you the answer got
 * WORSE — so also run a real screenshot through the Lab and read the output
 * before promoting.
 *
 * ponytail: pinned to the model already running, so this change is cost- and
 * behaviour-neutral by design. It removes the silent-roll risk and nothing else.
 */
const MODEL = 'gemini-3.6-flash';

/**
 * List price per 1M tokens, for the estimate on every `gemini.ok` line.
 *
 * Why estimate cost here at all: the 6x price change above was invisible for
 * weeks because nothing in this service ever expressed a call in money. Tokens
 * are logged, and tokens are not the number that moved — the price per token
 * was. A cost field means the regression shows up in the same log line everyone
 * already reads, on the first call after a bad pin.
 *
 * Deliberately a hardcoded table and deliberately approximate. It is a smoke
 * alarm, not an invoice: Google's billing is authoritative, this exists to make
 * an order-of-magnitude move impossible to miss. An unknown model logs no cost
 * rather than a wrong one.
 *
 * **This is a visibility tool, not a budget.** The model choice above is made on
 * quality; see the policy there. A high `costUsd` is expected and is answered by
 * capping VOLUME, never by weakening the model.
 *
 * ponytail: no rollup table, no metrics backend. Grep `gemini.ok` and sum
 * `costUsd`. Add aggregation when a log search stops being enough.
 */
const PRICES: Record<string, { in: number; out: number }> = {
  'gemini-3.6-flash': { in: 1.5, out: 7.5 },
  'gemini-3.5-flash-lite': { in: 0.3, out: 2.5 },
  'gemini-3.1-flash-lite': { in: 0.25, out: 1.5 },
};

/**
 * Estimated USD for one call, or undefined for a model we have no price for.
 *
 * Thinking tokens are billed at the OUTPUT rate and are NOT part of
 * `candidatesTokenCount` — the same trap `totalTokens` exists to avoid. Summing
 * prompt + output alone under-bills every call on a thinking model, which is
 * this one.
 */
function estimateCost(usage: Usage): number | undefined {
  const price = PRICES[usage.model];
  if (!price) return undefined;
  const input = usage.promptTokens ?? 0;
  const output = (usage.outputTokens ?? 0) + (usage.thoughtTokens ?? 0);
  const usd = (input * price.in + output * price.out) / 1_000_000;
  // 6dp: a single Lab call lands around $0.001, so fewer digits round it to zero
  // and the field reads as "free" on every line.
  return Number(usd.toFixed(6));
}

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

  // `costUsd` last so it reads as the summary of the numbers before it.
  log.info('gemini.ok', { engine: opts.engine, prompt, ...usage, costUsd: estimateCost(usage) });
  return { data: parsed, usage };
}
