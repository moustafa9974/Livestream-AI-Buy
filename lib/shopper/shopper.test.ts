import { beforeEach, describe, expect, it } from "vitest";
import type { RailItem } from "../rail";
import { allowShopperMessage, resetShopperLimitForTests, SHOPPER_MAX_MESSAGES, SHOPPER_WINDOW_MS } from "./limit";
import { BUY_INTENT, productMentioned } from "./intent";

const item = (detectionId: string, title: string, label: string): RailItem => ({
  detectionId,
  label,
  state: "visible",
  firstSeenSec: 0,
  lastSeenSec: 0,
  bbox: null,
  partner: { productId: `p_${detectionId}`, title, merchantName: "Shop", priceMinor: 1000, currency: "USD", image: null, kind: "exact" },
  similar: [],
  comparison: null,
});

describe("shopping agent: buy intent", () => {
  it("only explicit purchase wording counts", () => {
    for (const yes of ["buy the mug", "I'll take the hoodie", "get the black one", "checkout the lamp", "Add to cart please", "order it"]) {
      expect(BUY_INTENT.test(yes), yes).toBe(true);
    }
    for (const no of ["what's on screen?", "is the mug cheaper elsewhere?", "tell me about the hoodie", "how much is the lamp", "getting late"]) {
      expect(BUY_INTENT.test(no), no).toBe(false);
    }
  });
});

describe("shopping agent: which product the viewer means", () => {
  const items = [
    item("mug", "Speckled Stoneware Mug", "speckled stoneware mug"),
    item("hoodie", "Everyday Oversized Hoodie: Black", "black hoodie"),
    item("shoes", "Court Low Sneakers: White", "white sneakers"),
  ];

  it("matches product words, including plurals", () => {
    expect(productMentioned("buy the mug", items)?.detectionId).toBe("mug");
    expect(productMentioned("are those sneakers cheaper?", items)?.detectionId).toBe("shoes");
    expect(productMentioned("tell me about the black hoodie", items)?.detectionId).toBe("hoodie");
  });

  it("returns null when no product is named", () => {
    expect(productMentioned("what's on screen?", items)).toBeNull();
  });
});

describe("shopping agent: per-viewer message limit", () => {
  beforeEach(() => resetShopperLimitForTests());

  it("allows a burst, then blocks until the window passes", () => {
    for (let i = 0; i < SHOPPER_MAX_MESSAGES; i++) expect(allowShopperMessage("v1", 0)).toBe(true);
    expect(allowShopperMessage("v1", 1)).toBe(false);
    expect(allowShopperMessage("v2", 1)).toBe(true); // other viewers unaffected
    expect(allowShopperMessage("v1", SHOPPER_WINDOW_MS + 1)).toBe(true);
  });
});
