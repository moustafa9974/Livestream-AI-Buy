import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { featureStatus } from "@/lib/flags";
import { createOffer, sessionStatus } from "@/lib/realtime/webrtc";

// A real offer SDP is a few KB; this rejects junk without limiting real browsers.
const MAX_SDP = 20_000;

const Offer = z.object({ streamId: z.string().min(1), sdp: z.string().min(10).max(MAX_SDP) });

async function liveStream(creatorSlug: string, streamId: string) {
  const creator = await prisma.creator.findUnique({ where: { slug: creatorSlug } });
  if (!creator) return null;
  return prisma.stream.findFirst({ where: { id: streamId, creatorId: creator.id, status: "live" } });
}

/** Viewer asks to watch: posts a WebRTC offer for the creator's studio to answer. */
export async function POST(req: Request, ctx: RouteContext<"/api/live/[creatorSlug]/webrtc">) {
  const f = featureStatus("liveVideo");
  if (!f.enabled) return Response.json({ error: "Live video is unavailable", reason: f.reason }, { status: 503 });
  try {
    const { creatorSlug } = await ctx.params;
    const body = Offer.parse(await req.json());
    if (!(await liveStream(creatorSlug, body.streamId))) return Response.json({ error: "Not live" }, { status: 404 });
    const r = createOffer(body.streamId, body.sdp);
    if (!r.ok) return Response.json({ error: "Too many viewers connecting, try again shortly" }, { status: 429 });
    return Response.json({ sessionId: r.id });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Viewer polls for the creator's answer. */
export async function GET(req: Request, ctx: RouteContext<"/api/live/[creatorSlug]/webrtc">) {
  const { creatorSlug } = await ctx.params;
  const url = new URL(req.url);
  const streamId = url.searchParams.get("stream") ?? "";
  const sessionId = url.searchParams.get("session") ?? "";
  const creator = await prisma.creator.findUnique({ where: { slug: creatorSlug }, select: { id: true } });
  if (!creator || !streamId || !sessionId) return Response.json({ status: "expired" });
  return Response.json(sessionStatus(streamId, sessionId), { headers: { "Cache-Control": "no-store" } });
}
