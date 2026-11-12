import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getOrCreateViewerSession } from "@/lib/session";
import { allowShopperMessage } from "@/lib/shopper/limit";
import { runShopper } from "@/lib/shopper/run";

const Body = z.object({
  streamId: z.string().min(1),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(1000) }))
    .min(1)
    .max(20),
});

/** Viewer shopping assistant. Tools are scoped server-side to this creator's stream. */
export async function POST(req: Request, ctx: RouteContext<"/api/live/[creatorSlug]/assistant">) {
  try {
    const { creatorSlug } = await ctx.params;
    const body = Body.parse(await req.json());
    const creator = await prisma.creator.findUnique({ where: { slug: creatorSlug } });
    const stream = creator
      ? await prisma.stream.findFirst({ where: { id: body.streamId, creatorId: creator.id, scheduledFor: null } })
      : null;
    if (!creator || !stream) return Response.json({ error: "Stream not found" }, { status: 404 });

    const viewer = await getOrCreateViewerSession();
    if (!allowShopperMessage(viewer.id)) {
      return Response.json({ error: "You're sending messages quickly. Try again in a few minutes." }, { status: 429 });
    }
    return Response.json(await runShopper({ streamId: stream.id, creatorName: creator.displayName }, body.messages));
  } catch (err) {
    return errorResponse(err);
  }
}
