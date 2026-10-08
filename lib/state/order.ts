import type { OrderStatus } from "@/generated/prisma/enums";
import { createMachine } from "./machine";

/**
 * Order lifecycle. CREATED → CAPTURED is allowed directly because PayPal can deliver
 * PAYMENT.CAPTURE.COMPLETED before (or instead of) CHECKOUT.ORDER.APPROVED.
 */
export const orderMachine = createMachine<OrderStatus>({
  name: "Order",
  transitions: {
    CREATED: ["APPROVED", "CAPTURED", "FAILED", "CANCELLED"],
    APPROVED: ["CAPTURED", "FAILED", "CANCELLED"],
    CAPTURED: ["PARTIALLY_REFUNDED", "REFUNDED"],
    PARTIALLY_REFUNDED: ["PARTIALLY_REFUNDED", "REFUNDED"],
    REFUNDED: [],
    FAILED: [],
    CANCELLED: [],
  },
  repeatable: ["PARTIALLY_REFUNDED"],
});

/** Which status a (cumulative) refund puts a captured order into. */
export function statusAfterRefund(totalMinor: number, refundedTotalMinor: number): OrderStatus {
  return refundedTotalMinor >= totalMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
}
