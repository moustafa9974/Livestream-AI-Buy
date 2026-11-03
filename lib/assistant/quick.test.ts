import { beforeEach, describe, expect, it, vi } from "vitest";

const runTool = vi.fn();
vi.mock("./tools", () => ({ runTool: (...a: unknown[]) => runTool(...a) }));
const { quickAnswer } = await import("./quick");

const ctx = { creatorId: "c1", lastUserMessage: "" };

describe("quickAnswer (no-AI fallback)", () => {
  beforeEach(() => runTool.mockReset());

  it("answers earnings for the requested period, quoting tool amounts verbatim", async () => {
    runTool.mockResolvedValue({ sales: 2, total_earned: "$9.40", payable_now: "$4.90", pending: "$4.50", in_payout: "$0.00", paid: "$0.00" });
    const a = await quickAnswer("How much did I earn this week?", ctx);
    expect(runTool).toHaveBeenCalledWith("earnings_summary", { period: "week" }, ctx);
    expect(a.reply).toContain("**$9.40**");
    expect(a.reply).toContain("2 sales");
  });

  it("never sends money: 'pay me now' only reports what's payable", async () => {
    runTool.mockResolvedValue({ payable_now: "$7.90", recent_payouts: [] });
    const a = await quickAnswer("pay me now", ctx);
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith("payout_status", {}, ctx);
    expect(a.reply).toContain("Pay me now");
  });

  it("hides products by keyword", async () => {
    runTool.mockResolvedValue({ hidden: ["round tortoise sunglasses"] });
    await quickAnswer("Hide all sunglasses", ctx);
    expect(runTool).toHaveBeenCalledWith("hide_detections", { label_contains: "sunglasse" }, ctx);
  });

  it("routes stream, orders, top products and schedule questions", async () => {
    runTool.mockResolvedValue([]);
    await quickAnswer("What are my top products?", ctx);
    await quickAnswer("List my last 3 orders", ctx);
    await quickAnswer("When is my next stream?", ctx);
    expect(runTool.mock.calls.map((c) => c[0])).toEqual(["top_products", "recent_orders", "upcoming_streams"]);
    runTool.mockResolvedValue({ title: "Desk tour", status: "live", products_on_screen: [] });
    expect((await quickAnswer("What's on screen right now?", ctx)).reply).toContain("live now");
  });

  it("explains what it can do for anything else, without calling tools", async () => {
    const a = await quickAnswer("tell me a joke", ctx);
    expect(a.tool).toBeNull();
    expect(runTool).not.toHaveBeenCalled();
  });
});
