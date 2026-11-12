/**
 * Viewer shopping agent against the real DB and seeded catalog (run `npm run db:seed`
 * first). Gemini is off, so runShopper uses its no-AI path: deterministic and free.
 * Run with `npm run test:db`.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { resetEnvCache } from "../env";
import { quickShopperAnswer, runShopper } from "./run";
import { runShopperTool, type ShopperContext } from "./tools";

const tag = randomUUID().slice(0, 8);
const streamId = `test_shop_${tag}`;
const otherStreamId = `test_shop_other_${tag}`;
const savedKey = process.env.GEMINI_API_KEY;

const ctx = (lastUserMessage: string): ShopperContext => ({ streamId, creatorName: "Maya Makes", lastUserMessage });

async function onScreen(stream: string, productId: string, label: string, similar: Array<{ retailer: string; priceMinor: number }> = []) {
  const d = await prisma.detection.create({
    data: { streamId: stream, label, category: "x", attributes: {}, confidence: 0.9, hits: 2, firstSeenSec: 30, lastSeenSec: 40, state: "visible" },
  });
  await prisma.productMatch.create({ data: { detectionId: d.id, source: "partner", partnerProductId: productId, score: 0.95, kind: "exact" } });
  for (const [i, s] of similar.entries()) {
    await prisma.productMatch.create({
      data: {
        detectionId: d.id,
        source: "channel3",
        kind: "similar",
        score: 1 - i * 0.1,
        externalRef: { title: `${label} elsewhere`, priceMinor: s.priceMinor, currency: "USD", retailer: s.retailer, url: `https://${s.retailer}/p/${i}`, image: null },
      },
    });
  }
  return d;
}

beforeAll(async () => {
  delete process.env.GEMINI_API_KEY; // forces the no-AI path
  resetEnvCache();
  await prisma.stream.createMany({
    data: [
      { id: streamId, creatorId: "seed_creator_maya", title: "Shop test", sourceType: "upload", status: "live" },
      { id: otherStreamId, creatorId: "seed_creator_maya", title: "Other", sourceType: "upload", status: "live" },
    ],
  });
  await onScreen(streamId, "seed_prod_ceramic_mug", "speckled stoneware mug", [
    { retailer: "crateandbarrel.com", priceMinor: 1295 },
    { retailer: "franceandson.com", priceMinor: 8800 },
  ]);
  await onScreen(streamId, "seed_prod_black_hoodie", "black hoodie");
  await onScreen(otherStreamId, "seed_prod_desk_lamp", "desk lamp"); // must never leak into streamId
});

afterAll(async () => {
  if (savedKey) process.env.GEMINI_API_KEY = savedKey;
  resetEnvCache();
  const dets = await prisma.detection.findMany({ where: { streamId: { in: [streamId, otherStreamId] } }, select: { id: true } });
  await prisma.productMatch.deleteMany({ where: { detectionId: { in: dets.map((d) => d.id) } } });
  await prisma.detection.deleteMany({ where: { streamId: { in: [streamId, otherStreamId] } } });
  await prisma.stream.deleteMany({ where: { id: { in: [streamId, otherStreamId] } } });
  await prisma.$disconnect();
});

describe("shopping agent tools", () => {
  it("lists only this stream's products, with DB prices", async () => {
    const { result } = await runShopperTool("products_on_screen", {}, ctx("what's on screen?"));
    const products = (result as { products: Array<{ product_id: string; price: string }> }).products;
    expect(products.map((p) => p.product_id).sort()).toEqual(["seed_prod_black_hoodie", "seed_prod_ceramic_mug"]);
    expect(products.find((p) => p.product_id === "seed_prod_ceramic_mug")?.price).toBe("$22.00");
  });

  it("never offers checkout without the viewer explicitly asking to buy", async () => {
    const noIntent = await runShopperTool("prepare_checkout", { product_id: "seed_prod_ceramic_mug", confirm: true }, ctx("is the mug nice?"));
    expect(noIntent.checkout).toBeUndefined();
    const noConfirm = await runShopperTool("prepare_checkout", { product_id: "seed_prod_ceramic_mug", confirm: false }, ctx("buy the mug"));
    expect(noConfirm.checkout).toBeUndefined();
  });

  it("can't check out a product from another stream, even if the model names it", async () => {
    const out = await runShopperTool("prepare_checkout", { product_id: "seed_prod_desk_lamp", confirm: true }, ctx("buy the lamp"));
    expect(out.checkout).toBeUndefined();
    expect(out.result).toMatchObject({ error: expect.stringContaining("isn't on this stream") });
  });

  it("offers a Buy card with the price from the DB when asked", async () => {
    const out = await runShopperTool("prepare_checkout", { product_id: "seed_prod_ceramic_mug", confirm: true }, ctx("buy the mug"));
    expect(out.checkout).toMatchObject({ productId: "seed_prod_ceramic_mug", price: "$22.00", title: "Speckled Stoneware Mug" });
  });

  it("compares prices honestly from stored Channel3 offers", async () => {
    const { result } = await runShopperTool("compare_prices", { product_id: "seed_prod_ceramic_mug" }, ctx("cheaper?"));
    expect(result).toMatchObject({ price_here: "$22.00", cheapest_elsewhere: { store: "crateandbarrel.com", price: "$12.95" } });
  });
});

describe("shopping agent without the AI", () => {
  it("answers 'buy the mug' with a Buy card", async () => {
    const r = await quickShopperAnswer(ctx("buy the mug"));
    expect(r.checkout?.productId).toBe("seed_prod_ceramic_mug");
  });

  it("answers price questions with the real cheapest offer", async () => {
    const r = await quickShopperAnswer(ctx("is the mug cheaper anywhere else?"));
    expect(r.reply).toContain("$12.95");
    expect(r.checkout).toBeNull();
  });

  it("says so when it's already cheapest here", async () => {
    await onScreen(streamId, "seed_prod_white_sneakers", "white sneakers", [{ retailer: "kickscrew.com", priceMinor: 17550 }]);
    const r = await quickShopperAnswer(ctx("are the sneakers cheaper anywhere?"));
    expect(r.reply).toMatch(/already the best price/i);
  });

  it("refuses discounts instead of making one up", async () => {
    const r = await quickShopperAnswer(ctx("can you give me 50% off the hoodie?"));
    expect(r.reply).toMatch(/can't change prices/i);
    expect(r.checkout).toBeNull();
  });

  it("falls back automatically when Gemini isn't available", async () => {
    const r = await runShopper({ streamId, creatorName: "Maya Makes" }, [{ role: "user", text: "what's on screen?" }]);
    expect(r.mode).toBe("quick");
    expect(r.reply).toContain("Speckled Stoneware Mug");
    expect(r.reply).not.toContain("Desk Lamp");
  });
});
