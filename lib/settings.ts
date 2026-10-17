import { prisma } from "./db";
import { getEnv } from "./env";

/**
 * Runtime overrides set from the demo control panel (DEMO_MODE only), stored in
 * ApiCache under kind "setting". Env vars stay the defaults; an override wins until
 * cleared or `demo:reset`. Values are validated by the panel API.
 */

export interface RuntimeSettings {
  commissionHoldHours?: number;
  aiProvider?: "gemini" | "ollama" | "claude";
}

const KEY = "setting:runtime";
let cache: { value: RuntimeSettings; at: number } | undefined;
const TTL_MS = 5000; // re-read occasionally so other processes pick up changes

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  if (!getEnv().DEMO_MODE) return {};
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const row = await prisma.apiCache.findUnique({ where: { key: KEY } });
  const value = (row?.value as RuntimeSettings | undefined) ?? {};
  cache = { value, at: Date.now() };
  return value;
}

export async function setRuntimeSettings(patch: RuntimeSettings): Promise<RuntimeSettings> {
  const value = { ...(await getRuntimeSettings()), ...patch };
  for (const k of Object.keys(value) as Array<keyof RuntimeSettings>) if (value[k] === undefined) delete value[k];
  await prisma.apiCache.upsert({
    where: { key: KEY },
    create: { key: KEY, kind: "setting", value: value as object },
    update: { value: value as object },
  });
  cache = { value, at: Date.now() };
  return value;
}

export async function clearRuntimeSettings(): Promise<void> {
  await prisma.apiCache.deleteMany({ where: { key: KEY } });
  cache = undefined;
}

export async function commissionHoldHours(): Promise<number> {
  return (await getRuntimeSettings()).commissionHoldHours ?? getEnv().COMMISSION_HOLD_HOURS;
}
