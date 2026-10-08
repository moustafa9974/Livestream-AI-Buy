import { visionUserText, type FrameContext } from "./prompt";
import type { VisionProvider } from "./providers";
import { normalizeVision, RawVisionResult, type VisionResult } from "./vision-schema";

export interface AnalyzeOutcome {
  result: VisionResult;
  provider: VisionProvider["name"];
  latencyMs: number;
  attempts: number;
}

export class VisionError extends Error {}

function parse(text: string): { ok: true; value: RawVisionResult } | { ok: false; problem: string } {
  let json: unknown;
  try {
    // Some local models wrap JSON in ``` fences despite instructions.
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false, problem: "not valid JSON" };
  }
  const r = RawVisionResult.safeParse(json);
  if (!r.success) {
    return { ok: false, problem: r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, value: r.data };
}

/**
 * Provider-agnostic frame analysis (SPEC §6.1): structured output → zod validation →
 * one retry with a "fix your JSON" hint → guardrails. Invalid output is dropped
 * (throws VisionError), never partially trusted.
 */
export async function analyzeFrame(
  provider: VisionProvider,
  imageJpegBase64: string,
  ctx: FrameContext,
  timeoutMs = 20_000,
): Promise<AnalyzeOutcome> {
  const started = Date.now();
  const baseText = visionUserText(ctx);
  let text = baseText;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const signal = AbortSignal.timeout(timeoutMs);
    const raw = await provider.analyzeRaw(imageJpegBase64, text, signal);
    const parsed = parse(raw);
    if (parsed.ok) {
      return {
        result: normalizeVision(parsed.value),
        provider: provider.name,
        latencyMs: Date.now() - started,
        attempts: attempt,
      };
    }
    text = `${baseText}\n\nYour previous reply was invalid (${parsed.problem}). Reply again with only JSON that matches the schema exactly.`;
  }
  throw new VisionError(`${provider.name} returned invalid output twice`);
}
