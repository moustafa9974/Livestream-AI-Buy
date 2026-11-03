import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv, resetEnvCache } from "../env";
import { featureStatus } from "../flags";
import { backupProvider, geminiProvider, openrouterProvider, retryDelayMs } from "./providers";

const ENV = {
  DATABASE_URL: "postgres://x",
  GEMINI_API_KEY: "g",
  OPENROUTER_API_KEY: "or-key",
  OPENROUTER_VISION_MODELS: "vendor/model-a:free,vendor/model-b:free",
};

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe("OpenRouter backup vision provider", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, ENV);
    resetEnvCache();
  });
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
    vi.unstubAllGlobals();
  });

  it("sends the prompt text before the image as a base64 data URL, with a JSON schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok('{"items":[],"scene":"desk"}'));
    vi.stubGlobal("fetch", fetchMock);
    const out = await openrouterProvider().analyzeRaw("QUJD", "find products", AbortSignal.timeout(5000));
    expect(out).toBe('{"items":[],"scene":"desk"}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer or-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("vendor/model-a:free");
    const parts = body.messages[1].content;
    expect(parts[0].type).toBe("text");
    expect(parts[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } });
    expect(body.response_format.type).toBe("json_schema");
  });

  it("falls back to JSON mode when a model rejects json_schema", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "unsupported" } }), { status: 400 }))
      .mockResolvedValueOnce(ok('{"items":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    await openrouterProvider().analyzeRaw("QUJD", "t", AbortSignal.timeout(5000));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toEqual({ type: "json_object" });
  });

  it("moves to the next free model on a rate limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 429, message: "Rate limit exceeded" } }), { status: 429 }))
      .mockResolvedValueOnce(ok('{"items":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    await openrouterProvider().analyzeRaw("QUJD", "t", AbortSignal.timeout(5000));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe("vendor/model-b:free");
  });

  it("is only a backup for Gemini, and only with a key", () => {
    expect(backupProvider(geminiProvider())?.name).toBe("openrouter");
    expect(backupProvider(null)).toBeNull();
    expect(featureStatus("openrouter", getEnv({ ...ENV, OPENROUTER_API_KEY: "" })).enabled).toBe(false);
    expect(featureStatus("openrouter", getEnv(ENV)).enabled).toBe(true);
  });
});

describe("retryDelayMs", () => {
  it("reads Google's RetryInfo delay", () => {
    expect(retryDelayMs(new Error('{"@type":"RetryInfo","retryDelay": "26.5s"}'))).toBe(26_500);
    expect(retryDelayMs(new Error("no delay here"))).toBeNull();
  });
});
