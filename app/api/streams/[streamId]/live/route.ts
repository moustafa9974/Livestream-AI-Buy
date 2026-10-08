import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { audit } from "@/lib/commerce/db";
import { prisma } from "@/lib/db";
import { getOwnedStream } from "@/lib/studio";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    sourceType: z.enum(["upload", "screen", "youtube", "kernel_url"]),
    // The creator must confirm the content is their own (SPEC §3, stored with a timestamp).
    consentOwnContent: z.literal(true),
  }),
  z.object({ action: z.literal("stop") }),
]);

/** Go live / end stream. An ended stream can go live again; `npm run demo:reset` restores the demo. */
export async function POST(req: Request, ctx: RouteContext<"/api/streams/[streamId]/live">) {
  try {
    const { streamId } = await ctx.params;
    const stream = await getOwnedStream(streamId);
    if (!stream) return Response.json({ error: "Stream not found" }, { status: 404 });
    const body = Body.parse(await req.json());

    const now = new Date();
    const updated =
      body.action === "start"
        ? await prisma.stream.update({
            where: { id: streamId },
            data: { status: "live", sourceType: body.sourceType, consentOwnContent: true, consentAt: now, startedAt: now, endedAt: null },
          })
        : await prisma.stream.update({ where: { id: streamId }, data: { status: "ended", endedAt: now } });

    await audit(prisma, {
      entityType: "Stream",
      entityId: streamId,
      type: body.action === "start" ? "stream.live" : "stream.ended",
      source: "creator",
      payload: body.action === "start" ? { sourceType: body.sourceType } : {},
    });
    return Response.json({ status: updated.status });
  } catch (err) {
    return errorResponse(err);
  }
}
