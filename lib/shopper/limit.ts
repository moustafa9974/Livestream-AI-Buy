/**
 * Per-viewer message limit for the public shopping assistant. Every message can cost a
 * Gemini request from the shared free quota, so one viewer (or a script) shouldn't be
 * able to spend it all. In memory, like the other realtime state (single instance).
 */

export const SHOPPER_MAX_MESSAGES = 15;
export const SHOPPER_WINDOW_MS = 5 * 60_000;

const g = globalThis as unknown as { seenShopperLimit?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.seenShopperLimit ??= new Map<string, number[]>());

/** Records one message for `key`; false when the viewer is over the limit. */
export function allowShopperMessage(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < SHOPPER_WINDOW_MS);
  if (recent.length >= SHOPPER_MAX_MESSAGES) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  // Forget idle viewers so the map can't grow without bound.
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= SHOPPER_WINDOW_MS)) hits.delete(k);
  return true;
}

export function resetShopperLimitForTests(): void {
  hits.clear();
}
