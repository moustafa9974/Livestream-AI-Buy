import type { CommissionStatus } from "@/generated/prisma/enums";
import { createMachine } from "./machine";

/**
 * Commission lifecycle.
 *
 * - FAILED / RETURNED go back to ELIGIBLE so the creator can be paid in a later batch.
 * - UNCLAIMED → PAID happens when the recipient claims the payout later.
 * - PAID → REVERSED records a clawback (refund after payout); money is not pulled back
 *   from the creator automatically, it's netted against future payouts.
 * - PAYOUT_SENT → REVERSED is deliberately NOT allowed: money is in flight. A refund in
 *   that window waits for the payout result, then reverses from PAID or FAILED.
 *
 * Payout webhooks must also match payoutItemId before applying, because the
 * FAILED → ELIGIBLE retry loop means "stale" detection alone can't tell attempts apart.
 */
export const commissionMachine = createMachine<CommissionStatus>({
  name: "Commission",
  transitions: {
    PENDING: ["ELIGIBLE", "REVERSED"],
    ELIGIBLE: ["PAYOUT_SENT", "REVERSED"],
    PAYOUT_SENT: ["PAID", "FAILED", "UNCLAIMED", "RETURNED"],
    UNCLAIMED: ["PAID", "RETURNED"],
    FAILED: ["ELIGIBLE", "REVERSED"],
    RETURNED: ["ELIGIBLE", "REVERSED"],
    PAID: ["REVERSED"],
    REVERSED: [],
  },
});

/** Holds expire into ELIGIBLE; computed from config, never from AI output. */
export function eligibleAtFrom(capturedAt: Date, holdHours: number): Date {
  return new Date(capturedAt.getTime() + holdHours * 3_600_000);
}
