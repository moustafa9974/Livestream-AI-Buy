import { describe, expect, it } from "vitest";
import { getEnv } from "./env";
import { allFeatureStatuses, featureStatus } from "./flags";

const base = { DATABASE_URL: "postgres://x" };

describe("feature flags", () => {
  it("everything optional degrades to off with a reason, nothing throws", () => {
    const statuses = allFeatureStatuses(getEnv(base));
    expect(statuses.paypal).toEqual({
      enabled: false,
      reason: "missing PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET",
    });
    expect(statuses.channel3.enabled).toBe(false);
    expect(statuses.kernel).toEqual({ enabled: false, reason: "KERNEL_ENABLED is off" });
    expect(statuses.demoMode.enabled).toBe(true);
  });

  it("turns on when the flag and keys are present", () => {
    const env = getEnv({ ...base, PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" });
    expect(featureStatus("paypal", env).enabled).toBe(true);
    expect(featureStatus("agentToolkit", env).enabled).toBe(true);
  });

  it("a flag set to false wins over present keys", () => {
    const env = getEnv({ ...base, CHANNEL3_ENABLED: "false", CHANNEL3_API_KEY: "k" });
    expect(featureStatus("channel3", env)).toEqual({
      enabled: false,
      reason: "CHANNEL3_ENABLED is off",
    });
  });

  it("the paid Claude adapter stays off unless explicitly selected", () => {
    expect(featureStatus("claude", getEnv({ ...base, ANTHROPIC_API_KEY: "k" })).enabled).toBe(
      false,
    );
    expect(
      featureStatus("claude", getEnv({ ...base, AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "k" }))
        .enabled,
    ).toBe(true);
  });

  it("reasons never leak secret values", () => {
    const env = getEnv({ ...base, PAYPAL_CLIENT_ID: "id-123", PAYPAL_CLIENT_SECRET: "" });
    expect(JSON.stringify(allFeatureStatuses(env))).not.toContain("id-123");
  });

  it("missing DATABASE_URL fails loudly, naming only the variable", () => {
    expect(() => getEnv({})).toThrow(/DATABASE_URL/);
  });
});
