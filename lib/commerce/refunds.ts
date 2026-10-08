import type { AuditSource } from "@/generated/prisma/enums";
import { prisma } from "../db";
import { commissionReversalMinor, sumMinor, toMinor, toPayPalAmount } from "../money";
import { paypal, type PayPalRefund } from "../paypal/gateway";
import { commissionMachine } from "../state/commission";
import { orderMachine, statusAfterRefund } from "../state/order";
import { CheckoutError } from "./checkout";
import { audit, lockRow } from "./db";

/**
 * Refunds (part of) a captured order. The idempotency key encodes "the Nth refund of
 * this amount", so a double-click sends the same key and PayPal returns the same refund.
 */
export async function refundOrder(orderId: string, amountMinor: number | undefined, source: AuditSource) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { refunds: true } });
  if (!order) throw new CheckoutError("NOT_FOUND", "Order not found");
  if (!order.paypalCaptureId || !["CAPTURED", "PARTIALLY_REFUNDED"].includes(order.status)) {
    throw new CheckoutError("INVALID_STATE", `Order is ${order.status}; nothing to refund`);
  }
  const remaining = order.totalMinor - order.refundedMinor;
  const amount = amountMinor ?? remaining;
  if (!Number.isInteger(amount) || amount <= 0 || amount > remaining) {
    throw new CheckoutError("BAD_QUANTITY", `Refund must be between 1 and ${remaining} minor units`);
  }

  const n = order.refunds.length + 1;
  const refund = await paypal().refundCapture(
    order.paypalCaptureId,
    { amount: toPayPalAmount(amount, order.currency), custom_id: order.id },
    `seen-refund-${order.id}-${n}-${amount}`,
  );
  return applyRefund({ orderId: order.id, refund, source });
}

/**
 * Shared by the sync refund path and PAYMENT.CAPTURE.REFUNDED webhooks. The Refund row
 * (unique paypalRefundId) makes it idempotent; only COMPLETED refunds move money state.
 */
export async function applyRefund(args: { orderId: string; refund: PayPalRefund; source: AuditSource }) {
  const { orderId, refund, source } = args;

  return prisma.$transaction(async (tx) => {
    await lockRow(tx, "Order", orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { commissions: true } });
    const amountMinor = refund.amount ? toMinor(refund.amount.value, refund.amount.currency_code) : 0;

    const existing = await tx.refund.findUnique({ where: { paypalRefundId: refund.id } });
    if (existing && existing.status === refund.status) return { applied: false, order };
    if (existing) {
      await tx.refund.update({ where: { id: existing.id }, data: { status: refund.status } });
    } else {
      await tx.refund.create({
        data: { orderId, paypalRefundId: refund.id, amountMinor, currency: order.currency, status: refund.status },
      });
    }

    const completed = await tx.refund.findMany({ where: { orderId, status: "COMPLETED" } });
    const refundedTotal = sumMinor(completed.map((r) => r.amountMinor));
    if (refundedTotal <= order.refundedMinor) return { applied: false, order };

    const to = statusAfterRefund(order.totalMinor, refundedTotal);
    const t = orderMachine.transition(order.status, to);
    if (t.kind !== "applied") {
      await audit(tx, { entityType: "Order", entityId: orderId, type: "order.refund_unexpected_state", source, payload: { from: order.status, to, refundId: refund.id } });
      return { applied: false, order };
    }
    await tx.order.update({ where: { id: orderId }, data: { status: to, refundedMinor: refundedTotal } });
    await audit(tx, { entityType: "Order", entityId: orderId, type: "order.refunded", source, payload: { refundId: refund.id, amountMinor, refundedTotalMinor: refundedTotal } });

    // Claw back commission in proportion to what was refunded.
    for (const c of order.commissions) {
      const delta = commissionReversalMinor({
        commissionMinor: c.amountMinor,
        alreadyReversedMinor: c.reversedMinor,
        capturedMinor: order.totalMinor,
        refundedTotalMinor: refundedTotal,
      });
      if (delta === 0) continue;
      const reversedMinor = c.reversedMinor + delta;
      const fully = reversedMinor >= c.amountMinor;
      // Fully reversed → REVERSED when the machine allows it. While a payout is in
      // flight (PAYOUT_SENT) we only record the amount; settlePayoutItem finishes the
      // reversal once PayPal reports the payout result.
      const ct = fully ? commissionMachine.transition(c.status, "REVERSED") : undefined;
      await tx.commission.update({
        where: { id: c.id },
        data: { reversedMinor, ...(ct?.kind === "applied" ? { status: "REVERSED" } : {}) },
      });
      await audit(tx, {
        entityType: "Commission",
        entityId: c.id,
        type: c.status === "PAID" ? "commission.clawback_recorded" : fully ? "commission.reversed" : "commission.partially_reversed",
        source: "system",
        payload: { reversedMinor: delta, totalReversedMinor: reversedMinor },
      });
    }
    return { applied: true, order };
  });
}
