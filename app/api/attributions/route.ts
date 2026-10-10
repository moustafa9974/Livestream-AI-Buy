import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { audit } from "@/lib/commerce/db";
import { prisma } from "@/lib/db";
import { getOrCreateViewerSession } from "@/lib/session";

const Body = z.object({
  streamId: z.string().min(1),
  detectionId: z.string().min(1).optional(),
  partnerProductId: z.string().min(1),
  tsSec: z.number().nonnegative(),
});

/**
 * Records a viewer's card click (SPEC §4): which stream, which on-screen item, which
 * moment. The order created from this click links to it, so the commission goes to
 * the right creator for the right moment. Clicks also feed conversion % in earnings.
 */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const viewer = await getOrCreateViewerSession();
    const [stream, product, detection] = await Promise.all([
      prisma.stream.findUnique({ where: { id: body.streamId } }),
      prisma.partnerProduct.findUnique({ where: { id: body.partnerProductId } }),
      body.detectionId ? prisma.detection.findUnique({ where: { id: body.detectionId } }) : null,
    ]);
    if (!stream || !product) return Response.json({ error: "Not found" }, { status: 404 });
    // Ignore a detection that isn't from this stream (or is hidden) rather than trusting it.
    const detectionId = detection && detection.streamId === stream.id && detection.state !== "hidden" ? detection.id : undefined;

    const a = await prisma.attribution.create({
      data: { streamId: stream.id, detectionId, partnerProductId: product.id, viewerSessionId: viewer.id, tsSec: body.tsSec },
    });
    await audit(prisma, { entityType: "Attribution", entityId: a.id, type: "card.clicked", source: "viewer", payload: { streamId: stream.id, tsSec: body.tsSec } });
    return Response.json({ attributionId: a.id });
  } catch (err) {
    return errorResponse(err);
  }
}
