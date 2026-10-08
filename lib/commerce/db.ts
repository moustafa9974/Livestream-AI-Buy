import { Prisma } from "@/generated/prisma/client";
import type { AuditSource } from "@/generated/prisma/enums";
import { prisma } from "../db";

/** Either the root client or an interactive-transaction client. */
export type Db = typeof prisma | Prisma.TransactionClient;

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Row lock inside a transaction. Serializes the sync path, webhooks and double-clicks
 * that touch the same order/creator, so state checks and writes can't interleave.
 * Table names are a fixed union, never user input.
 */
export async function lockRow(
  tx: Prisma.TransactionClient,
  table: "Order" | "Creator" | "PayoutBatch",
  id: string,
): Promise<void> {
  await tx.$queryRawUnsafe(`SELECT 1 FROM "${table}" WHERE id = $1 FOR UPDATE`, id);
}

export interface AuditInput {
  entityType: "Order" | "Commission" | "PayoutBatch" | "Refund" | "WebhookEvent" | "Attribution";
  entityId: string;
  type: string;
  source: AuditSource;
  /** Must not contain payer PII or secrets: IDs, amounts, statuses only. */
  payload?: Prisma.InputJsonValue;
}

export function audit(db: Db, e: AuditInput) {
  return db.auditEvent.create({ data: { ...e, payload: e.payload ?? {} } });
}
