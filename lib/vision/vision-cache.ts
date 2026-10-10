import type { Prisma } from "@/generated/prisma/client";
import type { VisionResult } from "../ai/vision-schema";
import { prisma } from "../db";
import { hamming } from "./dhash";

/**
 * Vision results cached by frame dHash (ApiCache kind "vision"). Exact hits are free
 * repeats; near hits (DEMO_CACHE) let the pre-recorded demo video run with zero
 * Gemini quota, because re-encoded or re-captured frames hash within a few bits.
 */

export interface CachedVision {
  result: VisionResult;
  provider: string;
}

const key = (dHash: string) => `vision:${dHash}`;

export async function getCachedVision(dHash: string): Promise<CachedVision | null> {
  const row = await prisma.apiCache.findUnique({ where: { key: key(dHash) } });
  return row ? (row.value as unknown as CachedVision) : null;
}

export async function getNearestVision(
  dHash: string,
  maxDistance: number,
): Promise<(CachedVision & { distance: number }) | null> {
  // The demo cache is small (one entry per distinct demo frame): one query, scan in memory.
  const rows = await prisma.apiCache.findMany({ where: { kind: "vision" }, select: { key: true, value: true }, take: 5000 });
  let best: { value: CachedVision; d: number } | null = null;
  for (const r of rows) {
    const d = hamming(dHash, r.key.slice("vision:".length));
    if (d <= maxDistance && (!best || d < best.d)) best = { value: r.value as unknown as CachedVision, d };
  }
  return best ? { ...best.value, distance: best.d } : null;
}

export async function putCachedVision(dHash: string, value: CachedVision): Promise<void> {
  const json = value as unknown as Prisma.InputJsonValue;
  await prisma.apiCache.upsert({
    where: { key: key(dHash) },
    create: { key: key(dHash), kind: "vision", value: json },
    update: { value: json },
  });
}
