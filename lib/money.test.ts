import { describe, expect, it } from "vitest";
import {
  commissionMinor,
  commissionReversalMinor,
  formatMoney,
  sumMinor,
  toMinor,
  toPayPalAmount,
  toPayPalValue,
} from "./money";

describe("toMinor / toPayPalValue", () => {
  it("round-trips 2-decimal currencies without floats", () => {
    expect(toMinor("12.34", "USD")).toBe(1234);
    expect(toMinor("0.1", "USD")).toBe(10);
    expect(toMinor("7", "EUR")).toBe(700);
    expect(toPayPalValue(1234, "USD")).toBe("12.34");
    expect(toPayPalValue(5, "USD")).toBe("0.05");
    expect(toPayPalValue(0, "USD")).toBe("0.00");
    expect(toPayPalValue(-250, "USD")).toBe("-2.50");
  });

  it("handles zero-decimal currencies", () => {
    expect(toMinor("1500", "JPY")).toBe(1500);
    expect(toPayPalValue(1500, "JPY")).toBe("1500");
    expect(() => toMinor("1500.5", "JPY")).toThrow();
  });

  it("classic float trap: 0.1 + 0.2 stays exact", () => {
    expect(toPayPalValue(sumMinor([toMinor("0.10", "USD"), toMinor("0.20", "USD")]), "USD")).toBe(
      "0.30",
    );
  });

  it("rejects malformed input, extra decimals, unknown currencies, non-integers", () => {
    expect(() => toMinor("12.345", "USD")).toThrow();
    expect(() => toMinor("1e3", "USD")).toThrow();
    expect(() => toMinor("abc", "USD")).toThrow();
    expect(() => toMinor("1.00", "XYZ")).toThrow();
    expect(() => toPayPalValue(1.5, "USD")).toThrow();
  });

  it("builds a PayPal amount object", () => {
    expect(toPayPalAmount(4999, "USD")).toEqual({ currency_code: "USD", value: "49.99" });
  });

  it("formats for display", () => {
    expect(formatMoney(4500, "USD")).toBe("$45.00");
  });
});

describe("commissionMinor", () => {
  it("is floor(base × bps / 10000)", () => {
    expect(commissionMinor(4500, 1000)).toBe(450);
    expect(commissionMinor(999, 1000)).toBe(99); // 99.9 → 99, never round up
    expect(commissionMinor(1, 1000)).toBe(0);
    expect(commissionMinor(10_000, 0)).toBe(0);
    expect(commissionMinor(10_000, 10_000)).toBe(10_000);
  });

  it("stays exact for large bases", () => {
    expect(commissionMinor(Number.MAX_SAFE_INTEGER, 1)).toBe(
      Number(BigInt(Number.MAX_SAFE_INTEGER) / 10_000n),
    );
  });

  it("rejects invalid rates and negative bases", () => {
    expect(() => commissionMinor(100, -1)).toThrow();
    expect(() => commissionMinor(100, 10_001)).toThrow();
    expect(() => commissionMinor(100, 12.5)).toThrow();
    expect(() => commissionMinor(-100, 1000)).toThrow();
  });
});

describe("commissionReversalMinor", () => {
  it("reverses everything on a full refund", () => {
    expect(
      commissionReversalMinor({
        commissionMinor: 450,
        alreadyReversedMinor: 0,
        capturedMinor: 4500,
        refundedTotalMinor: 4500,
      }),
    ).toBe(450);
  });

  it("partial refunds sum to the full commission, never more", () => {
    const base = { commissionMinor: 333, capturedMinor: 1000 };
    let reversed = 0;
    for (const refundedTotal of [300, 600, 1000]) {
      reversed += commissionReversalMinor({
        ...base,
        alreadyReversedMinor: reversed,
        refundedTotalMinor: refundedTotal,
      });
    }
    expect(reversed).toBe(333);
  });

  it("is idempotent when the same refund total is replayed", () => {
    const args = { commissionMinor: 450, capturedMinor: 4500, refundedTotalMinor: 1500 };
    const first = commissionReversalMinor({ ...args, alreadyReversedMinor: 0 });
    expect(first).toBe(150);
    expect(commissionReversalMinor({ ...args, alreadyReversedMinor: first })).toBe(0);
  });

  it("caps over-refunds at the commission", () => {
    expect(
      commissionReversalMinor({
        commissionMinor: 450,
        alreadyReversedMinor: 0,
        capturedMinor: 4500,
        refundedTotalMinor: 9999,
      }),
    ).toBe(450);
  });
});
