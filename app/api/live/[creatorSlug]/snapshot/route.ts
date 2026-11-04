import { prisma } from "@/lib/db";
import { getSnapshot } from "@/lib/realtime/snapshot";

/**
 * Latest frame of a live stream as a JPEG: the fallback picture for viewers whose
 * browser can't open a direct WebRTC connection. Live streams only.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/live/[creatorSlug]/snapshot">) {
  const { creatorSlug } = await ctx.params;
  const streamId = new URL(req.url).searchParams.get("stream") ?? "";
  const creator = await prisma.creator.findUnique({ where: { slug: creatorSlug }, select: { id: true } });
  const stream = creator && streamId
    ? await prisma.stream.findFirst({ where: { id: streamId, creatorId: creator.id, status: "live" }, select: { id: true } })
    : null;
  const snap = stream ? getSnapshot(stream.id) : null;
  if (!snap) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(snap.jpeg), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
  });
}
