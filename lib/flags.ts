import { getEnv, type Env } from "./env";

/**
 * Feature flags. A feature is "on" only if its flag is enabled AND the keys it needs
 * are present. The UI shows `reason` in an "unavailable" chip, so the core loop never
 * depends on a sponsor being configured.
 */

export type Feature =
  | "paypal"
  | "agentToolkit"
  | "gemini"
  | "ollama"
  | "claude"
  | "channel3"
  | "kernel"
  | "elastic"
  | "astropods"
  | "zapier"
  | "bryntum"
  | "audioContext"
  | "demoMode"
  | "demoCache";

export interface FeatureStatus {
  enabled: boolean;
  reason?: string; // why it's off, safe to show to users (never contains secrets)
}

const on: FeatureStatus = { enabled: true };
const off = (reason: string): FeatureStatus => ({ enabled: false, reason });

function needs(flag: boolean, flagName: string, keys: Array<[unknown, string]>): FeatureStatus {
  if (!flag) return off(`${flagName} is off`);
  const missing = keys.filter(([v]) => !v).map(([, name]) => name);
  return missing.length ? off(`missing ${missing.join(", ")}`) : on;
}

export function featureStatus(feature: Feature, env: Env = getEnv()): FeatureStatus {
  switch (feature) {
    case "paypal":
      return needs(env.PAYPAL_ENABLED, "PAYPAL_ENABLED", [
        [env.PAYPAL_CLIENT_ID, "PAYPAL_CLIENT_ID"],
        [env.PAYPAL_CLIENT_SECRET, "PAYPAL_CLIENT_SECRET"],
      ]);
    case "agentToolkit": {
      const paypal = featureStatus("paypal", env);
      if (!paypal.enabled) return off(`needs PayPal (${paypal.reason})`);
      return needs(env.PAYPAL_AGENT_TOOLKIT_ENABLED, "PAYPAL_AGENT_TOOLKIT_ENABLED", []);
    }
    case "gemini":
      return needs(true, "", [[env.GEMINI_API_KEY, "GEMINI_API_KEY"]]);
    case "ollama":
      return env.AI_PROVIDER === "ollama" ? on : off("AI_PROVIDER is not ollama");
    case "claude":
      // Paid API: only on when explicitly selected AND keyed.
      return needs(env.AI_PROVIDER === "claude", "AI_PROVIDER=claude", [
        [env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY"],
      ]);
    case "channel3":
      return needs(env.CHANNEL3_ENABLED, "CHANNEL3_ENABLED", [
        [env.CHANNEL3_API_KEY, "CHANNEL3_API_KEY"],
      ]);
    case "kernel":
      // With the Astropods watcher, the KERNEL key lives in the agent; Seen only needs
      // the shared token the agent authenticates with.
      if (env.WATCHER_RUNTIME === "astropods") {
        return needs(env.KERNEL_ENABLED, "KERNEL_ENABLED", [[env.WATCHER_TOKEN, "WATCHER_TOKEN"]]);
      }
      return needs(env.KERNEL_ENABLED, "KERNEL_ENABLED", [[env.KERNEL_API_KEY, "KERNEL_API_KEY"]]);
    case "elastic":
      return needs(env.ELASTIC_ENABLED, "ELASTIC_ENABLED", [[env.ELASTIC_URL, "ELASTIC_URL"]]);
    case "astropods":
      return needs(env.WATCHER_RUNTIME === "astropods", "WATCHER_RUNTIME=astropods", [[env.WATCHER_TOKEN, "WATCHER_TOKEN"]]);
    case "zapier":
      // Per-creator webhook URLs live in the DB; this is just the global switch.
      return needs(env.ZAPIER_ENABLED, "ZAPIER_ENABLED", []);
    case "bryntum":
      return needs(env.BRYNTUM_ENABLED, "BRYNTUM_ENABLED", []);
    case "audioContext":
      return needs(env.AUDIO_CONTEXT, "AUDIO_CONTEXT", []);
    case "demoMode":
      return needs(env.DEMO_MODE, "DEMO_MODE", []);
    case "demoCache":
      return needs(env.DEMO_CACHE, "DEMO_CACHE", []);
  }
}

export function isEnabled(feature: Feature, env?: Env): boolean {
  return featureStatus(feature, env).enabled;
}

const ALL_FEATURES: Feature[] = [
  "paypal", "agentToolkit", "gemini", "ollama", "claude", "channel3", "kernel", "elastic",
  "astropods", "zapier", "bryntum", "audioContext", "demoMode", "demoCache",
];

export function allFeatureStatuses(env?: Env): Record<Feature, FeatureStatus> {
  return Object.fromEntries(ALL_FEATURES.map((f) => [f, featureStatus(f, env)])) as Record<
    Feature,
    FeatureStatus
  >;
}
