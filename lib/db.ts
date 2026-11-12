import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { RETRY_DELAYS_MS, retryable } from "./db-retry";

// Reuse one client across Next.js hot reloads in dev, otherwise every edit opens a
// new pool and Neon's free-tier connection limit runs out quickly.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Retry rules live in ./db-retry (pure, unit-tested); re-exported for existing callers.
export { isDroppedConnection, isUnreachable, retryable } from "./db-retry";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // pg already treats sslmode=require as verify-full and warns about it on every start
  // (the warning also lands in the browser console in dev). Say verify-full explicitly:
  // same behaviour, no warning.
  const connectionString = url.replace(/sslmode=(require|prefer|verify-ca)\b/, "sslmode=verify-full");
  const client = new PrismaClient({
    // Neon's pooler closes idle connections; retire ours first so a request never
    // picks up a dead socket ("Server has closed the connection").
    adapter: new PrismaPg({ connectionString, idleTimeoutMillis: 20_000 }),
    // Interactive transactions hold a row lock across several round trips. From a dev
    // machine far from the DB region (~300 ms per trip) Prisma's 5 s default expires;
    // co-located in production they finish in milliseconds.
    transactionOptions: { timeout: 20_000, maxWait: 10_000 },
  });
  const extended = client.$extends({
    // Neon's free compute sleeps when idle and the network can blip: the first queries
    // after a pause can fail to connect or hit a dead socket. Retrying (with a short wait
    // so the database can wake) turns a page crash into a slightly slower page.
    query: {
      async $allOperations({ operation, args, query }) {
        for (let attempt = 0; ; attempt++) {
          try {
            return await query(args);
          } catch (err) {
            if (attempt >= RETRY_DELAYS_MS.length || !retryable(operation, err)) throw err;
            await sleep(RETRY_DELAYS_MS[attempt]);
          }
        }
      },
    },
  });
  // A query-only extension leaves every model method's shape unchanged, but Prisma types
  // the result as a different client that functions typed `PrismaClient` /
  // `TransactionClient` reject. Nothing here uses $on/$use (the only members it lacks).
  return extended as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
