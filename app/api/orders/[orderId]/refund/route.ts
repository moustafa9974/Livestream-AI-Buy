import { z } from "zod";
import { errorResponse, requirePayPal } from "@/lib/api";
import { refundOrder } from "@/lib/commerce/refunds";
import { prisma } from "@/lib/db";
import { getCurrentCreator } from "@/lib/session";

const Body = z.object({ amountMinor: z.number().int().positive().optional() });

/** Creator-initiated refund (demo: the platform acts for the partner store). */
export async function POST(req: Request, ctx: RouteContext<"/api/orders/[orderId]/refund">) {
  const unavailable = requirePayPal();
  if (unavailable) return unavailable;
  try {
    const creator = await getCurrentCreator();
    if (!creator) return Response.json({ error: "Not signed in" }, { status: 401 });
    const { orderId } = await ctx.params;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { attribution: { include: { stream: true } } },
    });
    // Scope by the signed-in creator: you can only refund sales from your own streams.
    if (!order || order.attribution?.stream.creatorId !== creator.id) {
      return Response.json({ error: "Order not found" }, { status: 404 });
    }
    const { amountMinor } = Body.parse(await req.json().catch(() => ({})));
    const res = await refundOrder(orderId, amountMinor, "creator");
    return Response.json({ applied: res.applied, status: res.order.status });
  } catch (err) {
    return errorResponse(err);
  }
}
