import { describe, expect, it } from "vitest";
import { decide, frameIntervalFor, limitsFor, windowKeys } from "./budget";
import { getEnv } from "./env";

describe("decide", () => {
  const limits = { perMinute: 10, perDay: 100 };

  it("is normal well under limits", () => {
    expect(decide({ minute: 0, day: 0 }, limits)).toMatchObject({ allowed: true, mode: "normal" });
  });

  it("enters saver mode at 80% of any limit", () => {
    expect(decide({ minute: 7, day: 0 }, limits).mode).toBe("saver"); // 8/10
    expect(decide({ minute: 0, day: 79 }, limits).mode).toBe("saver"); // 80/100
  });

  it("goes cache-only when a call would exceed a limit", () => {
    expect(decide({ minute: 10, day: 0 }, limits)).toMatchObject({
      allowed: false,
      mode: "cache_only",
    });
    expect(decide({ minute: 0, day: 100 }, limits).allowed).toBe(false);
  });

  it("allows the very last unit", () => {
    expect(decide({ minute: 9, day: 0 }, limits).allowed).toBe(true);
  });

  it("respects multi-unit costs (e.g. KERNEL minutes)", () => {
    expect(decide({ minute: 0, day: 25 }, { perDay: 30 }, 5).allowed).toBe(true);
    expect(decide({ minute: 0, day: 26 }, { perDay: 30 }, 5).allowed).toBe(false);
  });

  it("a zero limit disables the provider", () => {
    expect(decide({ minute: 0, day: 0 }, { perDay: 0 }).allowed).toBe(false);
  });

  it("no limits means always allowed", () => {
    expect(decide({ minute: 999, day: 999 }, {})).toMatchObject({ allowed: true, mode: "normal" });
  });
});

describe("frameIntervalFor", () => {
  it("slows down in saver mode and stops in cache-only", () => {
    expect(frameIntervalFor("normal", 4)).toBe(4);
    expect(frameIntervalFor("saver", 4)).toBe(8);
    expect(frameIntervalFor("cache_only", 4)).toBeNull();
  });
});

describe("limitsFor", () => {
  it("reads limits from env", () => {
    const env = getEnv({
      DATABASE_URL: "postgres://x",
      GEMINI_MAX_RPM: "5",
      GEMINI_MAX_RPD: "50",
      KERNEL_MAX_SESSIONS_PER_DAY: "2",
      KERNEL_MAX_SESSION_MINUTES: "10",
    });
    expect(limitsFor("gemini", env)).toEqual({ perMinute: 5, perDay: 50 });
    expect(limitsFor("kernel_minutes", env)).toEqual({ perDay: 20 });
  });
});

describe("windowKeys", () => {
  it("uses UTC minute and day windows", () => {
    expect(windowKeys(new Date("2026-10-08T16:12:59.999Z"))).toEqual({
      minute: "min:2026-10-08T16:12",
      day: "day:2026-10-08",
    });
  });
});
