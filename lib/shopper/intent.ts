import type { RailItem } from "../rail";

/**
 * Pure helpers for the shopping agent (no DB), so they're unit-testable and shared by the
 * AI tools and the no-AI fallback.
 */

/** Buy intent in the viewer's own words. The model alone can't trigger a checkout. */
export const BUY_INTENT = /\b(buy|purchase|order|check ?out|i'?ll take|get (it|this|that|one|the)|add to (cart|bag))\b/i;

/** Significant words of a product title ("Speckled Stoneware Mug" → speckled, stoneware, mug). */
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.replace(/(es|s)$/, ""));

/** The rail item the message is about, by product words ("the mug", "those sneakers"). */
export function productMentioned(message: string, items: RailItem[]): RailItem | null {
  const said = new Set(words(message));
  let best: { item: RailItem; hits: number } | null = null;
  for (const i of items) {
    if (!i.partner) continue;
    const hits = new Set([...words(i.partner.title), ...words(i.label)].filter((w) => said.has(w))).size;
    if (hits > 0 && (!best || hits > best.hits)) best = { item: i, hits };
  }
  return best?.item ?? null;
}
