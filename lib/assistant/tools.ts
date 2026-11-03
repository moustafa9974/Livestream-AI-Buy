import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import type { FunctionDeclaration } from "@google/genai";
import { CheckoutError } from "../commerce/checkout";
import { orderRef } from "../commerce/order-ref";
import { payMeNow } from "../commerce/payouts";
import { refundOrder } from "../commerce/refunds";
import { prisma } from "../db";
import { getEnv } from "../env";
import { isEnabled } from "../flags";
import { formatMoney, sumMinor, toMinor } from "../money";
import { currentStreamFor } from "../rail";
import { emitRailChanged } from "../realtime/bus";

/**
 * Creator-assistant tools. Every handler is scoped to the signed-in creator (never to
 * anything the model says), returns amounts formatted from the DB, and the two money
 * actions run through our own typed PayPal client, only after an explicit request.
 * Read-only PayPal lookups go through the PayPal Agent Toolkit (docs/SPONSORS.md).
 */

export interface ToolContext {
  creatorId: string;
  /** The creator's latest message, used to gate money actions. */
  lastUserMessage: string;
}

type Handler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

export { orderRef };

async function resolveOrder(ref: unknown, creatorId: string) {
  const r = String(ref ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (r.length < 4) return null;
  // Scoped to this creator's orders, matched on the same normalized reference we show.
  const orders = await prisma.order.findMany({
    where: { attribution: { stream: { creatorId } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return orders.find((o) => orderRef(o.id) === r || orderRef(o.id).endsWith(r)) ?? null;
}

function since(period: unknown): Date | undefined {
  const now = new Date();
  if (period === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") return new Date(now.getTime() - 7 * 86_400_000);
  return undefined;
}

let toolkit: PayPalAgentToolkit | undefined;
function paypalToolkit(): PayPalAgentToolkit | null {
  if (!isEnabled("agentToolkit")) return null;
  const env = getEnv();
  toolkit ??= new PayPalAgentToolkit({
    clientId: env.PAYPAL_CLIENT_ID!,
    clientSecret: env.PAYPAL_CLIENT_SECRET!,
    configuration: { actions: { orders: { get: true }, transactions: { list: true } }, context: { sandbox: env.PAYPAL_ENV === "sandbox" } },
  });
  return toolkit;
}

async function callToolkit(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tk = paypalToolkit();
  if (!tk) return { error: "PayPal lookups are unavailable" };
  const res = await tk.handleToolCall({ id: `seen-${Date.now()}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
  try {
    return JSON.parse(String(res.content));
  } catch {
    return { error: "Unexpected PayPal response" };
  }
}

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "earnings_summary",
    description: "Sales count, commission earned (pending/payable/paid) for the creator over a period.",
    parametersJsonSchema: { type: "object", properties: { period: { type: "string", enum: ["today", "week", "all"] } }, required: ["period"] },
  },
  {
    name: "top_products",
    description: "Best-selling products with clicks, sales and conversion rate.",
    parametersJsonSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 10 } } },
  },
  {
    name: "recent_orders",
    description: "The creator's most recent orders with their short reference (e.g. A1B2C3), product, total and status.",
    parametersJsonSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 10 } } },
  },
  {
    name: "stream_status",
    description: "The creator's current stream: title, whether it is live, and which products viewers can see or buy right now.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "payout_status",
    description: "The creator's latest PayPal payouts with amount and PayPal status, plus how much is payable now.",
    parametersJsonSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 5 } } },
  },
  {
    name: "upcoming_streams",
    description: "The creator's scheduled upcoming streams with their date and time (UTC).",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "hide_detections",
    description: "Hide products from the viewers' rail in the current stream whose label contains the given text (e.g. 'sunglasses').",
    parametersJsonSchema: { type: "object", properties: { label_contains: { type: "string" } }, required: ["label_contains"] },
  },
  {
    name: "pay_me_now",
    description:
      "Send all payable commission to the creator's PayPal account now. ONLY call when the creator explicitly asks to be paid in their latest message; set confirm=true only then.",
    parametersJsonSchema: { type: "object", properties: { confirm: { type: "boolean" } }, required: ["confirm"] },
  },
  {
    name: "refund_order",
    description:
      "Fully refund one order by its short reference. ONLY call when the creator explicitly asks to refund that order in their latest message; set confirm=true only then.",
    parametersJsonSchema: { type: "object", properties: { order_ref: { type: "string" }, confirm: { type: "boolean" } }, required: ["order_ref", "confirm"] },
  },
  {
    name: "paypal_order_details",
    description: "Look up an order's live status at PayPal (via the PayPal Agent Toolkit) by its short reference.",
    parametersJsonSchema: { type: "object", properties: { order_ref: { type: "string" } }, required: ["order_ref"] },
  },
  {
    name: "paypal_recent_transactions",
    description: "List the creator's recent PayPal transactions (via the PayPal Agent Toolkit) for the last N days (max 31).",
    parametersJsonSchema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 31 } } },
  },
];

const HANDLERS: Record<string, Handler> = {
  async earnings_summary(args, { creatorId }) {
    const from = since(args.period);
    const cs = await prisma.commission.findMany({ where: { creatorId, ...(from ? { createdAt: { gte: from } } : {}) } });
    const currency = cs[0]?.currency ?? "USD";
    const sum = (st: string[]) => sumMinor(cs.filter((c) => st.includes(c.status)).map((c) => c.amountMinor - c.reversedMinor));
    return {
      period: args.period,
      sales: cs.filter((c) => c.status !== "REVERSED").length,
      pending: formatMoney(sum(["PENDING"]), currency),
      payable_now: formatMoney(sum(["ELIGIBLE", "FAILED", "RETURNED"]), currency),
      in_payout: formatMoney(sum(["PAYOUT_SENT", "UNCLAIMED"]), currency),
      paid: formatMoney(sum(["PAID"]), currency),
      // Precomputed so the model never has to add amounts itself.
      total_earned: formatMoney(sum(["PENDING", "ELIGIBLE", "FAILED", "RETURNED", "PAYOUT_SENT", "UNCLAIMED", "PAID"]), currency),
    };
  },

  async top_products(args, { creatorId }) {
    const limit = Math.min(Number(args.limit) || 5, 10);
    const atts = await prisma.attribution.findMany({
      where: { stream: { creatorId } },
      include: { partnerProduct: true, orders: { where: { status: { in: ["CAPTURED", "PARTIALLY_REFUNDED"] } } } },
    });
    const by = new Map<string, { product: string; clicks: number; sales: number }>();
    for (const a of atts) {
      const row = by.get(a.partnerProductId) ?? { product: a.partnerProduct.title, clicks: 0, sales: 0 };
      row.clicks++;
      row.sales += a.orders.length;
      by.set(a.partnerProductId, row);
    }
    return [...by.values()]
      .sort((x, y) => y.sales - x.sales || y.clicks - x.clicks)
      .slice(0, limit)
      .map((r) => ({ ...r, conversion: r.clicks ? `${Math.round((100 * r.sales) / r.clicks)}%` : "—" }));
  },

  async recent_orders(args, { creatorId }) {
    const limit = Math.min(Number(args.limit) || 5, 10);
    const orders = await prisma.order.findMany({
      where: { attribution: { stream: { creatorId } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return orders.map((o) => ({
      ref: orderRef(o.id),
      product: (o.items as unknown as Array<{ title?: string }>)[0]?.title ?? "—",
      total: formatMoney(o.totalMinor, o.currency),
      status: o.status,
      date: o.createdAt.toISOString().slice(0, 16).replace("T", " "),
    }));
  },

  async stream_status(_args, { creatorId }) {
    const stream = await currentStreamFor(creatorId);
    if (!stream) return { stream: null };
    const shown = await prisma.detection.findMany({
      where: { streamId: stream.id, state: { in: ["visible", "pinned"] } },
      include: { matches: { where: { source: "partner" }, include: { partnerProduct: true } } },
      orderBy: { firstSeenSec: "asc" },
    });
    return {
      title: stream.title,
      status: stream.status,
      live_since: stream.status === "live" ? (stream.startedAt?.toISOString().slice(0, 16).replace("T", " ") ?? null) : null,
      products_on_screen: shown.map((d) => ({
        label: d.label,
        pinned: d.state === "pinned",
        buyable_as: d.matches[0]?.partnerProduct ? `${d.matches[0].partnerProduct.title} (${formatMoney(d.matches[0].partnerProduct.priceMinor, d.matches[0].partnerProduct.currency)})` : null,
      })),
    };
  },

  async payout_status(args, { creatorId }) {
    const limit = Math.min(Number(args.limit) || 3, 5);
    const [batches, payable] = await Promise.all([
      prisma.payoutBatch.findMany({ where: { commissions: { some: { creatorId } } }, orderBy: { createdAt: "desc" }, take: limit }),
      prisma.commission.findMany({ where: { creatorId, status: { in: ["ELIGIBLE", "FAILED", "RETURNED"] } } }),
    ]);
    const currency = payable[0]?.currency ?? batches[0]?.currency ?? "USD";
    return {
      payable_now: formatMoney(sumMinor(payable.map((c) => c.amountMinor - c.reversedMinor)), currency),
      recent_payouts: batches.map((b) => ({
        amount: formatMoney(b.totalMinor, b.currency),
        paypal_status: b.status,
        date: b.createdAt.toISOString().slice(0, 16).replace("T", " "),
      })),
    };
  },

  async upcoming_streams(_args, { creatorId }) {
    const streams = await prisma.stream.findMany({
      where: { creatorId, scheduledFor: { gt: new Date() } },
      orderBy: { scheduledFor: "asc" },
      take: 5,
    });
    return streams.map((s) => ({ title: s.title, when_utc: s.scheduledFor!.toISOString().slice(0, 16).replace("T", " ") }));
  },

  async hide_detections(args, { creatorId }) {
    const needle = String(args.label_contains ?? "").trim().toLowerCase();
    if (needle.length < 2) return { error: "Say which products to hide" };
    const stream = await currentStreamFor(creatorId);
    if (!stream) return { hidden: [] };
    const targets = await prisma.detection.findMany({
      where: { streamId: stream.id, state: { not: "hidden" }, label: { contains: needle, mode: "insensitive" } },
    });
    await prisma.detection.updateMany({ where: { id: { in: targets.map((t) => t.id) } }, data: { state: "hidden" } });
    if (targets.length) emitRailChanged(stream.id);
    return { hidden: targets.map((t) => t.label) };
  },

  async pay_me_now(args, { creatorId, lastUserMessage }) {
    if (args.confirm !== true || !/\b(pay|payout|paid|cash ?out|withdraw)\b/i.test(lastUserMessage)) {
      return { error: "Not sent. Ask explicitly (e.g. 'pay me now') to send a payout." };
    }
    if (!isEnabled("paypal")) return { error: "PayPal is unavailable" };
    const res = await payMeNow(creatorId, "creator");
    return res.status === "nothing_to_pay"
      ? { status: "nothing_to_pay" }
      : { status: "submitted", amount: formatMoney(res.totalMinor, res.currency), note: "Status updates on the Earnings page." };
  },

  async refund_order(args, { creatorId, lastUserMessage }) {
    const order = await resolveOrder(args.order_ref, creatorId);
    if (!order) return { error: "No order with that reference" };
    if (args.confirm !== true || !/refund/i.test(lastUserMessage) || !lastUserMessage.toLowerCase().includes(orderRef(order.id).toLowerCase())) {
      return { error: `Not refunded. Ask explicitly, e.g. "refund order ${orderRef(order.id)}".` };
    }
    try {
      const r = await refundOrder(order.id, undefined, "creator");
      return { ref: orderRef(order.id), status: r.order.status, refunded: formatMoney(order.totalMinor - order.refundedMinor, order.currency) };
    } catch (err) {
      return { error: err instanceof CheckoutError ? err.message : "Refund failed" };
    }
  },

  async paypal_order_details(args, { creatorId }) {
    const order = await resolveOrder(args.order_ref, creatorId);
    if (!order?.paypalOrderId || order.paypalOrderId.startsWith("SEED-")) return { error: "No PayPal order for that reference (seeded demo orders have none)" };
    const raw = (await callToolkit("get_order", { id: order.paypalOrderId })) as {
      status?: string;
      create_time?: string;
      purchase_units?: Array<{ amount?: { value: string; currency_code: string }; payments?: { captures?: Array<{ status?: string }> } }>;
      error?: string;
    };
    if (raw.error) return raw;
    // Only these fields go back to the model: no payer names, emails or addresses.
    const pu = raw.purchase_units?.[0];
    return {
      ref: orderRef(order.id),
      paypal_status: raw.status,
      capture_status: pu?.payments?.captures?.[0]?.status ?? null,
      amount: pu?.amount ? formatMoney(toMinor(pu.amount.value, pu.amount.currency_code), pu.amount.currency_code) : null,
      created: raw.create_time ?? null,
    };
  },

  async paypal_recent_transactions(args, { creatorId }) {
    const days = Math.min(Math.max(Number(args.days) || 7, 1), 31);
    const mine = await prisma.order.findMany({
      where: { attribution: { stream: { creatorId } }, paypalCaptureId: { not: null } },
      select: { id: true, paypalCaptureId: true },
    });
    const byCapture = new Map(mine.map((o) => [o.paypalCaptureId!, o.id]));
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    const raw = (await callToolkit("list_transactions", { start_date: start.toISOString(), end_date: end.toISOString() })) as {
      transaction_details?: Array<{ transaction_info?: { transaction_id?: string; transaction_amount?: { value: string; currency_code: string }; transaction_status?: string; transaction_initiation_date?: string } }>;
      error?: string;
    };
    if (raw.error) return raw;
    // The platform account sees every creator's sales: keep only this creator's.
    return (raw.transaction_details ?? [])
      .map((t) => t.transaction_info)
      .filter((t) => t?.transaction_id && byCapture.has(t.transaction_id))
      .map((t) => ({
        order_ref: orderRef(byCapture.get(t!.transaction_id!)!),
        amount: t!.transaction_amount ? `${t!.transaction_amount.value} ${t!.transaction_amount.currency_code}` : null,
        status: t!.transaction_status ?? null,
        date: t!.transaction_initiation_date ?? null,
      }));
  },
};

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const h = HANDLERS[name];
  if (!h) return { error: `Unknown tool ${name}` };
  try {
    return await h(args, ctx);
  } catch (err) {
    console.warn("[assistant tool]", name, err instanceof Error ? err.message : err);
    return { error: "That didn't work. Please try again." };
  }
}
