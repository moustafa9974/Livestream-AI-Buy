import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { GoogleGenAI, MediaResolution, ThinkingLevel } from "@google/genai";
import { getEnv } from "../env";
import { VISION_SYSTEM_PROMPT } from "./prompt";
import { RawVisionResult, VISION_JSON_SCHEMA } from "./vision-schema";

/**
 * A vision provider returns the model's raw JSON text for one frame; parsing,
 * validation and guardrails happen once, in vision.ts, for every provider.
 */
export interface VisionProvider {
  name: "gemini" | "ollama" | "claude";
  /** Budget counter to charge, or null for free/local providers. */
  budgetKey: "gemini" | null;
  analyzeRaw(imageJpegBase64: string, userText: string, signal: AbortSignal): Promise<string>;
}

let genai: GoogleGenAI | undefined;

export function geminiProvider(): VisionProvider {
  const env = getEnv();
  genai ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const level = env.GEMINI_THINKING_LEVEL;
  return {
    name: "gemini",
    budgetKey: "gemini",
    async analyzeRaw(image, text, signal) {
      const res = await genai!.models.generateContent({
        model: env.GEMINI_VISION_MODEL,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: image } }, { text }] }],
        config: {
          systemInstruction: VISION_SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseJsonSchema: VISION_JSON_SCHEMA,
          // Medium is plenty for 768px frames and keeps free-tier token use down.
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
          ...(level ? { thinkingConfig: { thinkingLevel: level as ThinkingLevel } } : {}),
          abortSignal: signal,
        },
      });
      return res.text ?? "";
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

/** Picks the configured provider; null when it isn't usable (missing key). */
export function selectProvider(): VisionProvider | null {
  if (override !== undefined) return override;
  const env = getEnv();
  switch (env.AI_PROVIDER) {
    case "gemini":
      return env.GEMINI_API_KEY ? geminiProvider() : null;
    case "ollama":
      return ollamaProvider();
    case "claude":
      return env.ANTHROPIC_API_KEY ? claudeProvider() : null;
  }
}
