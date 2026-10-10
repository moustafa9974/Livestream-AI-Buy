import { z } from "zod";

/**
 * Typed server env. Every sponsor key is optional: a missing key turns the feature
 * off (see lib/flags.ts) instead of crashing the app. Only DATABASE_URL is required.
 */

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v === "true" || v === "1"));

const int = (def: number) => z.coerce.number().int().nonnegative().default(def);
const str = z.string().trim().min(1).optional().catch(undefined);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),

  DEMO_MODE: bool(true),
  DEMO_CACHE: bool(true),
  COMMISSION_HOLD_HOURS: int(0),
  DEFAULT_COMMISSION_BPS: int(1000),

  // PayPal (sandbox)
  PAYPAL_ENABLED: bool(true),
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_CLIENT_ID: str,
  PAYPAL_CLIENT_SECRET: str,
  PAYPAL_WEBHOOK_ID: str,
  PAYPAL_AGENT_TOOLKIT_ENABLED: bool(true),
  PAYPAL_TIMEOUT_MS: int(15_000),
  CHECKOUT_SHIPPING_PREFERENCE: z.enum(["GET_FROM_FILE", "NO_SHIPPING"]).default("GET_FROM_FILE"),
  DEMO_CREATOR_PAYOUT_EMAIL: str,

  // AI
  AI_PROVIDER: z.enum(["gemini", "ollama", "claude"]).default("gemini"),
  GEMINI_API_KEY: str,
  GEMINI_VISION_MODEL: z.string().default("gemini-3.8-flash"),
  // Tried once when the main model is busy (503) or rate-limited (429). "" disables.
  GEMINI_VISION_FALLBACK_MODEL: z.string().default("gemini-3.5-flash"),
  GEMINI_TEXT_MODEL: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  EMBEDDING_DIM: int(768),
  GEMINI_MAX_RPM: int(8),
  GEMINI_MAX_RPD: int(800),
  GEMINI_EMBED_MAX_RPM: int(60),
  GEMINI_EMBED_MAX_RPD: int(900),
  // "" disables the thinking config (for models that don't support thinking levels).
  GEMINI_THINKING_LEVEL: z.enum(["", "LOW", "MEDIUM", "HIGH"]).default("LOW"),
  VISION_TIMEOUT_MS: int(20_000),
  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_VISION_MODEL: z.string().default("qwen2.5vl:7b"),
  ANTHROPIC_API_KEY: str,
  CLAUDE_VISION_MODEL: z.string().default("claude-opus-5-5"),

  // Vision pipeline tuning
  FRAME_INTERVAL_SEC: int(4),
  DHASH_MIN_DISTANCE: int(10),
  MAX_STALE_SECONDS: int(20),
  // DEMO_CACHE: reuse a cached frame result when the dHash is within this distance.
  DEMO_CACHE_MAX_DISTANCE: int(10),
  DETECTION_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.55),
  MAX_VISIBLE_PRODUCTS: int(12),
  // Featured, high-confidence items show on first sighting (see lib/vision/tracker.ts). >1 disables.
  DETECTION_FAST_LANE_CONFIDENCE: z.coerce.number().min(0).default(0.9),
  DETECTION_FAST_LANE_PROMINENCE: z.coerce.number().min(0).max(1).default(0.6),
  // Match thresholds, calibrated 2026-10-10 on real Gemini embeddings (true ≥0.89, decoys ≤0.69).
  MATCH_EXACT_SCORE: z.coerce.number().min(0).max(1).default(0.85),
  MATCH_SIMILAR_SCORE: z.coerce.number().min(0).max(1).default(0.7),
  // Used only when no embedding is available (embedding quota exhausted).
  MATCH_TEXT_EXACT_SCORE: z.coerce.number().min(0).max(1).default(0.4),
  MATCH_TEXT_SIMILAR_SCORE: z.coerce.number().min(0).max(1).default(0.3),

  // Sponsors
  CHANNEL3_ENABLED: bool(true),
  CHANNEL3_API_KEY: str,
  CHANNEL3_MAX_CALLS_PER_DAY: int(300),
  KERNEL_ENABLED: bool(false),
  KERNEL_API_KEY: str,
  KERNEL_MAX_SESSION_MINUTES: int(10),
  KERNEL_MAX_SESSIONS_PER_DAY: int(3),
  ELASTIC_ENABLED: bool(false),
  ELASTIC_URL: str,
  ELASTIC_API_KEY: str,
  WATCHER_RUNTIME: z.enum(["local", "astropods"]).default("local"),
  ASTROPODS_API_KEY: str,
  ZAPIER_ENABLED: bool(false),
  BRYNTUM_ENABLED: bool(false),
  AUDIO_CONTEXT: bool(false),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  if (source === process.env && cached) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Print variable names only. Values may be secrets.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

export function resetEnvCache(): void {
  cached = undefined;
}
