/**
 * Matching + rail + attribution against the real DB and seeded catalog (run `npm run
 * db:seed` first). Gemini is disabled here, so matching uses the text-only path:
 * deterministic and free. Run with `npm run test:db`.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCheckout } from "../commerce/checkout";
import { FakePayPal } from "../commerce/fake-paypal";
import { prisma } from "../db";
import { resetEnvCache } from "../env";
import { setPayPalGatewayForTests } from "../paypal/gateway";
import { getRail } from "../rail";
import { matchDetection } from "./match";

const tag = randomUUID().slice(0, 8);
const streamId = `test_rstream_${tag}`;
const viewerA = `test_rviewer_a_${tag}`;
const viewerB = `test_rviewer_b_${tag}`;
const savedKey = process.env.GEMINI_API_KEY;

async function detection(label: string, category: string, attributes: Record<string, string>, state: "visible" | "hidden" = "visible") {
  return prisma.detection.create({
    data: { streamId, label, category, attributes, confidence: 0.9, hits: 2, firstSeenSec: 10, lastSeenSec: 14, state, bbox: [0.1, 0.1, 0.3, 0.3] },
  });
}

beforeAll(async () => {
  delete process.env.GEMINI_API_KEY; // text-only matching: no quota, deterministic
  process.env.CHANNEL3_ENABLED = "false";
  resetEnvCache();
  setPayPalGatewayForTests(new FakePayPal());
  await prisma.stream.create({ data: { id: streamId, creatorId: "seed_creator_maya", title: "Rail test", sourceType: "upload", status: "live" } });
  await prisma.viewerSession.createMany({ data: [{ id: viewerA, anonId: `a-${tag}` }, { id: viewerB, anonId: `b-${tag}` }] });
});

afterAll(async () => {
  setPayPalGatewayForTests(undefined);
  if (savedKey) process.env.GEMINI_API_KEY = savedKey;
  delete process.env.CHANNEL3_ENABLED;
  resetEnvCache();
  const orders = await prisma.order.findMany({ where: { viewerSessionId: { in: [viewerA, viewerB] } }, select: { id: true } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: orders.map((o) => o.id) } } });
  await prisma.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
  await prisma.attribution.deleteMany({ where: { streamId } });
  const dets = await prisma.detection.findMany({ where: { streamId }, select: { id: true } });
  await prisma.productMatch.deleteMany({ where: { detectionId: { in: dets.map((d) => d.id) } } });
  await prisma.detection.deleteMany({ where: { streamId } });
  await prisma.stream.deleteMany({ where: { id: streamId } });
  await prisma.viewerSession.deleteMany({ where: { id: { in: [viewerA, viewerB] } } });
  await prisma.$disconnect();
});

describe("matching → rail", () => {
  it("matches what the camera saw to the right partner product", async () => {
    const hoodie = await detection("black hooded sweatshirt", "apparel/hoodie", { color: "black" });
    const mic = await detection("wireless clip-on microphone", "electronics/microphone", { color: "black" });
    const bike = await detection("red road bicycle", "sports/bicycle", { color: "red" });

    expect(await matchDetection(hoodie.id)).toMatchObject({ kind: "exact", backend: "postgres" });
    expect((await matchDetection(mic.id)).kind).toBe("exact");
    expect((await matchDetection(bike.id)).kind).toBeNull(); // no store sells bikes: no fake match

    const rail = await getRail(streamId);
    const byLabel = Object.fromEntries(rail.items.map((i) => [i.label, i.partner?.title ?? null]));
    // No store sells bicycles: it stays off the viewer rail entirely.
    expect(byLabel).toEqual({
      "black hooded sweatshirt": "Everyday Oversized Hoodie: Black",
      "wireless clip-on microphone": "Clip-On Wireless Mic Kit",
    });
    const card = rail.items.find((i) => i.label === "black hooded sweatshirt")!;
    expect(card.partner).toMatchObject({ priceMinor: 4500, currency: "USD", merchantName: "Northloop Apparel" });
  });

  it("re-matching replaces old matches instead of piling up", async () => {
    const d = await detection("speckled ceramic mug", "home/mug", { color: "cream" });
    await matchDetection(d.id);
    await matchDetection(d.id);
    expect(await prisma.productMatch.count({ where: { detectionId: d.id } })).toBe(1);
  });

  it("a pinned item shows to viewers even with nothing to buy yet", async () => {
    const d = await detection("black quilted bomber jacket", "apparel/jacket", { color: "black" });
    await matchDetection(d.id);
    expect((await getRail(streamId)).items.find((i) => i.detectionId === d.id)).toBeUndefined(); // visible, unbuyable: hidden
    await prisma.detection.update({ where: { id: d.id }, data: { state: "pinned" } });
    const card = (await getRail(streamId)).items.find((i) => i.detectionId === d.id);
    expect(card).toMatchObject({ state: "pinned", partner: null });
  });

  it("one card per product when the AI describes it several ways", async () => {
    const a = await detection("black fleece hoodie", "apparel/hoodie", { color: "black" });
    const b = await detection("black hooded sweatshirt", "apparel/hoodie", { color: "black" });
    await matchDetection(a.id);
    await matchDetection(b.id);
    // Both really matched the same store product, so the rail must collapse them.
    const matched = await prisma.productMatch.findMany({ where: { detectionId: { in: [a.id, b.id] }, source: "partner" } });
    expect(new Set(matched.map((m) => m.partnerProductId))).toEqual(new Set(["seed_prod_black_hoodie"]));
    expect(matched).toHaveLength(2);
    const hoodieCards = (await getRail(streamId)).items.filter((i) => i.partner?.title === "Everyday Oversized Hoodie: Black");
    expect(hoodieCards).toHaveLength(1);
  });

  it("hidden detections never reach viewers", async () => {
    const d = await detection("round tortoise sunglasses", "accessories/sunglasses", { color: "tortoiseshell" }, "hidden");
    await matchDetection(d.id);
    expect((await getRail(streamId)).items.find((i) => i.detectionId === d.id)).toBeUndefined();
  });
});

describe("attribution", () => {
  it("credits the stream moment the viewer clicked", async () => {
    const d = await prisma.detection.findFirstOrThrow({ where: { streamId, label: "black hooded sweatshirt" } });
    const a = await prisma.attribution.create({
      data: { streamId, detectionId: d.id, partnerProductId: "seed_prod_black_hoodie", viewerSessionId: viewerA, tsSec: 12.5 },
    });
    const { orderId } = await startCheckout({
      partnerProductId: "seed_prod_black_hoodie", quantity: 1, viewerSessionId: viewerA, paymentMethod: "paypal", attributionId: a.id,
    });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).attributionId).toBe(a.id);
  });

  it("ignores someone else's click, or a click for a different product", async () => {
    const a = await prisma.attribution.create({
      data: { streamId, partnerProductId: "seed_prod_black_hoodie", viewerSessionId: viewerA, tsSec: 3 },
    });
    const stolen = await startCheckout({
      partnerProductId: "seed_prod_black_hoodie", quantity: 1, viewerSessionId: viewerB, paymentMethod: "paypal", attributionId: a.id,
    });
    const wrongProduct = await startCheckout({
      partnerProductId: "seed_prod_ceramic_mug", quantity: 1, viewerSessionId: viewerA, paymentMethod: "paypal", attributionId: a.id,
    });
    for (const { orderId } of [stolen, wrongProduct]) {
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).attributionId).toBeNull();
    }
  });
});
