import { createHash } from "node:crypto";
import { consume } from "../budget";
import { prisma } from "../db";
import { getEnv } from "../env";
import { isEnabled } from "../flags";
import { normalizeQuery, toSimilarItems, type SimilarItem } from "./parse";

export type { SimilarItem } from "./parse";

/**
 * Channel3 product search (docs.trychannel3.com, POST /v1/search, x-api-key).
 * Used for open-web "similar items" and price comparison. These are links, never
 * PayPal checkouts (we aren't the merchant). Cached 24h by normalized query, capped
 * per day by the budget guard, and never allowed to block the rail: every failure
 * returns [].
 */

const API = "https://api.trychannel3.com/v1/search";
const CACHE_TTL_MS = 24 * 3_600_000;

export async function findSimilarItems(query: string, limit = 3): Promise<SimilarItem[]> {
  if (!isEnabled("channel3")) return [];
  const q = normalizeQuery(query);
  if (!q) return [];
  const key = `channel3:${createHash("sha256").update(`${q}|${limit}`).digest("hex")}`;

  const cached = await prisma.apiCache.findUnique({ where: { key } });
  if (cached && (!cached.expiresAt || cached.expiresAt > new Date())) return cached.value as unknown as SimilarItem[];

  if (!(await consume("channel3")).allowed) return [];
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": getEnv().CHANNEL3_API_KEY! },
      body: JSON.stringify({ query: q, limit: Math.min(10, limit * 3) }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.warn("[channel3] HTTP", res.status); // 402 = free credits used up
      return [];
    }
    const items = toSimilarItems(await res.json(), limit);
    const value = items as unknown as object[];
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
    await prisma.apiCache.upsert({
      where: { key },
      create: { key, kind: "channel3", value, expiresAt },
      update: { value, expiresAt },
    });
    return items;
  } catch (err) {
    console.warn("[channel3] failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
