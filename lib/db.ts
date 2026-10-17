import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Reuse one client across Next.js hot reloads in dev, otherwise every edit opens a
// new pool and Neon's free-tier connection limit runs out quickly.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({
    // Neon's pooler closes idle connections; retire ours first so a request never
    // picks up a dead socket ("Server has closed the connection").
    adapter: new PrismaPg({ connectionString, idleTimeoutMillis: 20_000 }),
    // Interactive transactions hold a row lock across several round trips. From a dev
    // machine far from the DB region (~300 ms per trip) Prisma's 5 s default expires;
    // co-located in production they finish in milliseconds.
    transactionOptions: { timeout: 20_000, maxWait: 10_000 },
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
