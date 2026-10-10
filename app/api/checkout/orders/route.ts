import { z } from "zod";
import { errorResponse, requirePayPal } from "@/lib/api";
import { MAX_QUANTITY, startCheckout } from "@/lib/commerce/checkout";
import { getOrCreateViewerSession } from "@/lib/session";

// The browser sends only WHAT to buy and WHERE it was seen. Price, total and
// currency are looked up server-side.
const Body = z.object({
  partnerProductId: z.string().min(1),
  quantity: z.number().int().min(1).max(MAX_QUANTITY).default(1),
  paymentMethod: z.enum(["paypal", "card"]).default("paypal"),
  attributionId: z.string().min(1).optional(),
  streamId: z.string().min(1).optional(),
  detectionId: z.string().min(1).optional(),
  tsSec: z.number().nonnegative().default(0),
});

export async function POST(req: Request) {
  const unavailable = requirePayPal();
  if (unavailable) return unavailable;
  try {
    const body = Body.parse(await req.json());
    const viewer = await getOrCreateViewerSession();
    const { orderId, paypalOrderId } = await startCheckout({
      partnerProductId: body.partnerProductId,
      quantity: body.quantity,
      paymentMethod: body.paymentMethod,
      viewerSessionId: viewer.id,
      attributionId: body.attributionId,
      attribution: !body.attributionId && body.streamId
        ? { streamId: body.streamId, detectionId: body.detectionId, tsSec: body.tsSec }
        : undefined,
    });
    // `orderId` key is what the JS SDK v6 session.start() expects.
    return Response.json({ orderId: paypalOrderId, seenOrderId: orderId });
  } catch (err) {
    return errorResponse(err);
  }
}
