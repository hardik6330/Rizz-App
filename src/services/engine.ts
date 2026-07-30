import { ANALYZE_STAGES, MOCK_ANALYSES } from '@/data/mockAnalysis';
import type { AnalysisResult, EngineMode } from '@/types';
import { uid, wait } from '@/utils/misc';
import { callApi, imagePayload, isLiveApi } from './api';

/**
 * The Screenshot Intelligence Engine.
 *
 * With `EXPO_PUBLIC_API_URL` set this posts the screenshot to the RizzCoach API,
 * which holds the Gemini key, the system prompt and the response schema; without
 * it the engine runs a local simulation so the product is demoable offline.
 * Shared transport lives in `api.ts`.
 *
 * The prompt and schema used to live in this file and shipped inside the bundle.
 * They moved server-side with the key: a prompt in the APK is both a free copy
 * for anyone who unzips it and impossible to version or roll back without a
 * release. `mode` still scopes the work — the Lab renders one mode's cards, and
 * asking for all four burned ~3x the output tokens on every scan — but the
 * server now decides which sections that means.
 */

export interface EngineInput {
  base64: string;
  mimeType: string;
}

/**
 * @param temperature raise it on a reroll so "give me another" returns another.
 */
export async function analyzeScreenshot(
  input: EngineInput,
  mode: EngineMode = 'rizz',
  temperature?: number,
): Promise<AnalysisResult> {
  if (isLiveApi) {
    try {
      return await analyzeViaApi(input, mode, temperature);
    } catch (error) {
      console.warn('[engine] live analysis failed — falling back to simulation', error);
    }
  }
  return simulateAnalysis();
}

// ---------------------------------------------------------------------------
// Live path — POST /v1/ai/lab
// ---------------------------------------------------------------------------

async function analyzeViaApi(
  { base64, mimeType }: EngineInput,
  mode: EngineMode,
  temperature?: number,
): Promise<AnalysisResult> {
  const parsed = await callApi<Omit<AnalysisResult, 'id' | 'createdAt'>>('/v1/ai/lab', {
    image: imagePayload(base64, mimeType),
    mode,
    temperature,
  });
  return { ...parsed, id: uid(), createdAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Simulation path — offline demo mode
// ---------------------------------------------------------------------------

let rotation = Math.floor(Math.random() * MOCK_ANALYSES.length);

async function simulateAnalysis(): Promise<AnalysisResult> {
  // Hold roughly one beat per stage so the scanning UI gets its moment.
  await wait(ANALYZE_STAGES.length * 850 + 400);
  const seed = MOCK_ANALYSES[rotation % MOCK_ANALYSES.length];
  rotation += 1;
  const clone = JSON.parse(JSON.stringify(seed)) as Omit<AnalysisResult, 'id' | 'createdAt'>;
  return { ...clone, id: uid(), createdAt: Date.now() };
}
