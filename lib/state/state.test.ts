import { describe, expect, it } from "vitest";
import { commissionMachine, eligibleAtFrom } from "./commission";
import { orderMachine, statusAfterRefund } from "./order";

describe("orderMachine", () => {
  it("follows the happy path", () => {
    expect(orderMachine.transition("CREATED", "APPROVED").kind).toBe("applied");
    expect(orderMachine.transition("APPROVED", "CAPTURED").kind).toBe("applied");
    expect(orderMachine.transition("CAPTURED", "PARTIALLY_REFUNDED").kind).toBe("applied");
    expect(orderMachine.transition("PARTIALLY_REFUNDED", "REFUNDED").kind).toBe("applied");
  });

  it("allows capture before the APPROVED webhook arrives", () => {
    expect(orderMachine.transition("CREATED", "CAPTURED").kind).toBe("applied");
  });

  it("treats a late APPROVED webhook after capture as stale, not an error", () => {
    expect(orderMachine.transition("CAPTURED", "APPROVED")).toMatchObject({
      kind: "noop",
      reason: "stale",
    });
  });

  it("sync capture + webhook capture converge: the second is a noop", () => {
    expect(orderMachine.transition("CAPTURED", "CAPTURED")).toMatchObject({
      kind: "noop",
      reason: "same_state",
    });
  });

  it("a second partial refund is a real change", () => {
    expect(orderMachine.transition("PARTIALLY_REFUNDED", "PARTIALLY_REFUNDED").kind).toBe(
      "applied",
    );
  });

  it("rejects illegal jumps", () => {
    expect(orderMachine.transition("CREATED", "REFUNDED").kind).toBe("rejected");
    expect(orderMachine.transition("CANCELLED", "CAPTURED").kind).toBe("rejected");
    expect(orderMachine.transition("FAILED", "CAPTURED").kind).toBe("rejected");
    expect(() => orderMachine.assertTransition("REFUNDED", "CAPTURED")).not.toThrow(); // stale
    expect(() => orderMachine.assertTransition("CANCELLED", "REFUNDED")).toThrow(/illegal/);
  });

  it("picks the right status after a refund", () => {
    expect(statusAfterRefund(4500, 1000)).toBe("PARTIALLY_REFUNDED");
    expect(statusAfterRefund(4500, 4500)).toBe("REFUNDED");
  });
});

describe("commissionMachine", () => {
  it("follows the happy path", () => {
    expect(commissionMachine.transition("PENDING", "ELIGIBLE").kind).toBe("applied");
    expect(commissionMachine.transition("ELIGIBLE", "PAYOUT_SENT").kind).toBe("applied");
    expect(commissionMachine.transition("PAYOUT_SENT", "PAID").kind).toBe("applied");
  });

  it("handles every payout outcome", () => {
    for (const to of ["PAID", "FAILED", "UNCLAIMED", "RETURNED"] as const) {
      expect(commissionMachine.transition("PAYOUT_SENT", to).kind).toBe("applied");
    }
    expect(commissionMachine.transition("UNCLAIMED", "PAID").kind).toBe("applied");
    expect(commissionMachine.transition("UNCLAIMED", "RETURNED").kind).toBe("applied");
  });

  it("failed or returned payouts can be retried", () => {
    expect(commissionMachine.transition("FAILED", "ELIGIBLE").kind).toBe("applied");
    expect(commissionMachine.transition("RETURNED", "ELIGIBLE").kind).toBe("applied");
  });

  it("refunds reverse commissions before payout, and record a clawback after", () => {
    expect(commissionMachine.transition("PENDING", "REVERSED").kind).toBe("applied");
    expect(commissionMachine.transition("ELIGIBLE", "REVERSED").kind).toBe("applied");
    expect(commissionMachine.transition("PAID", "REVERSED").kind).toBe("applied");
  });

  it("does not reverse while money is in flight", () => {
    expect(commissionMachine.transition("PAYOUT_SENT", "REVERSED").kind).toBe("rejected");
  });

  it("can't pay a pending commission or un-reverse one", () => {
    expect(commissionMachine.transition("PENDING", "PAID").kind).toBe("rejected");
    expect(commissionMachine.transition("PENDING", "PAYOUT_SENT").kind).toBe("rejected");
    // Late hold-expiry jobs / duplicate webhooks after a reversal are stale noops:
    // the key property is that nothing is ever applied.
    expect(commissionMachine.transition("REVERSED", "ELIGIBLE").kind).not.toBe("applied");
    expect(commissionMachine.transition("REVERSED", "PAID").kind).not.toBe("applied");
    expect(commissionMachine.transition("REVERSED", "PENDING").kind).not.toBe("applied");
  });

  it("duplicate payout-success webhooks are noops", () => {
    expect(commissionMachine.transition("PAID", "PAID").kind).toBe("noop");
    expect(commissionMachine.transition("PAID", "PAYOUT_SENT")).toMatchObject({
      kind: "noop",
      reason: "stale",
    });
  });

  it("computes eligibility from the hold window", () => {
    const t = new Date("2026-10-08T12:00:00Z");
    expect(eligibleAtFrom(t, 0).toISOString()).toBe(t.toISOString());
    expect(eligibleAtFrom(t, 72).toISOString()).toBe("2026-10-11T12:00:00.000Z");
  });
});
