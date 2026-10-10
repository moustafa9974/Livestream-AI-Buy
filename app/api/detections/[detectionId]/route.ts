import { after } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { audit } from "@/lib/commerce/db";
import { prisma } from "@/lib/db";
import { matchDetection } from "@/lib/matching/match";
import { emitRailChanged } from "@/lib/realtime/bus";
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
    // The old embedding describes the old label; drop it so matching re-embeds the correction.
    if (body.label) await prisma.$executeRaw`UPDATE "Detection" SET embedding = NULL WHERE id = ${detectionId}`;
    await audit(prisma, {
      entityType: "Detection",
      entityId: detectionId,
      type: body.state ? `detection.${body.state}` : "detection.corrected",
      source: "creator",
      payload: { label: updated.label },
    });
    // A corrected label or a newly shown item needs (re)matching; hides just refresh the rail.
    if (body.label || (body.state && body.state !== "hidden")) after(() => matchDetection(detectionId).catch(() => {}));
    else emitRailChanged(d.streamId);
    return Response.json({ id: updated.id, state: updated.state, label: updated.label });
  } catch (err) {
    return errorResponse(err);
  }
}
