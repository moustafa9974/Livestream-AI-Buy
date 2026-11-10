import { describe, expect, it } from "vitest";
import { normalizeQuery, priceComparison, toSimilarItems } from "../channel3/parse";
import { searchWords } from "../search/types";
import { classify, coverage, scoreCandidate } from "./score";

const VEC = { exact: 0.85, similar: 0.7 };
const TEXT = { exact: 0.4, similar: 0.3 };

const hoodieBlack = { title: "Everyday Oversized Hoodie: Black", category: "apparel/hoodie", attributes: { color: "black", material: "cotton fleece" } };
const hoodieGrey = { title: "Everyday Oversized Hoodie: Heather Grey", category: "apparel/hoodie", attributes: { color: "heather grey" } };
const usbMic = { title: "Desktop USB Condenser Mic", category: "electronics/microphone", attributes: { color: "silver", type: "usb condenser" } };

describe("match scoring (cases from the 2026-10-10 calibration run)", () => {
  const seenHoodie = { label: "black hooded sweatshirt", category: "apparel/hoodie", attributes: { color: "black" } };

  it("a strong embedding match with the right colour is exact", () => {
    const s = scoreCandidate(seenHoodie, hoodieBlack, 0.942);
    expect(classify(s, VEC)).toBe("exact");
  });

  it("the same product in another colour is never exact", () => {
    const s = scoreCandidate(seenHoodie, hoodieGrey, 0.95);
    expect(s.colorConflict).toBe(true);
    expect(classify(s, VEC)).not.toBe("exact");
  });

  it("generic shared words don't create matches (silver laptop ≠ silver mic)", () => {
    const seen = { label: "silver laptop", category: "electronics/laptop", attributes: { color: "silver" } };
    expect(coverage(seen, usbMic)).toBe(0);
    expect(classify(scoreCandidate(seen, usbMic, 0.873), VEC)).toBeNull();
  });

  it("different departments are penalised", () => {
    const seen = { label: "black sneakers", category: "footwear/sneakers", attributes: { color: "black" } };
    expect(scoreCandidate(seen, hoodieBlack, 0.8).reasons).toContain("category_mismatch");
  });

  it("text-only mode: a shared adjective is not a match (keyboard ≠ wireless mic)", () => {
    const seen = { label: "wireless keyboard", category: "electronics/keyboard", attributes: { color: "white" } };
    const mic = { title: "Clip-On Wireless Mic Kit", category: "electronics/microphone", attributes: { color: "black", type: "wireless lavalier" } };
    expect(classify(scoreCandidate(seen, mic, null), TEXT)).toBeNull();
  });

  it("a different kind of product is never 'similar', even with close embeddings", () => {
    const seen = { label: "wireless keyboard", category: "electronics/keyboard", attributes: { color: "white" } };
    const mic = { title: "Clip-On Wireless Mic Kit", category: "electronics/microphone", attributes: { color: "black", type: "wireless lavalier" } };
    expect(classify(scoreCandidate(seen, mic, 0.9), VEC)).toBeNull();
    // A naming variant of the same kind of product still matches.
    const sweat = { label: "black sweatshirt", category: "apparel/sweatshirt", attributes: { color: "black" } };
    expect(classify(scoreCandidate(sweat, hoodieBlack, 0.93), VEC)).not.toBeNull();
  });

  it("text-only mode still finds the right product", () => {
    const s = scoreCandidate(seenHoodie, hoodieBlack, null);
    expect(classify(s, TEXT)).toBe("exact");
    const mic = scoreCandidate({ label: "wireless clip-on microphone", category: "electronics/microphone", attributes: {} },
      { title: "Clip-On Wireless Mic Kit", category: "electronics/microphone", attributes: { color: "black" } }, null);
    expect(classify(mic, TEXT)).toBe("exact");
  });
});

describe("searchWords", () => {
  it("lowercases, strips punctuation and stopwords, singularizes", () => {
    expect(searchWords("The Black Hoodies, with pockets!")).toEqual(["black", "hoodie", "pocket"]);
    expect(searchWords("glass")).toEqual(["glass"]); // not "glas"
  });
});

describe("Channel3 parsing", () => {
  const response = {
    products: [
      {
        id: "p1",
        title: "Fleece Pullover Hoodie",
        images: [{ url: "https://img.example/a.jpg", is_main_image: true }],
        offers: [
          { url: "https://shop-a.example/p1", domain: "shop-a.example", price: { price: 59.99, currency: "USD" }, availability: "InStock" },
        ],
      },
      { id: "p2", title: "No offers", offers: [] },
      {
        id: "p3",
        title: "Insecure link",
        offers: [{ url: "http://bad.example", domain: "bad.example", price: { price: 10, currency: "USD" }, availability: "InStock" }],
      },
      {
        id: "p4",
        title: "Classic Hoodie",
        offers: [{ url: "https://shop-b.example/p4", domain: "shop-b.example", price: { price: 54.5, currency: "USD" }, availability: "InStock" }],
      },
    ],
    next_page_token: null,
  };

  it("maps documented fields, skips unusable products, converts prices exactly", () => {
    const items = toSimilarItems(response, 3);
    expect(items).toEqual([
      { title: "Fleece Pullover Hoodie", priceMinor: 5999, currency: "USD", retailer: "shop-a.example", url: "https://shop-a.example/p1", image: "https://img.example/a.jpg" },
      { title: "Classic Hoodie", priceMinor: 5450, currency: "USD", retailer: "shop-b.example", url: "https://shop-b.example/p4", image: null },
    ]);
  });

  it("lists an offer once even when Channel3 returns it under two products", () => {
    const dup = { ...response, products: [...response.products, { ...response.products[0], id: "p1-again", title: "Same offer again" }] };
    const items = toSimilarItems(dup, 5);
    expect(items.map((i) => i.url)).toEqual(["https://shop-a.example/p1", "https://shop-b.example/p4"]);
  });

  it("returns [] for malformed responses instead of throwing", () => {
    expect(toSimilarItems({ nope: true }, 3)).toEqual([]);
    expect(toSimilarItems(null, 3)).toEqual([]);
  });

  it("normalizes queries for the cache key", () => {
    expect(normalizeQuery("  Black   HOODIE!! ")).toBe("black hoodie");
  });

  it("computes the 'less than similar items' comparison from the median", () => {
    const similar = toSimilarItems(response, 3);
    expect(priceComparison(4500, "USD", similar)).toEqual({ similarMedianMinor: 5725, savingsMinor: 1225 });
    expect(priceComparison(4500, "EUR", similar)).toBeNull();
  });

  it("ignores look-alikes priced in another league (no '$345 less' for $35 sunglasses)", () => {
    const at = (priceMinor: number) => ({ title: "x", priceMinor, currency: "USD", retailer: "r", url: `https://r/${priceMinor}`, image: null });
    // $290 and $570 designer frames vs our $35: not comparable, so no badge at all.
    expect(priceComparison(3500, "USD", [at(29050), at(56963)])).toBeNull();
    // Comparable ones still count; the outlier is dropped from the median.
    expect(priceComparison(3500, "USD", [at(4200), at(5000), at(56963)])).toEqual({ similarMedianMinor: 4600, savingsMinor: 1100 });
  });
});
