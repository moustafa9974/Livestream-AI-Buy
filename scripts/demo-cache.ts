/**
 * Demo vision cache, committed to the repo so a fresh clone (or the hosted demo) can run
 * the demo video with zero Gemini quota.
 *
 *   npm run demo:cache:export   DB → prisma/demo-vision-cache.json
 *   npm run demo:cache:import   prisma/demo-vision-cache.json → DB (also done by db:seed)
 *
 * Workflow: play the demo video once in the studio with Gemini enabled (every analysed
 * frame is cached by its dHash), then export and commit the file.
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client";

export const DEMO_CACHE_FILE = "prisma/demo-vision-cache.json";

interface Entry {
  key: string;
  value: unknown;
}

export async function importDemoCache(prisma: PrismaClient): Promise<number> {
  if (!existsSync(DEMO_CACHE_FILE)) return 0;
  const entries = JSON.parse(readFileSync(DEMO_CACHE_FILE, "utf8")) as Entry[];
  for (const e of entries) {
    if (!/^vision:[0-9a-f]{16}$/.test(e.key)) continue; // only frame results, nothing else
    const value = e.value as Prisma.InputJsonValue;
    await prisma.apiCache.upsert({
      where: { key: e.key },
      create: { key: e.key, kind: "vision", value },
      update: { value },
    });
  }
  return entries.length;
}

async function exportDemoCache(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.apiCache.findMany({ where: { kind: "vision" }, orderBy: { key: "asc" } });
  const entries: Entry[] = rows.map((r) => ({ key: r.key, value: r.value }));
  writeFileSync(DEMO_CACHE_FILE, JSON.stringify(entries, null, 1) + "\n");
  return entries.length;
}

async function main() {
  const mode = process.argv[2];
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    if (mode === "export") console.log(`Exported ${await exportDemoCache(prisma)} cached frames to ${DEMO_CACHE_FILE}`);
    else if (mode === "import") console.log(`Imported ${await importDemoCache(prisma)} cached frames`);
    else console.error("Usage: tsx scripts/demo-cache.ts export|import");
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when executed directly (the seed imports importDemoCache).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/demo-cache.ts")) void main();
