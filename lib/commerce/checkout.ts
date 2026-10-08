import type { Prisma } from "@/generated/prisma/client";
import type { AuditSource, OrderStatus } from "@/generated/prisma/enums";
import { prisma } from "../db";
import { getEnv } from "../env";
import { toMinor } from "../money";
import { paypal, type PayPalCapture, type PayPalOrder } from "../paypal/gateway";
import { PayPalApiError } from "../paypal/http";
import { orderMachine } from "../state/order";
import { createCommissionForOrder } from "./commissions";
import { audit, lockRow } from "./db";
import { buildCreateOrderBody, type OrderLine } from "./order-body";

export const MAX_QUANTITY = 5;

export class CheckoutError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "OUT_OF_STOCK" | "BAD_QUANTITY" | "PAYPAL_UNAVAILABLE" | "INVALID_STATE",
    message: string,
  ) {
    super(message);
  }
}

export interface StartCheckoutInput {
  partnerProductId: string;
  quantity: number;
  viewerSessionId: string;
  paymentMethod: "paypal" | "card";
  /** Which stream moment the viewer clicked; creates the Attribution that pays the creator. */
  attribution?: { streamId: string; detectionId?: string; tsSec: number };
}

/** Creates our Order (CREATED), then the PayPal order. Returns the PayPal order id for the JS SDK. */
export async function startCheckout(input: StartCheckoutInput) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_QUANTITY) {
    throw new CheckoutError("BAD_QUANTITY", `Quantity must be 1–${MAX_QUANTITY}`);
  }
  const product = await prisma.partnerProduct.findUnique({ where: { id: input.partnerProductId } });
  if (!product) throw new CheckoutError("NOT_FOUND", "Product not found");
  if (product.stock < input.quantity) throw new CheckoutError("OUT_OF_STOCK", "Out of stock");

  const lines: OrderLine[] = [
    { partnerProductId: product.id, title: product.title, unitMinor: product.priceMinor, quantity: input.quantity },
  ];
  const totalMinor = product.priceMinor * input.quantity;

  const order = await prisma.$transaction(async (tx) => {
    let attributionId: string | undefined;
    if (input.attribution) {
      const stream = await tx.stream.findUnique({ where: { id: input.attribution.streamId } });
      if (stream) {
        const a = await tx.attribution.create({
          data: {
            streamId: stream.id,
            detectionId: input.attribution.detectionId,
            partnerProductId: product.id,
            viewerSessionId: input.viewerSessionId,
            tsSec: input.attribution.tsSec,
          },
        });
        attributionId = a.id;
      }
    }
    const o = await tx.order.create({
      data: {
        viewerSessionId: input.viewerSessionId,
        attributionId,
        items: lines.map((l) => ({ ...l })) satisfies Prisma.InputJsonValue,
        subtotalMinor: totalMinor,
        totalMinor,
        currency: product.currency,
        status: "CREATED",
      },
    });
    await audit(tx, {
      entityType: "Order",
      entityId: o.id,
      type: "order.created",
      source: "viewer",
      payload: { totalMinor, currency: product.currency, attributionId: attributionId ?? null },
    });
    return o;
  });

  const body = buildCreateOrderBody({
    orderId: order.id,
    lines,
    totalMinor,
    currency: order.currency,
    shippingPreference: getEnv().CHECKOUT_SHIPPING_PREFERENCE,
    paymentMethod: input.paymentMethod,
  });
  let ppOrder: PayPalOrder;
  try {
    ppOrder = await paypal().createOrder(body, `seen-order-${order.id}`);
  } catch (err) {
    // Only PayPal failures land here; DB errors propagate as real errors.
    console.error("[checkout] create order failed", err instanceof Error ? err.message : err);
    await transitionOrder(order.id, "FAILED", "system", {
      reason: err instanceof PayPalApiError ? (err.paypalName ?? `HTTP_${err.status}`) : "create_failed",
    });
    throw new CheckoutError("PAYPAL_UNAVAILABLE", "PayPal is unavailable right now. Please try again.");
  }
  await prisma.order.update({ where: { id: order.id }, data: { paypalOrderId: ppOrder.id } });
  return { orderId: order.id, paypalOrderId: ppOrder.id };
}

export type CaptureOutcome =
  | { status: "captured"; orderId: string; creatorEarnedMinor: number; creatorName?: string; currency: string }
  | { status: "pending"; orderId: string }
  | { status: "declined"; orderId: string }; // buyer can retry with another funding source

/**
 * Captures an approved PayPal order. Safe to call repeatedly and concurrently with
 * the webhook path: the capture POST uses a fixed PayPal-Request-Id, and applyCapture
 * goes through the state machine under a row lock.
 */
export async function captureCheckout(paypalOrderId: string, source: AuditSource): Promise<CaptureOutcome> {
  const order = await prisma.order.findUnique({ where: { paypalOrderId } });
  if (!order) throw new CheckoutError("NOT_FOUND", "Order not found");
  if (order.status === "CAPTURED" || order.status === "PARTIALLY_REFUNDED" || order.status === "REFUNDED") {
    return capturedOutcome(order.id);
  }

  let ppOrder: PayPalOrder;
  try {
    ppOrder = await paypal().captureOrder(paypalOrderId, `seen-capture-${order.id}`);
  } catch (err) {
    if (err instanceof PayPalApiError && err.hasIssue("ORDER_ALREADY_CAPTURED")) {
      ppOrder = await paypal().getOrder(paypalOrderId);
    } else if (err instanceof PayPalApiError && err.hasIssue("INSTRUMENT_DECLINED")) {
      // PayPal's guidance: let the buyer pick another funding source; order stays open.
      await audit(prisma, { entityType: "Order", entityId: order.id, type: "order.instrument_declined", source, payload: {} });
      return { status: "declined", orderId: order.id };
    } else {
      throw err;
    }
  }

  const capture = ppOrder.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture) throw new CheckoutError("INVALID_STATE", "PayPal returned no capture");
  return applyCapture({ orderId: order.id, capture, source });
}

/** Shared by the sync capture path and PAYMENT.CAPTURE.* webhooks. */
export async function applyCapture(args: {
  orderId: string;
  capture: PayPalCapture;
  source: AuditSource;
}): Promise<CaptureOutcome> {
  const { orderId, capture, source } = args;
  const target = captureTarget(capture.status);

  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Order", orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const t = orderMachine.transition(order.status, target);
    if (t.kind === "rejected") {
      await audit(tx, { entityType: "Order", entityId: orderId, type: "order.transition_rejected", source, payload: { from: t.from, to: t.to, captureStatus: capture.status } });
      return;
    }
    if (t.kind === "noop") return;

    const capturedMinor = capture.amount ? toMinor(capture.amount.value, capture.amount.currency_code) : order.totalMinor;
    if (target === "CAPTURED" && capturedMinor !== order.totalMinor) {
      // Shouldn't happen (we built the amount), but never trust it silently.
      await audit(tx, { entityType: "Order", entityId: orderId, type: "order.amount_mismatch", source, payload: { expectedMinor: order.totalMinor, capturedMinor } });
    }
    await tx.order.update({
      where: { id: orderId },
      data: { status: target, paypalCaptureId: capture.id },
    });
    await audit(tx, {
      entityType: "Order",
      entityId: orderId,
      type: `order.${target.toLowerCase()}`,
      source,
      payload: { captureStatus: capture.status, capturedMinor },
    });
    if (target === "CAPTURED") await createCommissionForOrder(tx, orderId, capturedMinor);
  });

  if (target === "CAPTURED") return capturedOutcome(orderId);
  if (target === "FAILED") return { status: "declined", orderId };
  return { status: "pending", orderId };
}

function captureTarget(status: PayPalCapture["status"]): OrderStatus {
  switch (status) {
    case "COMPLETED":
    case "PARTIALLY_REFUNDED": // refund events can outrun the capture event
    case "REFUNDED":
      return "CAPTURED";
    case "PENDING":
      return "APPROVED"; // money not settled yet; no commission until COMPLETED
    case "DECLINED":
    case "FAILED":
      return "FAILED";
  }
}

async function capturedOutcome(orderId: string): Promise<CaptureOutcome> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { commissions: { include: { creator: true } } },
  });
  const c = order.commissions[0];
  return {
    status: "captured",
    orderId,
    creatorEarnedMinor: c?.amountMinor ?? 0,
    creatorName: c?.creator.displayName,
    currency: order.currency,
  };
}

/** Moves an order through the machine with an audit entry; used for APPROVED/FAILED/CANCELLED. */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  source: AuditSource,
  payload: Record<string, string | number | null> = {},
) {
  return prisma.$transaction(async (tx) => {
    await lockRow(tx, "Order", orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const t = orderMachine.transition(order.status, to);
    if (t.kind !== "applied") return t;
    await tx.order.update({ where: { id: orderId }, data: { status: to } });
    await audit(tx, { entityType: "Order", entityId: orderId, type: `order.${to.toLowerCase()}`, source, payload });
    return t;
  });
}
