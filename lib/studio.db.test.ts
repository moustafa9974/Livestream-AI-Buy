/**
 * Phase 5 integration: notifications on sales/payouts, recap numbers, and the creator
 * assistant's tools (scoping + money-action gating), with a fake PayPal and no AI.
 * Run with `npm run test:db`.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orderRef, runTool } from "./assistant/tools";
import { captureCheckout, startCheckout } from "./commerce/checkout";
import { FakePayPal } from "./commerce/fake-paypal";
import { prisma } from "./db";
import { resetEnvCache } from "./env";
import { isPublicHttpsUrl } from "./kernel/watcher";
import { setPayPalGatewayForTests } from "./paypal/gateway";
import { generateRecap, recapStats } from "./recap";

const tag = randomUUID().slice(0, 8);
const ids = {
  creator: `test_p5creator_${tag}`,
  other: `test_p5other_${tag}`,
  stream: `test_p5stream_${tag}`,
  otherStream: `test_p5ostream_${tag}`,
  viewer: `test_p5viewer_${tag}`,
};
const saved = { key: process.env.GEMINI_API_KEY };
let fake: FakePayPal;

async function sale(streamId = ids.stream) {
  const { paypalOrderId, orderId } = await startCheckout({
    partnerProductId: "seed_prod_black_hoodie",
    quantity: 1,
    viewerSessionId: ids.viewer,
    paymentMethod: "paypal",
    attribution: { streamId, tsSec: 95 },
  });
  await captureCheckout(paypalOrderId, "viewer");
  return orderId;
}

const settle = () => new Promise((r) => setTimeout(r, 1500)); // notify() runs fire-and-forget

beforeAll(async () => {
  delete process.env.GEMINI_API_KEY; // recap falls back to its template: deterministic, free
  resetEnvCache();
  fake = new FakePayPal();
  setPayPalGatewayForTests(fake);
  await prisma.creator.createMany({
    data: [
      { id: ids.creator, slug: `p5-${tag}`, displayName: "P5 Creator", payoutEmail: "sb-p5@personal.example.com" },
      { id: ids.other, slug: `p5o-${tag}`, displayName: "Other Creator", payoutEmail: "sb-o@personal.example.com" },
    ],
  });
  const started = new Date(Date.now() - 30 * 60_000);
  await prisma.stream.createMany({
    data: [
      { id: ids.stream, creatorId: ids.creator, title: "P5 stream", sourceType: "screen", status: "ended", startedAt: started, endedAt: new Date() },
      { id: ids.otherStream, creatorId: ids.other, title: "Other stream", sourceType: "screen", status: "live" },
    ],
  });
  await prisma.viewerSession.create({ data: { id: ids.viewer, anonId: `p5-${tag}` } });
});

afterAll(async () => {
  setPayPalGatewayForTests(undefined);
  if (saved.key) process.env.GEMINI_API_KEY = saved.key;
  resetEnvCache();
  const creators = [ids.creator, ids.other];
  const orders = await prisma.order.findMany({ where: { viewerSessionId: ids.viewer }, select: { id: true } });
  const commissions = await prisma.commission.findMany({ where: { creatorId: { in: creators } } });
  const batchIds = [...new Set(commissions.flatMap((c) => (c.payoutBatchId ? [c.payoutBatchId] : [])))];
  const dets = await prisma.detection.findMany({ where: { streamId: { in: [ids.stream, ids.otherStream] } }, select: { id: true } });
  await prisma.auditEvent.deleteMany({
    where: { entityId: { in: [...orders.map((o) => o.id), ...commissions.map((c) => c.id), ...batchIds, ...dets.map((d) => d.id)] } },
  });
  await prisma.commission.deleteMany({ where: { creatorId: { in: creators } } });
  await prisma.payoutBatch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.refund.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
  await prisma.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
  await prisma.attribution.deleteMany({ where: { viewerSessionId: ids.viewer } });
  await prisma.viewerSession.deleteMany({ where: { id: ids.viewer } });
  await prisma.creator.deleteMany({ where: { id: { in: creators } } }); // cascades streams, detections, notifications
  await prisma.$disconnect();
});

describe("notifications", () => {
  it("a captured sale notifies the creator (Zapier skipped when off)", async () => {
    await sale();
    await settle();
    const n = await prisma.notification.findFirst({ where: { creatorId: ids.creator, type: "sale.created" } });
    expect(n).toMatchObject({ title: "New sale: Everyday Oversized Hoodie: Black", zapierStatus: "skipped" });
    expect(n!.body).toContain("$4.50");
  });

  it("a paid payout notifies the creator", async () => {
    const r = await runTool("pay_me_now", { confirm: true }, { creatorId: ids.creator, lastUserMessage: "pay me now please" });
    expect(r).toMatchObject({ status: "submitted" });
    const { syncPayoutBatch } = await import("./commerce/payouts");
    const c = await prisma.commission.findFirstOrThrow({ where: { creatorId: ids.creator } });
    await syncPayoutBatch(c.payoutBatchId!);
    await settle();
    expect(await prisma.notification.count({ where: { creatorId: ids.creator, type: "commission.paid" } })).toBe(1);
  });
});

describe("recap", () => {
  it("numbers come from the DB; the headline never states amounts", async () => {
    await prisma.detection.create({
      data: { streamId: ids.stream, label: "black hoodie", category: "apparel/hoodie", confidence: 0.9, firstSeenSec: 95, lastSeenSec: 100, state: "visible" },
    });
    const stats = await recapStats(ids.stream);
    expect(stats).toMatchObject({ products: 1, sales: 1, earnedMinor: 450, currency: "USD" });
    expect(stats.durationMin).toBeGreaterThanOrEqual(29);
    const headline = await generateRecap(ids.stream);
    // Amounts only ever come from statsLine(); the headline (AI or template) never has them.
    expect(headline).not.toMatch(/\$|4\.50|450/);
    await settle();
    expect(await prisma.notification.count({ where: { creatorId: ids.creator, type: "stream.recap" } })).toBe(1);
  });
});

describe("assistant tools", () => {
  const ctx = (lastUserMessage: string) => ({ creatorId: ids.creator, lastUserMessage });

  it("earnings are scoped to the signed-in creator and precomputed", async () => {
    await sale(ids.otherStream); // someone else's sale must not show up
    const r = (await runTool("earnings_summary", { period: "all" }, ctx("how much?"))) as Record<string, unknown>;
    expect(r).toMatchObject({ sales: 1, paid: "$4.50", total_earned: "$4.50" });
  });

  it("recent orders use short refs and never include other creators' orders", async () => {
    const r = (await runTool("recent_orders", { limit: 10 }, ctx("orders"))) as Array<{ ref: string; product: string }>;
    expect(r).toHaveLength(1);
    expect(r[0].ref).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("money actions need an explicit request in the latest message", async () => {
    expect(await runTool("pay_me_now", { confirm: true }, ctx("what's my balance?"))).toHaveProperty("error");
    expect(await runTool("pay_me_now", { confirm: false }, ctx("pay me"))).toHaveProperty("error");
    const order = await prisma.order.findFirstOrThrow({ where: { attribution: { streamId: ids.stream } } });
    const ref = orderRef(order.id);
    expect(await runTool("refund_order", { order_ref: ref, confirm: true }, ctx("refund something"))).toHaveProperty("error");
    expect(fake.count("refund:")).toBe(0);
    const ok = await runTool("refund_order", { order_ref: ref, confirm: true }, ctx(`please refund order ${ref}`));
    expect(ok).toMatchObject({ ref, status: "REFUNDED" });
  });

  it("can't touch another creator's order", async () => {
    const other = await prisma.order.findFirstOrThrow({ where: { attribution: { streamId: ids.otherStream } } });
    const ref = orderRef(other.id);
    expect(await runTool("refund_order", { order_ref: ref, confirm: true }, ctx(`refund order ${ref}`))).toEqual({ error: "No order with that reference" });
  });

  it("hide_detections only affects the creator's current stream", async () => {
    await prisma.stream.update({ where: { id: ids.stream }, data: { status: "live" } });
    const d = await prisma.detection.create({
      data: { streamId: ids.stream, label: "round tortoise sunglasses", category: "accessories/sunglasses", confidence: 0.9, firstSeenSec: 5, lastSeenSec: 6, state: "visible" },
    });
    const r = await runTool("hide_detections", { label_contains: "sunglasses" }, ctx("hide all sunglasses"));
    expect(r).toEqual({ hidden: ["round tortoise sunglasses"] });
    expect((await prisma.detection.findUniqueOrThrow({ where: { id: d.id } })).state).toBe("hidden");
  });
});

describe("KERNEL URL guard", () => {
  it("only public https pages", () => {
    expect(isPublicHttpsUrl("https://www.twitch.tv/maya")).toBe(true);
    expect(isPublicHttpsUrl("http://www.twitch.tv/maya")).toBe(false);
    expect(isPublicHttpsUrl("https://localhost:3000")).toBe(false);
    expect(isPublicHttpsUrl("https://192.168.1.10/stream")).toBe(false);
  });
});
