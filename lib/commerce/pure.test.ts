import { describe, expect, it } from "vitest";
import { commissionMachine } from "../state/commission";
import { buildCreateOrderBody } from "./order-body";
import { commissionStatusForPayoutItem, payoutItemStatusForEvent, RETRYABLE_PAYOUT_STATES } from "./payout-status";

describe("buildCreateOrderBody", () => {
  const base = {
    orderId: "ord_1",
    lines: [{ partnerProductId: "p1", title: "Everyday Oversized Hoodie: Black", unitMinor: 4500, quantity: 2 }],
    totalMinor: 9000,
    currency: "USD",
    shippingPreference: "GET_FROM_FILE" as const,
  };

  it("formats amounts from minor units and sets custom_id to our order id", () => {
    const body = buildCreateOrderBody({ ...base, paymentMethod: "paypal" });
    const pu = body.purchase_units[0];
    expect(body.intent).toBe("CAPTURE");
    expect(pu.custom_id).toBe("ord_1");
    expect(pu.amount).toEqual({
      currency_code: "USD",
      value: "90.00",
      breakdown: { item_total: { currency_code: "USD", value: "90.00" } },
    });
    expect(pu.items[0]).toMatchObject({ quantity: "2", unit_amount: { value: "45.00" }, category: "PHYSICAL_GOODS" });
  });

  it("adds a PayPal experience_context only for the PayPal wallet", () => {
    expect(buildCreateOrderBody({ ...base, paymentMethod: "paypal" }).payment_source?.paypal.experience_context).toMatchObject({
      shipping_preference: "GET_FROM_FILE",
      user_action: "PAY_NOW",
    });
    expect(buildCreateOrderBody({ ...base, paymentMethod: "card" }).payment_source).toBeUndefined();
  });

  it("truncates item names to PayPal's 127-char limit", () => {
    const body = buildCreateOrderBody({
      ...base,
      paymentMethod: "card",
      lines: [{ ...base.lines[0], title: "x".repeat(300) }],
    });
    expect(body.purchase_units[0].items[0].name).toHaveLength(127);
  });
});

describe("payout status mapping", () => {
  it("maps every PayPal item status", () => {
    expect(commissionStatusForPayoutItem("SUCCESS")).toBe("PAID");
    expect(commissionStatusForPayoutItem("UNCLAIMED")).toBe("UNCLAIMED");
    expect(commissionStatusForPayoutItem("FAILED")).toBe("FAILED");
    expect(commissionStatusForPayoutItem("BLOCKED")).toBe("FAILED");
    expect(commissionStatusForPayoutItem("RETURNED")).toBe("RETURNED");
    expect(commissionStatusForPayoutItem("REFUNDED")).toBe("RETURNED");
    expect(commissionStatusForPayoutItem("REVERSED")).toBe("RETURNED");
    expect(commissionStatusForPayoutItem("PENDING")).toBeNull();
    expect(commissionStatusForPayoutItem("ONHOLD")).toBeNull();
  });

  it("every mapped status is reachable from PAYOUT_SENT or UNCLAIMED", () => {
    for (const s of ["SUCCESS", "UNCLAIMED", "FAILED", "RETURNED"] as const) {
      const target = commissionStatusForPayoutItem(s)!;
      expect(
        commissionMachine.canTransition("PAYOUT_SENT", target) || commissionMachine.canTransition("UNCLAIMED", target),
      ).toBe(true);
    }
  });

  it("maps verified webhook event names", () => {
    expect(payoutItemStatusForEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED")).toBe("SUCCESS");
    expect(payoutItemStatusForEvent("PAYMENT.PAYOUTS-ITEM.UNCLAIMED")).toBe("UNCLAIMED");
    expect(payoutItemStatusForEvent("PAYMENT.PAYOUTS-ITEM.CANCELED")).toBe("RETURNED");
    expect(payoutItemStatusForEvent("SOMETHING.ELSE")).toBeUndefined();
  });

  it("failed/returned payouts can be retried per the commission machine", () => {
    for (const s of RETRYABLE_PAYOUT_STATES) expect(commissionMachine.canTransition(s, "ELIGIBLE")).toBe(true);
  });
});
