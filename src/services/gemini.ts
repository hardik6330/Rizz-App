/**
 * The one Gemini client. Every engine calls through here.
 *
 * Model, auth, the thinking-budget fix, error handling and JSON parsing live in
 * exactly ONE place on purpose: when they were copy-pasted across four engines,
 * a single bug (thinking tokens truncating the JSON) had to be fixed three
 * times and was missed in the fourth.
 *
 * Throws on any failure — callers catch and fall back to their mock data.
 *
 * ⚠️ Shipping note: EXPO_PUBLIC_* is embedded in the app bundle, so this key is
 * extractable by anyone who unpacks the build. Move these calls behind your own
 * proxy (or Firebase AI Logic) before launch and keep the key server-side. The
 * request body below transplants 1:1.
 *
 * Self-check (hits the live API): node --env-file=.env src/services/gemini.selfcheck.ts
 */

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';

/**
 * Google issues multiple key formats ("AIza…", "AQ.…") — treat any plausible
 * non-stub value as live and let the network fallback handle bad keys.
 */
export const isLiveKey = API_KEY.length >= 30 && !API_KEY.toLowerCase().includes('mock');

/** Rolling alias — tracks the current Flash model so retired model ids never break the app. */
const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/** Build an image part, clamping unknown mime types to jpeg. */
export function imagePart(base64: string, mimeType: string): GeminiPart {
  return {
    inlineData: {
      mimeType: SUPPORTED_MIME_TYPES.includes(mimeType) ? mimeType : 'image/jpeg',
      data: base64,
    },
  };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export interface GeminiRequest {
  system: string;
  parts: GeminiPart[];
  /** Gemini responseSchema (OpenAPI-subset format with uppercase types). */
  schema: object;
  maxOutputTokens?: number;
  temperature?: number;
}

/** Call Gemini with a strict JSON schema and return the parsed result. */
export async function callGemini<T>({
  system,
  parts,
  schema,
  maxOutputTokens = 8192,
  temperature = 0.9,
}: GeminiRequest): Promise<T> {
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Key goes in a header, never in the URL.
      'x-goog-api-key': API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        maxOutputTokens,
        temperature,
        // gemini-flash-latest is a thinking model and thinking tokens count
        // toward maxOutputTokens. Left on, they starve the answer, the JSON
        // comes back truncated and JSON.parse throws — which every caller
        // swallows into a silent mock fallback. Do not remove.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  const data = (await response.json()) as GeminiResponse;

  if (!response.ok) {
    throw new Error(`Gemini request failed (${response.status}): ${data.error?.message ?? 'unknown'}`);
  }
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Request was blocked: ${data.promptFeedback.blockReason}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
  if (!text) throw new Error('No content in Gemini response.');

  return JSON.parse(text) as T;
}
