/**
 * When a failed database call may run again (used by lib/db.ts). Pure, so it's unit-tested
 * without a database.
 */

// Reads that are safe to run twice. Writes are only retried when the database was never
// reached: if the socket died after a statement committed, a retry could apply it twice.
const READS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);

const describe = (err: unknown) =>
  err instanceof Error ? `${err.message} ${(err as { code?: string }).code ?? ""} ${String((err as { cause?: unknown }).cause ?? "")}` : String(err);

/** The socket died under us (Neon suspended the compute, or the network blipped). */
export function isDroppedConnection(err: unknown): boolean {
  return /Connection terminated unexpectedly|Server has closed the connection|ECONNRESET|P1017|P1008|SocketTimeout|Connection terminated due to connection timeout/i.test(describe(err));
}

/**
 * We never reached the database (Neon's free compute waking from sleep, DNS or network
 * hiccup). Nothing was sent, so even a write is safe to try again.
 */
export function isUnreachable(err: unknown): boolean {
  return /P1001|Can't reach database server|DatabaseNotReachable|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(describe(err));
}

/** Waits before each retry: long enough for a sleeping Neon compute to wake (~1–2 s). */
export const RETRY_DELAYS_MS = [500, 1500];

/** Whether a failed operation may run again: unreachable → always; dropped → reads only. */
export function retryable(operation: string, err: unknown): boolean {
  return isUnreachable(err) || (READS.has(operation) && isDroppedConnection(err));
}
