import { randomUUID } from "node:crypto";
import type { AuditSource } from "@/generated/prisma/enums";
import { prisma } from "../db";
import { sumMinor, toPayPalValue } from "../money";
import { paypal, type PayoutItem } from "../paypal/gateway";
import { PayPalApiError } from "../paypal/http";
import { formatMoney } from "../money";
import { notify } from "../notify";
import { commissionMachine } from "../state/commission";
import { audit, lockRow } from "./db";
import { commissionStatusForPayoutItem, RETRYABLE_PAYOUT_STATES } from "./payout-status";

/** PENDING commissions past their hold, and failed/returned payouts, become payable. */
export async function promoteEligible(creatorId: string, now = new Date()) {
  const res = await prisma.commission.updateMany({
    where: {
      creatorId,
      OR: [
        { status: "PENDING", eligibleAt: { lte: now } },
        { status: { in: RETRYABLE_PAYOUT_STATES } },
      ],
    },
    data: { status: "ELIGIBLE" },
  });
  return res.count;
}

export type PayMeNowResult =
  | { status: "nothing_to_pay" }
  | { status: "submitted"; batchIds: string[]; totalMinor: number; currency: string };

/**
 * "Pay me now": claim all ELIGIBLE commissions into a PayoutBatch (under a creator row
 * lock, so a double-click can't claim twice), then submit to PayPal Payouts with
 * sender_batch_id doubling as the PayPal-Request-Id.
 */
export async function payMeNow(creatorId: string, source: AuditSource = "creator"): Promise<PayMeNowResult> {
  await promoteEligible(creatorId);

  const batches = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Creator", creatorId);
    const eligible = await tx.commission.findMany({ where: { creatorId, status: "ELIGIBLE" } });
    const payable = eligible.filter((c) => c.amountMinor - c.reversedMinor > 0);
    const byCurrency = Map.groupBy(payable, (c) => c.currency);

    const created: { id: string; totalMinor: number; currency: string }[] = [];
    for (const [currency, list] of byCurrency) {
      const totalMinor = sumMinor(list.map((c) => c.amountMinor - c.reversedMinor));
      const batch = await tx.payoutBatch.create({
        data: { senderBatchId: `seen-${randomUUID()}`, status: "CREATED_LOCAL", totalMinor, currency },
      });
      for (const c of list) commissionMachine.assertTransition(c.status, "PAYOUT_SENT");
      await tx.commission.updateMany({
        where: { id: { in: list.map((c) => c.id) }, status: "ELIGIBLE" },
        data: { status: "PAYOUT_SENT", payoutBatchId: batch.id },
      });
      await audit(tx, {
        entityType: "PayoutBatch",
        entityId: batch.id,
        type: "payout.requested",
        source,
        payload: { totalMinor, currency, commissions: list.length },
      });
      created.push({ id: batch.id, totalMinor, currency });
    }
    return created;
  });

  if (batches.length === 0) return { status: "nothing_to_pay" };
  for (const b of batches) await submitBatch(b.id);
  return {
    status: "submitted",
    batchIds: batches.map((b) => b.id),
    totalMinor: batches[0].totalMinor,
    currency: batches[0].currency,
  };
}

/**
 * Sends a claimed batch to PayPal. Safe to call again (e.g. after a timeout): the
 * PayPal-Request-Id is the batch's fixed senderBatchId, so PayPal returns the original
 * batch instead of paying twice.
 */
export async function submitBatch(batchId: string): Promise<void> {
  const batch = await prisma.payoutBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { commissions: { include: { creator: true } } },
  });
  if (batch.paypalBatchId || batch.commissions.length === 0) return;
  const creator = batch.commissions[0].creator;

  try {
    const res = await paypal().createPayoutBatch(
      {
        sender_batch_header: {
          sender_batch_id: batch.senderBatchId,
          recipient_type: "EMAIL",
          email_subject: "You earned a commission on Seen",
          email_message: "Thanks for creating! Here are your Seen commissions.",
        },
        items: batch.commissions.map((c) => ({
          recipient_type: "EMAIL",
          receiver: creator.payoutEmail,
          amount: { currency: c.currency, value: toPayPalValue(c.amountMinor - c.reversedMinor, c.currency) },
          sender_item_id: c.id,
          note: "Seen creator commission",
        })),
      },
      batch.senderBatchId,
    );
    await prisma.payoutBatch.update({
      where: { id: batchId },
      data: { paypalBatchId: res.batch_header.payout_batch_id, status: res.batch_header.batch_status },
    });
    await audit(prisma, {
      entityType: "PayoutBatch",
      entityId: batchId,
      type: "payout.submitted",
      source: "system",
      payload: { paypalBatchId: res.batch_header.payout_batch_id, batchStatus: res.batch_header.batch_status },
    });
  } catch (err) {
    if (err instanceof PayPalApiError && !err.retryable && err.status !== 0) {
      // Definite rejection (e.g. insufficient funds, payouts not enabled): free the
      // commissions so the creator can retry later.
      await failBatch(batchId, err.paypalName ?? `HTTP_${err.status}`);
      throw err;
    }
    // Unknown outcome (timeout/5xx after retries): leave PAYOUT_SENT; syncPayoutBatch
    // re-submits with the same idempotency key.
    await prisma.payoutBatch.update({ where: { id: batchId }, data: { status: "SUBMIT_UNKNOWN" } });
    throw err;
  }
}

async function failBatch(batchId: string, reason: string) {
  const first = await prisma.commission.findFirst({ where: { payoutBatchId: batchId } });
  if (first) {
    void notify(first.creatorId, "payout.failed", {
      title: "Payout didn't go through",
      body: `PayPal rejected the payout (${reason}). Your commissions are safe and will be retried.`,
      data: { batchId, reason },
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.payoutBatch.update({ where: { id: batchId }, data: { status: "FAILED_LOCAL" } });
    const commissions = await tx.commission.findMany({ where: { payoutBatchId: batchId, status: "PAYOUT_SENT" } });
    for (const c of commissions) {
      commissionMachine.assertTransition(c.status, "FAILED");
      await tx.commission.update({ where: { id: c.id }, data: { status: "FAILED" } });
    }
    await audit(tx, { entityType: "PayoutBatch", entityId: batchId, type: "payout.failed", source: "system", payload: { reason } });
  });
}

/** Pulls the latest batch + item statuses from PayPal (used by UI polling and batch webhooks). */
export async function syncPayoutBatch(batchId: string): Promise<{ status: string }> {
  const batch = await prisma.payoutBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (!batch.paypalBatchId) {
    if (batch.status === "FAILED_LOCAL") return { status: batch.status };
    await submitBatch(batchId);
    return syncPayoutBatch(batchId);
  }
  const res = await paypal().getPayoutBatch(batch.paypalBatchId);
  const status = res.batch_header.batch_status;
  if (status !== batch.status) {
    await prisma.payoutBatch.update({ where: { id: batchId }, data: { status } });
    await audit(prisma, { entityType: "PayoutBatch", entityId: batchId, type: `payout.batch_${status.toLowerCase()}`, source: "system", payload: { batchStatus: status } });
  }
  for (const item of res.items ?? []) {
    await settlePayoutItem(item, "system", status === "DENIED" ? "FAILED" : undefined);
  }
  return { status };
}

/**
 * Applies one payout item result to its commission. Shared by polling and
 * PAYMENT.PAYOUTS-ITEM.* webhooks. The item must belong to the batch the commission
 * is currently in, so a stale event from an earlier failed attempt can't flip a retry.
 */
export async function settlePayoutItem(
  item: PayoutItem,
  source: AuditSource,
  fallbackStatus?: PayoutItem["transaction_status"],
): Promise<void> {
  const commissionId = item.payout_item.sender_item_id;
  if (!commissionId) return;
  const target = commissionStatusForPayoutItem(item.transaction_status ?? fallbackStatus);

  let outcome: { creatorId: string; status: string; netMinor: number; currency: string } | null = null;
  await prisma.$transaction(async (tx) => {
    const c = await tx.commission.findUnique({ where: { id: commissionId }, include: { payoutBatch: true } });
    if (!c || c.payoutBatch?.paypalBatchId !== item.payout_batch_id) return;
    if (!c.payoutItemId) {
      await tx.commission.update({ where: { id: c.id }, data: { payoutItemId: item.payout_item_id } });
    }
    if (!target) return;
    const t = commissionMachine.transition(c.status, target);
    if (t.kind !== "applied") return;
    await tx.commission.update({ where: { id: c.id }, data: { status: target } });
    outcome = { creatorId: c.creatorId, status: target, netMinor: c.amountMinor - c.reversedMinor, currency: c.currency };
    await audit(tx, {
      entityType: "Commission",
      entityId: c.id,
      type: `commission.${target.toLowerCase()}`,
      source,
      payload: { payoutItemId: item.payout_item_id, transactionStatus: item.transaction_status ?? null },
    });
    // A refund landed while the payout was in flight: finish the reversal now.
    if (target === "PAID" && c.reversedMinor >= c.amountMinor && c.amountMinor > 0) {
      await tx.commission.update({ where: { id: c.id }, data: { status: "REVERSED" } });
      await audit(tx, { entityType: "Commission", entityId: c.id, type: "commission.clawback_recorded", source: "system", payload: { reversedMinor: c.reversedMinor } });
    }
  });

  const o = outcome as { creatorId: string; status: string; netMinor: number; currency: string } | null;
  if (o?.status === "PAID") {
    void notify(o.creatorId, "commission.paid", {
      title: "Commission paid 🎉",
      body: `${formatMoney(o.netMinor, o.currency)} was sent to your PayPal account.`,
      data: { commissionId, amountMinor: o.netMinor, currency: o.currency },
    });
  } else if (o && (o.status === "FAILED" || o.status === "RETURNED")) {
    void notify(o.creatorId, "payout.failed", {
      title: "A payout didn't land",
      body: `PayPal reported ${o.status.toLowerCase()} for ${formatMoney(o.netMinor, o.currency)}. It will be retried on your next payout.`,
      data: { commissionId, status: o.status },
    });
  }
}
