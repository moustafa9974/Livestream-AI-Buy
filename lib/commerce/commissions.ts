import type { Prisma } from "@/generated/prisma/client";
import { commissionHoldHours } from "../settings";
import { commissionMinor } from "../money";
import { eligibleAtFrom } from "../state/commission";
import { audit, isUniqueViolation } from "./db";

/**
 * Creates the creator's commission for a freshly captured order. Idempotent: the
 * (orderId, creatorId) unique key means a replay is a noop. Rate and base come from
 * the DB (creator row + order snapshot), never from AI output or the client.
 */
export async function createCommissionForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  capturedMinor: number,
  now = new Date(),
): Promise<{ created: boolean; amountMinor: number; creatorName?: string; creatorId?: string; currency?: string }> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { attribution: { include: { stream: { include: { creator: true } } } } },
  });
  const creator = order.attribution?.stream.creator;
  if (!creator) return { created: false, amountMinor: 0 }; // unattributed sale: no creator to pay

  // Commission is on the item subtotal actually captured (never on shipping/tax, and
  // never more than we charged).
  const base = Math.min(order.subtotalMinor, capturedMinor);
  const amountMinor = commissionMinor(base, creator.commissionRateBps);
  const eligibleAt = eligibleAtFrom(now, await commissionHoldHours());

  try {
    const commission = await tx.commission.create({
      data: {
        orderId,
        creatorId: creator.id,
        baseMinor: base,
        rateBps: creator.commissionRateBps,
        amountMinor,
        currency: order.currency,
        // A zero-hour hold (demo mode) makes it payable immediately. Initial status,
        // not a transition, so it doesn't go through the state machine.
        status: eligibleAt <= now ? "ELIGIBLE" : "PENDING",
        eligibleAt,
      },
    });
    await audit(tx, {
      entityType: "Commission",
      entityId: commission.id,
      type: "commission.created",
      source: "system",
      payload: { orderId, amountMinor, rateBps: creator.commissionRateBps, baseMinor: base },
    });
    return { created: true, amountMinor, creatorName: creator.displayName, creatorId: creator.id, currency: order.currency };
  } catch (err) {
    if (isUniqueViolation(err)) return { created: false, amountMinor, creatorName: creator.displayName };
    throw err;
  }
}
