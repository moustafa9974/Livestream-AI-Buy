/**
 * Money-flow integration tests against a real Postgres (your DATABASE_URL) with a fake
 * PayPal. Run with `npm run test:db`. Each test builds its own creator/product "world"
 * with test_ ids and everything is deleted afterwards.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db";
import { setPayPalGatewayForTests } from "../paypal/gateway";
import { applyCapture, captureCheckout, startCheckout } from "./checkout";
import { FakePayPal } from "./fake-paypal";
import { payMeNow, syncPayoutBatch } from "./payouts";
import { refundOrder } from "./refunds";
import { handleWebhookEvent } from "./webhooks";

const PRICE = 4500; // $45.00 at 10% → $4.50 commission
const worlds: World[] = [];
let fake: FakePayPal;

interface World {
  creatorId: string;
  streamId: string;
  productId: string;
  merchantId: string;
  viewerId: string;
}

async function makeWorld(): Promise<World> {
  const tag = randomUUID().slice(0, 8);
  const creator = await prisma.creator.create({
    data: { id: `test_creator_${tag}`, slug: `test-${tag}`, displayName: "Test Creator", payoutEmail: "sb-test@personal.example.com", commissionRateBps: 1000 },
  });
  const stream = await prisma.stream.create({
    data: { id: `test_stream_${tag}`, creatorId: creator.id, title: "Test stream", sourceType: "upload", status: "live" },
  });
  const merchant = await prisma.merchant.create({ data: { id: `test_merchant_${tag}`, name: "Test Merchant" } });
  const product = await prisma.partnerProduct.create({
    data: { id: `test_prod_${tag}`, merchantId: merchant.id, title: "Test Hoodie", description: "", category: "apparel/hoodie", priceMinor: PRICE, stock: 100 },
  });
  const viewer = await prisma.viewerSession.create({ data: { id: `test_viewer_${tag}`, anonId: `test-anon-${tag}` } });
  const w = { creatorId: creator.id, streamId: stream.id, productId: product.id, merchantId: merchant.id, viewerId: viewer.id };
  worlds.push(w);
  return w;
}

async function buy(w: World, method: "paypal" | "card" = "paypal") {
  return startCheckout({
    partnerProductId: w.productId,
    quantity: 1,
    viewerSessionId: w.viewerId,
    paymentMethod: method,
    attribution: { streamId: w.streamId, tsSec: 754 },
  });
}

async function buyAndCapture(w: World) {
  const { orderId, paypalOrderId } = await buy(w);
  await captureCheckout(paypalOrderId, "viewer");
  return { orderId, paypalOrderId };
}

const commissionsOf = (w: World) => prisma.commission.findMany({ where: { creatorId: w.creatorId }, orderBy: { createdAt: "asc" } });
const eventId = () => `TEST-WH-${randomUUID()}`;

beforeEach(() => {
  fake = new FakePayPal();
  setPayPalGatewayForTests(fake);
});

afterAll(async () => {
  setPayPalGatewayForTests(undefined);
  for (const w of worlds) {
    const orders = await prisma.order.findMany({ where: { viewerSessionId: w.viewerId }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    const commissions = await prisma.commission.findMany({ where: { creatorId: w.creatorId } });
    const batchIds = [...new Set(commissions.flatMap((c) => (c.payoutBatchId ? [c.payoutBatchId] : [])))];
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: [...orderIds, ...commissions.map((c) => c.id), ...batchIds] } } });
    await prisma.commission.deleteMany({ where: { creatorId: w.creatorId } });
    await prisma.payoutBatch.deleteMany({ where: { id: { in: batchIds } } });
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.attribution.deleteMany({ where: { streamId: w.streamId } });
    await prisma.viewerSession.deleteMany({ where: { id: w.viewerId } });
    await prisma.stream.deleteMany({ where: { id: w.streamId } });
    await prisma.partnerProduct.deleteMany({ where: { id: w.productId } });
    await prisma.merchant.deleteMany({ where: { id: w.merchantId } });
    await prisma.creator.deleteMany({ where: { id: w.creatorId } });
  }
  await prisma.webhookEvent.deleteMany({ where: { paypalEventId: { startsWith: "TEST-WH-" } } });
  await prisma.$disconnect();
});

describe("checkout → capture → commission", () => {
  it("creates exactly one commission, and every replay is a noop", async () => {
    const w = await makeWorld();
    const { orderId, paypalOrderId } = await buy(w);

    const first = await captureCheckout(paypalOrderId, "viewer");
    expect(first).toMatchObject({ status: "captured", creatorEarnedMinor: 450 });

    // Browser retries capture.
    await captureCheckout(paypalOrderId, "viewer");
    // PayPal sends the capture webhook, twice.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const captureEvent = {
      id: eventId(),
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: order.paypalCaptureId!, status: "COMPLETED", amount: { currency_code: "USD", value: "45.00" }, custom_id: orderId },
    };
    expect(await handleWebhookEvent(captureEvent)).toBe("processed");
    expect(await handleWebhookEvent(captureEvent)).toBe("duplicate");
    // A late APPROVED webhook arrives after capture.
    expect(
      await handleWebhookEvent({ id: eventId(), event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: paypalOrderId, purchase_units: [{ custom_id: orderId }] } }),
    ).toBe("processed");

    const commissions = await commissionsOf(w);
    expect(commissions).toHaveLength(1);
    expect(commissions[0]).toMatchObject({ amountMinor: 450, baseMinor: 4500, rateBps: 1000, status: "ELIGIBLE" });
    expect(fake.count("capture:")).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CAPTURED");
  });

  it("concurrent browser capture + APPROVED webhook converge on one commission", async () => {
    const w = await makeWorld();
    const { orderId, paypalOrderId } = await buy(w);
    await Promise.all([
      captureCheckout(paypalOrderId, "viewer"),
      captureCheckout(paypalOrderId, "viewer"),
      handleWebhookEvent({ id: eventId(), event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: paypalOrderId, purchase_units: [{ custom_id: orderId }] } }),
    ]);
    expect(await commissionsOf(w)).toHaveLength(1);
    expect(fake.count("capture:")).toBe(1);
  });

  it("guest card orders follow the same path", async () => {
    const w = await makeWorld();
    const { paypalOrderId } = await buy(w, "card");
    expect(await captureCheckout(paypalOrderId, "viewer")).toMatchObject({ status: "captured", creatorEarnedMinor: 450 });
  });

  it("a declined capture fails the order and pays no commission", async () => {
    const w = await makeWorld();
    const { orderId } = await buy(w);
    await applyCapture({ orderId, capture: { id: "CAP-DECLINED", status: "DECLINED" }, source: "webhook" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("FAILED");
    expect(await commissionsOf(w)).toHaveLength(0);
  });
});

describe("refunds", () => {
  it("a full refund reverses the commission; the refund webhook replay is a noop", async () => {
    const w = await makeWorld();
    const { orderId } = await buyAndCapture(w);
    await refundOrder(orderId, undefined, "creator");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { refunds: true } });
    expect(order).toMatchObject({ status: "REFUNDED", refundedMinor: 4500 });
    const [c] = await commissionsOf(w);
    expect(c).toMatchObject({ status: "REVERSED", reversedMinor: 450 });

    const r = order.refunds[0];
    const refundEvent = {
      id: eventId(),
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: { id: r.paypalRefundId, status: "COMPLETED", amount: { currency_code: "USD", value: "45.00" }, custom_id: orderId },
    };
    await handleWebhookEvent(refundEvent);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(after.refundedMinor).toBe(4500); // not 9000
    expect(fake.count("refund:")).toBe(1);
  });

  it("partial refunds reverse commission proportionally, then fully", async () => {
    const w = await makeWorld();
    const { orderId } = await buyAndCapture(w);

    await refundOrder(orderId, 1500, "creator");
    let [c] = await commissionsOf(w);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PARTIALLY_REFUNDED");
    expect(c).toMatchObject({ status: "ELIGIBLE", reversedMinor: 150 });

    await refundOrder(orderId, undefined, "creator"); // the remaining $30
    [c] = await commissionsOf(w);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("REFUNDED");
    expect(c).toMatchObject({ status: "REVERSED", reversedMinor: 450 });
  });

  it("refuses to refund more than was captured", async () => {
    const w = await makeWorld();
    const { orderId } = await buyAndCapture(w);
    await expect(refundOrder(orderId, 4501, "creator")).rejects.toThrow();
    expect(fake.count("refund:")).toBe(0);
  });
});

describe("payouts", () => {
  it("pays each eligible commission exactly once, even on a double-click", async () => {
    const w = await makeWorld();
    await buyAndCapture(w);
    await buyAndCapture(w);

    const [a, b] = await Promise.all([payMeNow(w.creatorId), payMeNow(w.creatorId)]);
    const submitted = [a, b].filter((r) => r.status === "submitted");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ totalMinor: 900, currency: "USD" });
    expect(fake.count("payout:")).toBe(1);
    expect((await commissionsOf(w)).every((c) => c.status === "PAYOUT_SENT")).toBe(true);

    expect(await payMeNow(w.creatorId)).toEqual({ status: "nothing_to_pay" });

    const batchId = (await commissionsOf(w))[0].payoutBatchId!;
    expect(await syncPayoutBatch(batchId)).toEqual({ status: "SUCCESS" });
    const paid = await commissionsOf(w);
    expect(paid.every((c) => c.status === "PAID" && c.payoutItemId)).toBe(true);

    // Replayed item webhook changes nothing.
    const batch = await prisma.payoutBatch.findUniqueOrThrow({ where: { id: batchId } });
    const auditBefore = await prisma.auditEvent.count({ where: { entityId: paid[0].id } });
    await handleWebhookEvent({
      id: eventId(),
      event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      resource: {
        payout_item_id: paid[0].payoutItemId,
        payout_batch_id: batch.paypalBatchId,
        transaction_status: "SUCCESS",
        payout_item: { sender_item_id: paid[0].id, receiver: "x", amount: { currency: "USD", value: "4.50" } },
      },
    });
    expect(await prisma.auditEvent.count({ where: { entityId: paid[0].id } })).toBe(auditBefore);
  });

  it("a rejected payout frees the commissions for a later retry", async () => {
    const w = await makeWorld();
    await buyAndCapture(w);
    fake.failNextPayoutWith = "INSUFFICIENT_FUNDS";
    await expect(payMeNow(w.creatorId)).rejects.toThrow(/INSUFFICIENT_FUNDS/);
    expect((await commissionsOf(w))[0].status).toBe("FAILED");

    const retry = await payMeNow(w.creatorId);
    expect(retry).toMatchObject({ status: "submitted", totalMinor: 450 });
  });

  it("a refund during an in-flight payout is clawed back once the payout lands", async () => {
    const w = await makeWorld();
    const { orderId } = await buyAndCapture(w);
    await payMeNow(w.creatorId);

    await refundOrder(orderId, undefined, "creator");
    let [c] = await commissionsOf(w);
    expect(c).toMatchObject({ status: "PAYOUT_SENT", reversedMinor: 450 }); // money in flight: record only

    await syncPayoutBatch(c.payoutBatchId!);
    [c] = await commissionsOf(w);
    expect(c.status).toBe("REVERSED");
    const types = (await prisma.auditEvent.findMany({ where: { entityId: c.id } })).map((e) => e.type);
    expect(types).toContain("commission.clawback_recorded");
  });

  it("an unclaimed payout can still be marked paid later", async () => {
    const w = await makeWorld();
    await buyAndCapture(w);
    fake.payoutItemStatus = "UNCLAIMED";
    await payMeNow(w.creatorId);
    const batchId = (await commissionsOf(w))[0].payoutBatchId!;
    await syncPayoutBatch(batchId);
    expect((await commissionsOf(w))[0].status).toBe("UNCLAIMED");
    fake.payoutItemStatus = "SUCCESS";
    await syncPayoutBatch(batchId);
    expect((await commissionsOf(w))[0].status).toBe("PAID");
  });
});
