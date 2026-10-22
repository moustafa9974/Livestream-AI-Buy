import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Reuse one client across Next.js hot reloads in dev, otherwise every edit opens a
// new pool and Neon's free-tier connection limit runs out quickly.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Reads that are safe to run twice. Writes are never retried: if the socket died after
// the statement committed, a retry could apply it a second time.
const READS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);

/** The socket died under us (Neon suspended the compute, or the network blipped). */
export function isDroppedConnection(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${(err as { code?: string }).code ?? ""}` : String(err);
  return /Connection terminated unexpectedly|Server has closed the connection|ECONNRESET|P1017|P1008|SocketTimeout|Connection terminated due to connection timeout/i.test(msg);
}

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
    // A pooled connection can still die between requests (Neon autosuspend, flaky
    // network). The pool drops the dead socket, so one retry of a read on a fresh
    // connection turns a page crash into a slightly slower page.
    query: {
      async $allOperations({ operation, args, query }) {
        try {
          return await query(args);
        } catch (err) {
          if (!READS.has(operation) || !isDroppedConnection(err)) throw err;
          return query(args);
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
