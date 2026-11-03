import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ApiError, GoogleGenAI, MediaResolution, ThinkingLevel } from "@google/genai";
import { getEnv } from "../env";
import { VISION_SYSTEM_PROMPT } from "./prompt";
import { RawVisionResult, VISION_JSON_SCHEMA } from "./vision-schema";

/**
 * A vision provider returns the model's raw JSON text for one frame; parsing,
 * validation and guardrails happen once, in vision.ts, for every provider.
 */
export interface VisionProvider {
  name: "gemini" | "ollama" | "claude" | "openrouter";
  /** Budget counter to charge, or null for free/local providers. */
  budgetKey: "gemini" | "openrouter" | null;
  analyzeRaw(imageJpegBase64: string, userText: string, signal: AbortSignal): Promise<string>;
}

let genai: GoogleGenAI | undefined;

// Circuit breaker: a model that just timed out or said "busy" is tried last for a few
// minutes, so a live demo doesn't pay its timeout on every frame.
const TRIP_MS = 3 * 60_000;
const trippedUntil = new Map<string, number>();
const trip = (model: string, ms = TRIP_MS) => trippedUntil.set(model, Date.now() + ms);

/** Google's 429 carries RetryInfo (e.g. "26479s" until the daily quota resets). */
export function retryDelayMs(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(err.message);
  return m ? Math.min(Number(m[1]) * 1000, 12 * 3_600_000) : null;
}

/** Thrown when every configured model is out of free quota. */
export class QuotaExhaustedError extends Error {}
const healthy = (model: string) => trippedUntil.delete(model);

/** Configured order, with recently failing models moved to the end. */
export function modelOrder(env: { GEMINI_VISION_MODEL: string; GEMINI_VISION_FALLBACK_MODELS: string }, now = Date.now()): string[] {
  const all = [env.GEMINI_VISION_MODEL, ...env.GEMINI_VISION_FALLBACK_MODELS.split(",").map((m) => m.trim())]
    .filter((m, i, a) => m && a.indexOf(m) === i);
  const ok = all.filter((m) => (trippedUntil.get(m) ?? 0) <= now);
  return [...ok, ...all.filter((m) => !ok.includes(m))];
}

export function resetCircuitBreakerForTests(): void {
  trippedUntil.clear();
}

export function geminiProvider(): VisionProvider {
  const env = getEnv();
  genai ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const level = env.GEMINI_THINKING_LEVEL;
  return {
    name: "gemini",
    budgetKey: "gemini",
    async analyzeRaw(image, text, signal) {
      const call = (model: string, attemptSignal: AbortSignal) =>
        genai!.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: image } }, { text }] }],
          config: {
            systemInstruction: VISION_SYSTEM_PROMPT,
            responseMimeType: "application/json",
            responseJsonSchema: VISION_JSON_SCHEMA,
            // Medium is plenty for 768px frames and keeps free-tier token use down.
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
            ...(level ? { thinkingConfig: { thinkingLevel: level as ThinkingLevel } } : {}),
            abortSignal: attemptSignal,
          },
        });

      let lastErr: unknown;
      for (const model of modelOrder(env)) {
        if (signal.aborted) break;
        const attempt = AbortSignal.any([signal, AbortSignal.timeout(env.GEMINI_ATTEMPT_TIMEOUT_MS)]);
        try {
          const res = await call(model, attempt);
          healthy(model);
          return res.text ?? "";
        } catch (err) {
          lastErr = err;
          if (signal.aborted) break; // the whole frame ran out of time
          // Free-tier models regularly answer 503 "high demand", 429, or just hang. Another
          // Flash model has separate capacity, so fail over instead of losing the frame.
          const failover = attempt.aborted || (err instanceof ApiError && (err.status === 503 || err.status === 429));
          if (!failover) throw err;
          // A daily-quota 429 can last hours: skip the model until Google says it resets.
          const is429 = err instanceof ApiError && err.status === 429;
          trip(model, (is429 && retryDelayMs(err)) || TRIP_MS);
          console.warn(`[vision] ${model} ${attempt.aborted ? "timed out" : `returned ${(err as ApiError).status}`}; trying next model`);
        }
      }
      if (lastErr instanceof ApiError && lastErr.status === 429) throw new QuotaExhaustedError("All Gemini models are out of free quota");
      throw lastErr ?? new Error("No Gemini model available");
    },
  };
}

export function ollamaProvider(): VisionProvider {
  const env = getEnv();
  return {
    name: "ollama",
    budgetKey: null, // local, free
    async analyzeRaw(image, text, signal) {
      const res = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          model: env.OLLAMA_VISION_MODEL,
          stream: false,
          format: VISION_JSON_SCHEMA, // Ollama structured outputs
          options: { temperature: 0.2 },
          messages: [
            { role: "system", content: VISION_SYSTEM_PROMPT },
            { role: "user", content: text, images: [image] },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const json = (await res.json()) as { message?: { content?: string } };
      return json.message?.content ?? "";
    },
  };
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Models that rejected json_schema (some free endpoints only offer JSON mode); remembered
// so later frames go straight to json_object. Validation in vision.ts is the real check.
const jsonModeOnly = new Set<string>();

/**
 * Backup provider: OpenRouter's free vision models over its OpenAI-style chat API
 * (openrouter.ai/docs: image inputs as base64 data URLs, text part first; structured
 * outputs via response_format json_schema). Used only when Gemini fails a frame.
 */
export function openrouterProvider(): VisionProvider {
  const env = getEnv();
  const models = env.OPENROUTER_VISION_MODELS.split(",").map((m) => m.trim()).filter(Boolean);
  return {
    name: "openrouter",
    budgetKey: "openrouter",
    async analyzeRaw(image, text, signal) {
      const call = (model: string, jsonSchema: boolean, attemptSignal: AbortSignal) =>
        fetch(OPENROUTER_URL, {
          method: "POST",
          signal: attemptSignal,
          headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
              { role: "system", content: VISION_SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  // JSON mode has no schema, so spell it out in the prompt as well.
                  { type: "text", text: `${text}\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(VISION_JSON_SCHEMA)}` },
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
                ],
              },
            ],
            response_format: jsonSchema
              ? { type: "json_schema", json_schema: { name: "frame_products", strict: false, schema: VISION_JSON_SCHEMA } }
              : { type: "json_object" },
          }),
        });

      let lastErr: unknown;
      for (const model of models) {
        if (signal.aborted) break;
        const attempt = AbortSignal.any([signal, AbortSignal.timeout(env.GEMINI_ATTEMPT_TIMEOUT_MS)]);
        try {
          let res = await call(model, !jsonModeOnly.has(model), attempt);
          if ((res.status === 400 || res.status === 404) && !jsonModeOnly.has(model)) {
            jsonModeOnly.add(model);
            res = await call(model, false, attempt);
          }
          const body = (await res.json().catch(() => ({}))) as {
            choices?: Array<{ message?: { content?: string | null } }>;
            error?: { code?: number; message?: string };
          };
          const content = body.choices?.[0]?.message?.content;
          if (res.ok && !body.error && typeof content === "string" && content.trim()) return content;
          throw new Error(`OpenRouter ${model}: HTTP ${res.status}${body.error?.message ? ` ${body.error.message.slice(0, 120)}` : ""}`);
        } catch (err) {
          lastErr = err;
          if (signal.aborted) break;
          // Free endpoints come and go (429 upstream, 5xx, timeouts): try the next model.
          console.warn(`[vision] ${attempt.aborted ? `OpenRouter ${model} timed out` : err instanceof Error ? err.message : err}; trying next model`);
        }
      }
      throw lastErr ?? new Error("No OpenRouter model available");
    },
  };
}

/** The backup that takes over a frame Gemini couldn't answer, or null when not configured. */
export function backupProvider(primary: VisionProvider | null): VisionProvider | null {
  if (override !== undefined) return null; // tests control providers explicitly
  const env = getEnv();
  return primary?.name === "gemini" && env.OPENROUTER_API_KEY ? openrouterProvider() : null;
}

// Server-side refusal fallback is supported on these models (claude-api reference).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

/** Optional and PAID: only selected when AI_PROVIDER=claude and a key is set. */
export function claudeProvider(): VisionProvider {
  const env = getEnv();
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  return {
    name: "claude",
    budgetKey: null,
    async analyzeRaw(image, text, signal) {
      const model = env.CLAUDE_VISION_MODEL;
      const useFallbacks = FALLBACK_MODELS.has(model);
      const res = await client.beta.messages.parse(
        {
          model,
          max_tokens: 4096,
          system: VISION_SYSTEM_PROMPT,
          // Low effort: this is a quick perception task, not deep reasoning.
          output_config: { effort: "low", format: betaZodOutputFormat(RawVisionResult) },
          ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
                { type: "text", text },
              ],
            },
          ],
        },
        { signal, timeout: env.VISION_TIMEOUT_MS },
      );
      if (res.stop_reason === "refusal" || !res.parsed_output) return JSON.stringify({ items: [], scene: "" });
      return JSON.stringify(res.parsed_output);
    },
  };
}

let override: VisionProvider | null | undefined;

/** Tests only: force a provider (or null = "none configured"); undefined restores normal selection. */
export function setVisionProviderForTests(p: VisionProvider | null | undefined): void {
  override = p;
}

/** Picks the configured provider (or the demo panel's override); null when unusable. */
export function selectProvider(name?: "gemini" | "ollama" | "claude"): VisionProvider | null {
  if (override !== undefined) return override;
  const env = getEnv();
  switch (name ?? env.AI_PROVIDER) {
    case "gemini":
      return env.GEMINI_API_KEY ? geminiProvider() : null;
    case "ollama":
      return ollamaProvider();
    case "claude":
      return env.ANTHROPIC_API_KEY ? claudeProvider() : null;
  }
}
