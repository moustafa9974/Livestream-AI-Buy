import { prisma } from "@/lib/db";

/**
 * Is the creator live right now? A viewer on a replay polls this so that when the
 * creator goes live, the page can offer to switch to the live stream.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/live/[creatorSlug]/now">) {
  const { creatorSlug } = await ctx.params;
  const creator = await prisma.creator.findUnique({ where: { slug: creatorSlug }, select: { id: true } });
  const live = creator
    ? await prisma.stream.findFirst({ where: { creatorId: creator.id, status: "live" }, orderBy: { startedAt: "desc" }, select: { id: true } })
    : null;
  return Response.json({ liveStreamId: live?.id ?? null }, { headers: { "Cache-Control": "no-store" } });
}
