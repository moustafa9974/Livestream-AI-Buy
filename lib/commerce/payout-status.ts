import type { CommissionStatus } from "@/generated/prisma/enums";
import type { PayoutItemStatus } from "../paypal/gateway";

/** Failed/returned payouts are retried on the next "Pay me now". Unit-tested against commissionMachine. */
export const RETRYABLE_PAYOUT_STATES: CommissionStatus[] = ["FAILED", "RETURNED"];

/**
 * PayPal payout item transaction_status → our commission status.
 * null = still in progress, leave the commission alone.
 * Status values from the Payouts v1 spec (transaction_enum).
 */
export function commissionStatusForPayoutItem(status: PayoutItemStatus | undefined): CommissionStatus | null {
  switch (status) {
    case "SUCCESS":
      return "PAID";
    case "UNCLAIMED":
      return "UNCLAIMED";
    case "FAILED":
    case "BLOCKED":
      return "FAILED";
    case "RETURNED":
    case "REFUNDED": // payout refunded back to the sender
    case "REVERSED":
      return "RETURNED";
    case "PENDING":
    case "ONHOLD":
    case undefined:
      return null;
  }
}

/** Webhook event name → item status, for events whose resource lacks transaction_status. */
export function payoutItemStatusForEvent(eventType: string): PayoutItemStatus | undefined {
  const map: Record<string, PayoutItemStatus> = {
    "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "SUCCESS",
    "PAYMENT.PAYOUTS-ITEM.FAILED": "FAILED",
    "PAYMENT.PAYOUTS-ITEM.BLOCKED": "BLOCKED",
    "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "UNCLAIMED",
    "PAYMENT.PAYOUTS-ITEM.RETURNED": "RETURNED",
    "PAYMENT.PAYOUTS-ITEM.REFUNDED": "REFUNDED",
    "PAYMENT.PAYOUTS-ITEM.CANCELED": "RETURNED",
    "PAYMENT.PAYOUTS-ITEM.HELD": "ONHOLD",
  };
  return map[eventType];
}

/** Batch statuses after which PayPal won't change items any more without new events. */
export function isTerminalBatchStatus(status: string): boolean {
  return status === "SUCCESS" || status === "DENIED" || status === "CANCELED" || status === "FAILED_LOCAL";
}
