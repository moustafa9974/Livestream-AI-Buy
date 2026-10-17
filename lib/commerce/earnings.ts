import type { CommissionStatus } from "@/generated/prisma/enums";
import { prisma } from "../db";
import { sumMinor } from "../money";
import type { OrderLine } from "./order-body";

const IN_PAYOUT: CommissionStatus[] = ["PAYOUT_SENT", "UNCLAIMED"];
const UPCOMING: CommissionStatus[] = ["PENDING", "ELIGIBLE", "FAILED", "RETURNED"];

/** Everything the earnings page shows, scoped to one creator. Net = amount − reversed. */
export async function getEarnings(creatorId: string) {
  const commissions = await prisma.commission.findMany({
    where: { creatorId },
    orderBy: { createdAt: "desc" },
    include: {
      order: { include: { attribution: { include: { stream: true } } } },
      payoutBatch: true,
    },
  });

  const net = (c: (typeof commissions)[number]) => c.amountMinor - c.reversedMinor;
  const total = (states: CommissionStatus[]) => sumMinor(commissions.filter((c) => states.includes(c.status)).map(net));
  const sales = commissions.filter((c) => c.order.status !== "FAILED" && c.order.status !== "CANCELLED");

  const productCounts = new Map<string, number>();
  for (const c of sales) {
    const title = (c.order.items as unknown as OrderLine[])[0]?.title ?? "Unknown";
    productCounts.set(title, (productCounts.get(title) ?? 0) + 1);
  }
  const topProduct = [...productCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const entityIds = [
    ...commissions.map((c) => c.id),
    ...commissions.map((c) => c.orderId),
    ...commissions.flatMap((c) => (c.payoutBatchId ? [c.payoutBatchId] : [])),
  ];
  const timeline = await prisma.auditEvent.findMany({
    where: { entityId: { in: entityIds } },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  // Per product: clicks (card clicks on this creator's streams) → sales → conversion.
  const attributions = await prisma.attribution.findMany({
    where: { stream: { creatorId } },
    include: { partnerProduct: true, stream: true, orders: { include: { commissions: true } } },
  });
  const byProduct = new Map<string, { productId: string; product: string; clicks: number; sales: number; commissionMinor: number; currency: string; best: { stream: string; tsSec: number; sales: number } | null }>();
  for (const a of attributions) {
    const row = byProduct.get(a.partnerProductId) ?? { productId: a.partnerProductId, product: a.partnerProduct.title, clicks: 0, sales: 0, commissionMinor: 0, currency: a.partnerProduct.currency, best: null };
    row.clicks++;
    const paid = a.orders.filter((o) => o.status === "CAPTURED" || o.status === "PARTIALLY_REFUNDED");
    row.sales += paid.length;
    row.commissionMinor += sumMinor(paid.flatMap((o) => o.commissions.map((c) => c.amountMinor - c.reversedMinor)));
    if (paid.length && (!row.best || paid.length > row.best.sales)) row.best = { stream: a.stream.title, tsSec: a.tsSec, sales: paid.length };
    byProduct.set(a.partnerProductId, row);
  }

  const openBatch = commissions.find((c) => c.status === "PAYOUT_SENT" && c.payoutBatchId)?.payoutBatchId ?? null;

  return {
    currency: commissions[0]?.currency ?? "USD",
    kpis: {
      salesCount: sales.length,
      grossMinor: sumMinor(sales.map((c) => c.order.totalMinor - c.order.refundedMinor)),
      upcomingMinor: total(UPCOMING),
      payableNowMinor: total(["ELIGIBLE", "FAILED", "RETURNED"]),
      inPayoutMinor: total(IN_PAYOUT),
      paidMinor: total(["PAID"]),
      topProduct,
    },
    openBatch,
    products: [...byProduct.values()]
      .map((p) => ({ ...p, conversionPct: p.clicks ? Math.round((1000 * p.sales) / p.clicks) / 10 : 0, bestMoment: p.best ? { stream: p.best.stream, tsSec: p.best.tsSec } : null }))
      .sort((a, b) => b.commissionMinor - a.commissionMinor || b.sales - a.sales),
    rows: commissions.map((c) => ({
      id: c.id,
      orderId: c.orderId,
      createdAt: c.createdAt.toISOString(),
      product: (c.order.items as unknown as OrderLine[])[0]?.title ?? "Unknown",
      streamTitle: c.order.attribution?.stream.title ?? null,
      momentSec: c.order.attribution?.tsSec ?? null,
      orderStatus: c.order.status,
      orderTotalMinor: c.order.totalMinor,
      refundedMinor: c.order.refundedMinor,
      amountMinor: c.amountMinor,
      reversedMinor: c.reversedMinor,
      status: c.status,
      currency: c.currency,
      // Seeded and demo-simulated sales have fake PayPal IDs and can't be refunded for real.
      refundable:
        ["CAPTURED", "PARTIALLY_REFUNDED"].includes(c.order.status) &&
        !/^(SEED|SIM)-/.test(c.order.paypalCaptureId ?? ""),
    })),
    timeline: timeline.map((e) => ({
      id: e.id,
      type: e.type,
      source: e.source,
      entityType: e.entityType,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

export type Earnings = Awaited<ReturnType<typeof getEarnings>>;
