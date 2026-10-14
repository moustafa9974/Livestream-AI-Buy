import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { consume } from "../budget";
import { prisma } from "../db";
import { getEnv } from "../env";

/**
 * Text embeddings for detection dedupe (and product search in Phase 4). Cached by
 * text hash forever: the same label never costs quota twice. Returns null when
 * Gemini is unconfigured, out of quota or failing; callers fall back to word overlap.
 */

let genai: GoogleGenAI | undefined;

export function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v : v.map((x) => x / n);
}

function cacheKey(text: string) {
  const env = getEnv();
  const input = text.trim().toLowerCase().slice(0, 500);
  return { input, key: `embed:${createHash("sha256").update(`${env.GEMINI_EMBEDDING_MODEL}|${env.EMBEDDING_DIM}|${input}`).digest("hex")}` };
}

/**
 * Cache-only lookup for many texts in one query, with no API calls. Used on the frame hot
 * path, where a ~4 s embedding call would delay every new item.
 */
export async function cachedEmbeddings(texts: string[]): Promise<Array<number[] | null>> {
  const keys = texts.map((t) => cacheKey(t).key);
  const rows = await prisma.apiCache.findMany({ where: { key: { in: keys } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value as number[]]));
  return keys.map((k) => byKey.get(k) ?? null);
}

// Identical texts requested at the same time (two frames, matching + backfill) share one
// API call instead of racing each other: saves quota and avoids duplicate cache writes.
const inFlight = new Map<string, Promise<number[] | null>>();

export async function embedText(text: string): Promise<number[] | null> {
  const env = getEnv();
  if (!env.GEMINI_API_KEY) return null;
  const { input, key } = cacheKey(text);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = embedUncached(input, key).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function embedUncached(input: string, key: string): Promise<number[] | null> {
  const env = getEnv();
  const cached = await prisma.apiCache.findUnique({ where: { key } });
  if (cached) return cached.value as number[];

  const budget = await consume("gemini_embed");
  if (!budget.allowed) return null;

  let vec: number[];
  try {
    genai ??= new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const res = await genai.models.embedContent({
      model: env.GEMINI_EMBEDDING_MODEL,
      contents: input,
      config: {
        taskType: "SEMANTIC_SIMILARITY",
        outputDimensionality: env.EMBEDDING_DIM,
        abortSignal: AbortSignal.timeout(10_000),
      },
    });
    const values = res.embeddings?.[0]?.values;
    if (!values || values.length !== env.EMBEDDING_DIM) return null;
    // gemini-embedding-001 only pre-normalizes the full 3072-dim output; truncated
    // vectors must be normalized by us (Gemini embeddings docs).
    vec = l2normalize(values);
  } catch (err) {
    console.warn("[embed] failed, using word-overlap fallback:", err instanceof Error ? err.message : err);
    return null;
  }
  // Another process may have cached the same text a moment ago; that's fine, and the
  // vector we already paid for is still valid, so never let the cache write lose it.
  await prisma.apiCache.createMany({ data: [{ key, kind: "embed", value: vec }], skipDuplicates: true }).catch(() => {});
  return vec;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // inputs are L2-normalized
}
