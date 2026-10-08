import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { audit } from "@/lib/commerce/db";
import { prisma } from "@/lib/db";
import { getOwnedDetection } from "@/lib/studio";

const Body = z
  .object({
    state: z.enum(["visible", "pinned", "hidden"]).optional(),
    // "Correct": the creator renames what the AI saw (e.g. "mic" → "wireless clip-on mic").
    label: z.string().trim().min(2).max(80).optional(),
  })
  .refine((b) => b.state || b.label, "Nothing to change");

/** Creator pins, hides or corrects a detection. Hidden ones never show again for this stream. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/detections/[detectionId]">) {
  try {
    const { detectionId } = await ctx.params;
    const d = await getOwnedDetection(detectionId);
    if (!d) return Response.json({ error: "Detection not found" }, { status: 404 });
    const body = Body.parse(await req.json());

    const updated = await prisma.detection.update({
      where: { id: detectionId },
      data: { ...(body.state ? { state: body.state } : {}), ...(body.label ? { label: body.label.toLowerCase() } : {}) },
    });
    await audit(prisma, {
      entityType: "Detection",
      entityId: detectionId,
      type: body.state ? `detection.${body.state}` : "detection.corrected",
      source: "creator",
      payload: { label: updated.label },
    });
    return Response.json({ id: updated.id, state: updated.state, label: updated.label });
  } catch (err) {
    return errorResponse(err);
  }
}
