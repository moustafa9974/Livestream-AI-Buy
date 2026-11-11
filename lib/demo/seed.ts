/**
 * Deterministic demo seed. Safe to run repeatedly: it wipes demo data and recreates
 * it with fixed IDs, which is exactly what `npm run demo:reset` needs.
 *
 * Kept on purpose across resets: UsageCounter (resetting it would let us blow through
 * real provider quotas) and ApiCache (cached AI/Channel3 results save free quota).
 *
 * Seed PayPal IDs are prefixed "SEED-" so they can never be mistaken for, or collide
 * with, real sandbox IDs. Money comes from lib/money, the same code the app uses.
 */
import type { PrismaClient, Prisma } from "../../generated/prisma/client";
import { merchants, products } from "../../prisma/catalog";
import { importDemoCache } from "../../scripts/demo-cache";
import { findSimilarItems } from "../channel3/client";
import { commissionMinor, sumMinor } from "../money";
import { embedCatalog } from "../search/catalog";

// Set by seedDemo(): the CLI passes its own client, the demo panel passes the app's.
let prisma: PrismaClient;

const CREATOR_ID = "seed_creator_maya";
const PAST_STREAM_ID = "seed_stream_past";
const DEMO_STREAM_ID = "seed_stream_demo";
const RATE_BPS = 1000;
const HOUR = 3_600_000;

const productById = new Map(products.map((p) => [p.id, p]));

async function wipe() {
  // Children first. One transaction so a failed reset never leaves half a demo.
  await prisma.$transaction([
    prisma.brandBooking.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.kernelSession.deleteMany(),
    prisma.auditEvent.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.commission.deleteMany(),
    prisma.payoutBatch.deleteMany(),
    prisma.refund.deleteMany(),
    prisma.order.deleteMany(),
    prisma.attribution.deleteMany(),
    prisma.productMatch.deleteMany(),
    prisma.detection.deleteMany(),
    prisma.frame.deleteMany(),
    prisma.stream.deleteMany(),
    prisma.viewerSession.deleteMany(),
    prisma.partnerProduct.deleteMany(),
    prisma.merchant.deleteMany(),
    prisma.creator.deleteMany(),
  ],
  // 17 sequential round trips: from far away (or a Neon compute just waking up) this
  // exceeds Prisma's defaults (2 s to start, 5 s total), so the reset failed.
  { maxWait: 15_000, timeout: 60_000 });
}

async function seedCatalog() {
  await prisma.merchant.createMany({ data: merchants });
  await prisma.partnerProduct.createMany({
    // `demo` is a seed-only marker, not a column. Images come with your demo photos (Phase 4).
    data: products.map((p) => ({
      id: p.id,
      merchantId: p.merchantId,
      title: p.title,
      description: p.description,
      category: p.category,
      priceMinor: p.priceMinor,
      attributes: p.attributes,
      stock: p.stock,
      currency: "USD",
      images: [],
    })),
  });
}

async function seedCreatorAndStreams(now: Date, zapierWebhookUrl: string | null) {
  await prisma.creator.create({
    data: {
      id: CREATOR_ID,
      zapierWebhookUrl,
      slug: "maya-makes",
      displayName: "Maya Makes",
      // Sandbox personal account that receives "Pay me now" payouts. Comes from .env so
      // each developer uses their own sandbox account.
      payoutEmail: process.env.DEMO_CREATOR_PAYOUT_EMAIL || "creator-sandbox@example.com",
      payoutCurrency: "USD",
      commissionRateBps: RATE_BPS,
      language: "en",
    },
  });

  const pastStart = new Date(now.getTime() - 26 * HOUR);
  const day = 24 * HOUR;
  await prisma.stream.createMany({
    data: [
      {
        id: PAST_STREAM_ID,
        creatorId: CREATOR_ID,
        title: "Desk setup tour + fall fits",
        sourceType: "upload",
        // No video: this 42-minute replay's products (hoodie, sneakers, …) aren't in the
        // short demo clip, so its stage shows the "AI scene" instead. The demo clip belongs
        // to the live demo stream below, where Seen detects what's really in it.
        videoAssetUrl: null,
        status: "ended",
        consentOwnContent: true,
        consentAt: pastStart,
        startedAt: pastStart,
        endedAt: new Date(pastStart.getTime() + 42 * 60_000),
        // Older than the demo stream, so "latest stream" lookups never pick this one.
        createdAt: pastStart,
      },
      {
        id: DEMO_STREAM_ID,
        creatorId: CREATOR_ID,
        title: "Live: what's on my desk this week",
        sourceType: "upload",
        videoAssetUrl: "/demo/demo.mp4",
        status: "idle",
        consentOwnContent: true,
        consentAt: now,
      },
      // Upcoming streams for the schedule page. Created "earlier" and carrying a
      // scheduledFor date, so they're never picked as the current stream.
      {
        id: "seed_stream_upcoming_1",
        creatorId: CREATOR_ID,
        title: "Fall fits try-on (live)",
        sourceType: "screen",
        status: "idle",
        scheduledFor: new Date(Math.ceil((now.getTime() + 2 * day) / HOUR) * HOUR),
        createdAt: new Date(pastStart.getTime() - day),
      },
      {
        id: "seed_stream_upcoming_2",
        creatorId: CREATOR_ID,
        title: "Studio gear Q&A",
        sourceType: "screen",
        status: "idle",
        scheduledFor: new Date(Math.ceil((now.getTime() + 5 * day) / HOUR) * HOUR),
        createdAt: new Date(pastStart.getTime() - day),
      },
    ],
  });
}

/**
 * Real "also sold online" links for the seeded detections, from Channel3, with the same
 * query live matching uses. Never invented: if Channel3 is off, out of credits or down,
 * the cards simply show no links. Cached for 24 h, so repeated resets cost nothing.
 */
async function seedSimilarItems(): Promise<number> {
  const dets = await prisma.detection.findMany({ where: { streamId: PAST_STREAM_ID } });
  let created = 0;
  for (const d of dets) {
    const color = (d.attributes as Record<string, unknown> | null)?.color;
    const similar = await findSimilarItems(`${typeof color === "string" ? color : ""} ${d.label}`, 3).catch(() => []);
    for (const [i, s] of similar.entries()) {
      await prisma.productMatch.create({
        data: { detectionId: d.id, source: "channel3", externalRef: s as unknown as Prisma.InputJsonValue, score: 1 - i * 0.1, kind: "similar" },
      });
      created++;
    }
  }
  return created;
}

/**
 * Two brand slots relative to "now" (so they're always upcoming): one the creator already
 * approved, one waiting, so the schedule shows the approve/decline flow straight away.
 */
async function seedBrandSlots(now: Date) {
  const at = (days: number, hour: number) => {
    const d = new Date(now.getTime() + days * 24 * HOUR);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  await prisma.brandBooking.createMany({
    data: [
      {
        id: "seed_booking_kiln",
        creatorId: CREATOR_ID,
        merchantId: "seed_merchant_kiln",
        productId: "seed_prod_ceramic_mug",
        startsAt: at(3, 19),
        endsAt: at(3, 20),
        status: "APPROVED",
        note: "Show the speckled glaze up close, please",
      },
      {
        id: "seed_booking_signal",
        creatorId: CREATOR_ID,
        merchantId: "seed_merchant_signal",
        productId: "seed_prod_wireless_mic",
        startsAt: at(5, 20),
        endsAt: at(5, 21),
        status: "REQUESTED",
        note: "Mention the 8-hour battery",
      },
    ],
  });
}

/** Past-stream detections, one per demo item, each matched to its partner product. */
async function seedPastDetections() {
  const demoItems = products.filter((p) => p.demo);
  for (const [i, p] of demoItems.entries()) {
    const firstSeen = 60 + i * 300; // spread across the 42-minute stream
    await prisma.detection.create({
      data: {
        id: `seed_det_${p.id.replace("seed_prod_", "")}`,
        streamId: PAST_STREAM_ID,
        label: p.title.split(":")[0].toLowerCase(),
        category: p.category,
        attributes: p.attributes,
        bbox: [0.3, 0.3, 0.3, 0.3],
        confidence: 0.9,
        hits: 6 + i,
        firstSeenSec: firstSeen,
        lastSeenSec: firstSeen + 90,
        state: "visible",
        matches: {
          create: { source: "partner", partnerProductId: p.id, score: 0.92, kind: "exact" },
        },
      },
    });
  }
}

interface SeedSale {
  key: string;
  productId: string;
  quantity: number;
  tsSec: number;
  commission: "PAID" | "ELIGIBLE" | "REVERSED";
}

// Gives the dashboards a believable history: two already paid out, two waiting, one refunded.
const sales: SeedSale[] = [
  { key: "1001", productId: "seed_prod_black_hoodie", quantity: 1, tsSec: 120, commission: "PAID" },
  { key: "1002", productId: "seed_prod_wireless_mic", quantity: 1, tsSec: 400, commission: "PAID" },
  { key: "1003", productId: "seed_prod_ceramic_mug", quantity: 2, tsSec: 700, commission: "ELIGIBLE" },
  { key: "1004", productId: "seed_prod_sunglasses", quantity: 1, tsSec: 1600, commission: "ELIGIBLE" },
  { key: "1005", productId: "seed_prod_desk_lamp", quantity: 1, tsSec: 1000, commission: "REVERSED" },
];

async function seedSales(now: Date) {
  const batchId = "seed_payout_batch_1";
  const paidSales = sales.filter((s) => s.commission === "PAID");
  const lineTotal = (s: SeedSale) => productById.get(s.productId)!.priceMinor * s.quantity;
  const batchTotal = sumMinor(paidSales.map((s) => commissionMinor(lineTotal(s), RATE_BPS)));

  await prisma.payoutBatch.create({
    data: {
      id: batchId,
      paypalBatchId: "SEED-BATCH-0001",
      senderBatchId: "seed-sender-batch-0001",
      status: "SUCCESS",
      totalMinor: batchTotal,
      currency: "USD",
    },
  });

  const audit: Prisma.AuditEventCreateManyInput[] = [];

  for (const s of sales) {
    const product = productById.get(s.productId)!;
    const total = lineTotal(s);
    const amount = commissionMinor(total, RATE_BPS);
    const refunded = s.commission === "REVERSED";
    const createdAt = new Date(now.getTime() - 25 * HOUR + s.tsSec * 1000);

    const viewer = await prisma.viewerSession.create({
      data: { id: `seed_viewer_${s.key}`, anonId: `seed-anon-${s.key}` },
    });
    const attribution = await prisma.attribution.create({
      data: {
        id: `seed_attr_${s.key}`,
        streamId: PAST_STREAM_ID,
        detectionId: `seed_det_${s.productId.replace("seed_prod_", "")}`,
        partnerProductId: s.productId,
        viewerSessionId: viewer.id,
        tsSec: s.tsSec,
        createdAt,
      },
    });
    const order = await prisma.order.create({
      data: {
        id: `seed_order_${s.key}`,
        viewerSessionId: viewer.id,
        attributionId: attribution.id,
        items: [
          { partnerProductId: product.id, title: product.title, unitMinor: product.priceMinor, quantity: s.quantity },
        ],
        subtotalMinor: total,
        totalMinor: total,
        refundedMinor: refunded ? total : 0,
        currency: "USD",
        status: refunded ? "REFUNDED" : "CAPTURED",
        paypalOrderId: `SEED-ORDER-${s.key}`,
        paypalCaptureId: `SEED-CAPTURE-${s.key}`,
        createdAt,
      },
    });
    const commission = await prisma.commission.create({
      data: {
        id: `seed_commission_${s.key}`,
        orderId: order.id,
        creatorId: CREATOR_ID,
        baseMinor: total,
        rateBps: RATE_BPS,
        amountMinor: amount,
        reversedMinor: refunded ? amount : 0,
        currency: "USD",
        status: s.commission,
        eligibleAt: createdAt,
        payoutBatchId: s.commission === "PAID" ? batchId : null,
        payoutItemId: s.commission === "PAID" ? `SEED-ITEM-${s.key}` : null,
        createdAt,
      },
    });

    audit.push(
      { entityType: "Order", entityId: order.id, type: "order.captured", source: "webhook", payload: { totalMinor: total }, createdAt },
      { entityType: "Commission", entityId: commission.id, type: "commission.created", source: "system", payload: { amountMinor: amount, rateBps: RATE_BPS }, createdAt },
    );
    if (refunded) {
      await prisma.refund.create({
        data: {
          id: `seed_refund_${s.key}`,
          orderId: order.id,
          paypalRefundId: `SEED-REFUND-${s.key}`,
          amountMinor: total,
          currency: "USD",
          status: "COMPLETED",
        },
      });
      audit.push(
        { entityType: "Order", entityId: order.id, type: "order.refunded", source: "creator", payload: { refundedMinor: total }, createdAt: new Date(createdAt.getTime() + HOUR) },
        { entityType: "Commission", entityId: commission.id, type: "commission.reversed", source: "system", payload: { reversedMinor: amount }, createdAt: new Date(createdAt.getTime() + HOUR) },
      );
    }
  }

  audit.push({
    entityType: "PayoutBatch",
    entityId: batchId,
    type: "payout.succeeded",
    source: "webhook",
    payload: { totalMinor: batchTotal },
    createdAt: new Date(now.getTime() - 20 * HOUR),
  });
  await prisma.auditEvent.createMany({ data: audit });
}

export interface SeedResult {
  counts: Record<string, number>;
  demoCacheFrames: number;
  /** Real "also sold online" links fetched from Channel3 for the seeded detections. */
  similarLinks: number;
  productEmbeddings: { embedded: number; skipped: number };
}

/** Wipes and recreates the demo dataset. Used by `npm run db:seed` and the demo panel. */
export async function seedDemo(client: PrismaClient): Promise<SeedResult> {
  prisma = client;
  const now = new Date();
  // Settings the creator configured by hand survive a reset: wiping the Zapier hook
  // would silently cut the creator's alerts every time the demo is restored.
  const kept = await prisma.creator.findUnique({ where: { id: CREATOR_ID }, select: { zapierWebhookUrl: true } }).catch(() => null);
  await wipe();
  await seedCatalog();
  await seedCreatorAndStreams(now, kept?.zapierWebhookUrl ?? null);
  await seedPastDetections();
  const similarLinks = await seedSimilarItems();
  await seedSales(now);
  await seedBrandSlots(now);
  const demoCacheFrames = await importDemoCache(prisma);
  // Product vectors for matching. Cached by text hash, so reseeding costs no quota;
  // without a Gemini key matching falls back to text scoring.
  const productEmbeddings = await embedCatalog();
  const counts = {
    merchants: await prisma.merchant.count(),
    products: await prisma.partnerProduct.count(),
    streams: await prisma.stream.count(),
    detections: await prisma.detection.count(),
    orders: await prisma.order.count(),
    commissions: await prisma.commission.count(),
  };
  return { counts, demoCacheFrames, similarLinks, productEmbeddings };
}
