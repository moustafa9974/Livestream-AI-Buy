import { ApiError, GoogleGenAI, type Content, type GenerateContentResponse, type Tool } from "@google/genai";
import { consume } from "../budget";
import { getEnv } from "../env";

/**
 * Gemini text calls (recaps, creator assistant) with the same resilience as vision:
 * free-tier models fail over on 503/429/timeouts, every call is budget-guarded, and
 * nothing here ever decides money (tools return amounts computed from the DB).
 */

let genai: GoogleGenAI | undefined;

export class TextAIUnavailable extends Error {}

function textModels(): string[] {
  const env = getEnv();
  return [env.GEMINI_TEXT_MODEL, ...env.GEMINI_TEXT_FALLBACK_MODELS.split(",").map((m) => m.trim())].filter(
    (m, i, a) => m && a.indexOf(m) === i,
  );
}

export async function generate(params: {
  contents: Content[];
  systemInstruction: string;
  tools?: Tool[];
  json?: { schema: unknown };
  /** Per-model attempt limit. */
  timeoutMs?: number;
  /** Limit across all fallback models, so a caller with a plan B isn't kept waiting. */
  totalTimeoutMs?: number;
}): Promise<GenerateContentResponse> {
  const env = getEnv();
  if (!env.GEMINI_API_KEY) throw new TextAIUnavailable("No Gemini key configured");
  if (!(await consume("gemini")).allowed) throw new TextAIUnavailable("Free AI quota used up for today");
  genai ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  let last: unknown;
  const deadline = Date.now() + (params.totalTimeoutMs ?? Number.POSITIVE_INFINITY);
  for (const model of textModels()) {
    const left = deadline - Date.now();
    if (left < 2_000) break;
    const signal = AbortSignal.timeout(Math.min(params.timeoutMs ?? 15_000, left));
    try {
      return await genai.models.generateContent({
        model,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          ...(params.tools ? { tools: params.tools } : {}),
          ...(params.json ? { responseMimeType: "application/json", responseJsonSchema: params.json.schema } : {}),
          abortSignal: signal,
        },
      });
    } catch (err) {
      last = err;
      const retryable = signal.aborted || (err instanceof ApiError && (err.status === 503 || err.status === 429));
      if (!retryable) throw err;
      console.warn(`[text-ai] ${model} ${signal.aborted ? "timed out" : (err as ApiError).status}; trying next model`);
    }
  }
  if (last instanceof ApiError && last.status === 429) throw new TextAIUnavailable("Free AI quota used up for today");
  throw new TextAIUnavailable("The AI is busy right now. Please try again in a moment.");
}
