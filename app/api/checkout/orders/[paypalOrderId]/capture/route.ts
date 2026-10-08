import { errorResponse, requirePayPal } from "@/lib/api";
import { captureCheckout } from "@/lib/commerce/checkout";
import { prisma } from "@/lib/db";
import { getOrCreateViewerSession } from "@/lib/session";

export async function POST(_req: Request, ctx: RouteContext<"/api/checkout/orders/[paypalOrderId]/capture">) {
  const unavailable = requirePayPal();
  if (unavailable) return unavailable;
  try {
    const { paypalOrderId } = await ctx.params;
    // Only the viewer who created the order may trigger its capture from the browser.
    const viewer = await getOrCreateViewerSession();
    const order = await prisma.order.findUnique({ where: { paypalOrderId } });
    if (!order || order.viewerSessionId !== viewer.id) {
      return Response.json({ error: "Order not found" }, { status: 404 });
    }
    return Response.json(await captureCheckout(paypalOrderId, "viewer"));
  } catch (err) {
    return errorResponse(err);
  }
}
