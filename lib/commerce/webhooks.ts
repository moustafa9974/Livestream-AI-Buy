import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import type { PayPalCapture, PayPalOrder, PayPalRefund, PayoutItem } from "../paypal/gateway";
import { applyCapture, captureCheckout, transitionOrder } from "./checkout";
import { isUniqueViolation } from "./db";
import { payoutItemStatusForEvent } from "./payout-status";
import { settlePayoutItem, syncPayoutBatch } from "./payouts";
import { applyRefund } from "./refunds";

export interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource: unknown;
}

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

/**
 * Stores the event once (unique PayPal event id), dispatches it, then marks it
 * processed. If dispatch throws, processedAt stays null and PayPal's retry re-runs it,
 * which is safe because every handler is idempotent.
 * Signature verification happens in the route BEFORE this is called.
 */
export async function handleWebhookEvent(event: PayPalWebhookEvent): Promise<WebhookOutcome> {
  let row;
  try {
    row = await prisma.webhookEvent.create({
      data: {
        paypalEventId: event.id,
        type: event.event_type,
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    row = await prisma.webhookEvent.findUniqueOrThrow({ where: { paypalEventId: event.id } });
    if (row.processedAt) return "duplicate";
  }

  const handled = await dispatch(event);
  await prisma.webhookEvent.update({ where: { id: row.id }, data: { processedAt: new Date() } });
  return handled ? "processed" : "ignored";
}

async function dispatch(event: PayPalWebhookEvent): Promise<boolean> {
  const type = event.event_type;

  if (type === "CHECKOUT.ORDER.APPROVED") {
    const order = event.resource as PayPalOrder;
    const ours = await findOrderByPayPalOrder(order.id, order.purchase_units?.[0]?.custom_id);
    if (!ours) return false;
    await transitionOrder(ours.id, "APPROVED", "webhook", { paypalOrderId: order.id });
    // If the viewer closed the tab after approving, the browser never asked us to
    // capture. Capture here; it's idempotent with the browser's capture call.
    await captureCheckout(order.id, "webhook");
    return true;
  }

  if (type.startsWith("PAYMENT.CAPTURE.") && type !== "PAYMENT.CAPTURE.REFUNDED" && type !== "PAYMENT.CAPTURE.REVERSED") {
    const capture = event.resource as PayPalCapture & {
      supplementary_data?: { related_ids?: { order_id?: string } };
    };
    const ours = await findOrderByPayPalOrder(capture.supplementary_data?.related_ids?.order_id, capture.custom_id);
    if (!ours) return false;
    await applyCapture({ orderId: ours.id, capture, source: "webhook" });
    return true;
  }

  if (type === "PAYMENT.CAPTURE.REFUNDED") {
    const refund = event.resource as PayPalRefund;
    const ours = await findOrderForRefund(refund);
    if (!ours) return false;
    await applyRefund({ orderId: ours.id, refund, source: "webhook" });
    return true;
  }

  if (type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    const item = event.resource as PayoutItem;
    await settlePayoutItem(item, "webhook", payoutItemStatusForEvent(type));
    return true;
  }

  if (type.startsWith("PAYMENT.PAYOUTSBATCH.")) {
    const resource = event.resource as { batch_header?: { payout_batch_id?: string } };
    const paypalBatchId = resource.batch_header?.payout_batch_id;
    if (!paypalBatchId) return false;
    const batch = await prisma.payoutBatch.findUnique({ where: { paypalBatchId } });
    if (!batch) return false;
    await syncPayoutBatch(batch.id);
    return true;
  }

  return false;
}

/** custom_id is our Order.id (set at creation); the PayPal order id is the fallback. */
async function findOrderByPayPalOrder(paypalOrderId: string | undefined, customId: string | undefined) {
  if (customId) {
    const byCustom = await prisma.order.findUnique({ where: { id: customId } });
    if (byCustom) return byCustom;
  }
  if (paypalOrderId) return prisma.order.findUnique({ where: { paypalOrderId } });
  return null;
}

/** Our refunds carry custom_id; dashboard refunds don't, so follow the "up" link to the capture. */
async function findOrderForRefund(refund: PayPalRefund) {
  if (refund.custom_id) {
    const byCustom = await prisma.order.findUnique({ where: { id: refund.custom_id } });
    if (byCustom) return byCustom;
  }
  const up = refund.links?.find((l) => l.rel === "up")?.href;
  const captureId = up?.match(/\/captures\/([^/?]+)/)?.[1];
  return captureId ? prisma.order.findUnique({ where: { paypalCaptureId: captureId } }) : null;
}
