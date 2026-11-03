import { getEnv, type Env } from "./env";

/**
 * Free-tier budget guard. Counters live in the DB (UsageCounter) so limits hold across
 * serverless instances and restarts. Near a limit we degrade instead of failing:
 *   normal → saver (≥ SAVER_AT of any limit: slow down) → cache_only (limit hit: no new calls)
 */

export type Provider = "gemini" | "gemini_embed" | "openrouter" | "channel3" | "kernel_sessions" | "kernel_minutes";
export type BudgetMode = "normal" | "saver" | "cache_only";

export interface Limits {
  perMinute?: number;
  perDay?: number;
}

export interface Usage {
  minute: number;
  day: number;
}

export interface BudgetDecision {
  allowed: boolean;
  mode: BudgetMode;
  usage: Usage;
  limits: Limits;
}

export const SAVER_AT = 0.8;

export function limitsFor(provider: Provider, env: Env = getEnv()): Limits {
  switch (provider) {
    case "gemini":
      return { perMinute: env.GEMINI_MAX_RPM, perDay: env.GEMINI_MAX_RPD };
    case "gemini_embed":
      return { perMinute: env.GEMINI_EMBED_MAX_RPM, perDay: env.GEMINI_EMBED_MAX_RPD };
    case "openrouter":
      return { perMinute: env.OPENROUTER_MAX_RPM, perDay: env.OPENROUTER_MAX_RPD };
    case "channel3":
      return { perDay: env.CHANNEL3_MAX_CALLS_PER_DAY };
    case "kernel_sessions":
      return { perDay: env.KERNEL_MAX_SESSIONS_PER_DAY };
    case "kernel_minutes":
      // Daily minute cap = sessions × minutes per session.
      return { perDay: env.KERNEL_MAX_SESSIONS_PER_DAY * env.KERNEL_MAX_SESSION_MINUTES };
  }
}

/** Pure decision: would spending `cost` more units stay within limits? */
export function decide(usage: Usage, limits: Limits, cost = 1): BudgetDecision {
  const ratios: number[] = [];
  let allowed = true;
  for (const [used, limit] of [
    [usage.minute, limits.perMinute],
    [usage.day, limits.perDay],
  ] as const) {
    if (limit === undefined) continue;
    if (limit === 0 || used + cost > limit) allowed = false;
    ratios.push(limit === 0 ? 1 : (used + cost) / limit);
  }
  const worst = ratios.length ? Math.max(...ratios) : 0;
  const mode: BudgetMode = !allowed ? "cache_only" : worst >= SAVER_AT ? "saver" : "normal";
  return { allowed, mode, usage, limits };
}

/** Saver mode halves the sampling rate; cache-only stops sending frames to the AI. */
export function frameIntervalFor(mode: BudgetMode, baseSec: number): number | null {
  if (mode === "normal") return baseSec;
  if (mode === "saver") return baseSec * 2;
  return null;
}

export function windowKeys(now: Date): { minute: string; day: string } {
  const iso = now.toISOString();
  return { minute: `min:${iso.slice(0, 16)}`, day: `day:${iso.slice(0, 10)}` };
}

// ───────────── DB-backed operations ─────────────
// Imported lazily so the pure functions above can be unit-tested without a database.

async function db() {
  return (await import("./db")).prisma;
}

export async function peek(provider: Provider, now = new Date()): Promise<BudgetDecision> {
  const prisma = await db();
  const keys = windowKeys(now);
  const rows = await prisma.usageCounter.findMany({
    where: { provider, window: { in: [keys.minute, keys.day] } },
  });
  const usage: Usage = {
    minute: rows.find((r) => r.window === keys.minute)?.count ?? 0,
    day: rows.find((r) => r.window === keys.day)?.count ?? 0,
  };
  // "Could I make one more call right now?"
  return decide(usage, limitsFor(provider), 1);
}

/**
 * Reserve `cost` units before making a paid-quota call. Increment first, then check,
 * and roll back if over: this is safe under concurrency (two racing callers can't
 * both squeeze into the last slot) without needing a lock.
 */
export async function consume(
  provider: Provider,
  cost = 1,
  now = new Date(),
): Promise<BudgetDecision> {
  const prisma = await db();
  const keys = windowKeys(now);
  const limits = limitsFor(provider);

  // One atomic statement for both windows: no interactive transaction, so it never
  // waits for a pool slot under load, and costs a single round trip.
  const bump = (by: number) => prisma.$queryRaw<Array<{ window: string; count: number }>>`
    INSERT INTO "UsageCounter" (provider, "window", count, "updatedAt")
    VALUES (${provider}, ${keys.minute}, ${by}, now()), (${provider}, ${keys.day}, ${by}, now())
    ON CONFLICT (provider, "window") DO UPDATE
      SET count = "UsageCounter".count + EXCLUDED.count, "updatedAt" = now()
    RETURNING "window", count`;

  const rows = await bump(cost);
  const after = (w: string) => rows.find((r) => r.window === w)?.count ?? cost;
  const usageBefore: Usage = { minute: after(keys.minute) - cost, day: after(keys.day) - cost };
  const decision = decide(usageBefore, limits, cost);

  if (!decision.allowed) await bump(-cost);
  return decision;
}

/** Drop counters older than today; called from demo:reset and occasionally by the watcher. */
export async function pruneCounters(now = new Date()): Promise<number> {
  const prisma = await db();
  const { day } = windowKeys(now);
  const today = day.slice(4);
  const res = await prisma.usageCounter.deleteMany({
    where: {
      NOT: [{ window: { startsWith: `min:${today}` } }, { window: day }],
    },
  });
  return res.count;
}
