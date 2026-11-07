import { z } from "zod";
import { currencyExponent, isSupportedCurrency, toMinor } from "../money";

/** Pure Channel3 response handling (no I/O), shared by the client and the rail. */

// Only the fields we use, per the documented SearchResponse/Product/ProductOffer.
const Offer = z.object({
  url: z.string(),
  domain: z.string(),
  price: z.object({ price: z.number(), currency: z.string(), compare_at_price: z.number().nullish() }),
  availability: z.string(),
});
const Product = z.object({
  id: z.string(),
  title: z.string(),
  images: z.array(z.object({ url: z.string(), is_main_image: z.boolean().optional() })).default([]),
  offers: z.array(Offer).default([]),
});
const SearchResponse = z.object({ products: z.array(Product) });

export interface SimilarItem {
  title: string;
  priceMinor: number;
  currency: string;
  retailer: string;
  url: string;
  image: string | null;
}

export function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** External float price → minor units via a fixed-decimal string (display/comparison only). */
function priceToMinor(price: number, currency: string): number | null {
  if (!isSupportedCurrency(currency) || !Number.isFinite(price) || price <= 0) return null;
  return toMinor(price.toFixed(currencyExponent(currency)), currency);
}

export function toSimilarItems(raw: unknown, limit: number): SimilarItem[] {
  const parsed = SearchResponse.safeParse(raw);
  if (!parsed.success) return [];
  const out: SimilarItem[] = [];
  for (const p of parsed.data.products) {
    const offer = p.offers.find((o) => o.availability === "InStock") ?? p.offers[0];
    if (!offer) continue;
    const priceMinor = priceToMinor(offer.price.price, offer.price.currency);
    if (priceMinor === null || !/^https:\/\//.test(offer.url)) continue;
    // Channel3 can list the same offer under two products. Once is enough: a repeat
    // would show twice and count twice in the price comparison.
    if (out.some((o) => o.url === offer.url)) continue;
    const image = (p.images.find((i) => i.is_main_image) ?? p.images[0])?.url ?? null;
    out.push({
      title: p.title.slice(0, 120),
      priceMinor,
      currency: offer.price.currency,
      retailer: offer.domain,
      url: offer.url,
      image: image && /^https:\/\//.test(image) ? image : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** "$12 less than similar items": median of same-currency similar prices vs ours. */
export function priceComparison(ourMinor: number, currency: string, similar: SimilarItem[]) {
  const prices = similar.filter((s) => s.currency === currency).map((s) => s.priceMinor).sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
  return { similarMedianMinor: median, savingsMinor: median - ourMinor };
}
