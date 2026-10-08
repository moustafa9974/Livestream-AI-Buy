import { errorResponse, requirePayPal } from "@/lib/api";
import { isTerminalBatchStatus } from "@/lib/commerce/payout-status";
import { syncPayoutBatch } from "@/lib/commerce/payouts";
import { prisma } from "@/lib/db";
import { getCurrentCreator } from "@/lib/session";

/** Polled by the earnings page after "Pay me now" until the batch is final. */
export async function POST(_req: Request, ctx: RouteContext<"/api/payouts/[batchId]/sync">) {
  const unavailable = requirePayPal();
  if (unavailable) return unavailable;
  try {
    const creator = await getCurrentCreator();
    if (!creator) return Response.json({ error: "Not signed in" }, { status: 401 });
    const { batchId } = await ctx.params;
    const owns = await prisma.commission.findFirst({ where: { payoutBatchId: batchId, creatorId: creator.id } });
    if (!owns) return Response.json({ error: "Payout not found" }, { status: 404 });
    const { status } = await syncPayoutBatch(batchId);
    return Response.json({ status, final: isTerminalBatchStatus(status) });
  } catch (err) {
    return errorResponse(err);
  }
}
