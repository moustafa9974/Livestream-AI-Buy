import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { answerOffer, pendingOffers } from "@/lib/realtime/webrtc";
import { getOwnedStream } from "@/lib/studio";

const Answer = z.object({
  sessionId: z.string().min(1),
  // null = decline (the studio is at its viewer limit).
  sdp: z.string().min(10).max(20_000).nullable(),
});

/** The creator's studio polls for viewers waiting to connect. */
export async function GET(_req: Request, ctx: RouteContext<"/api/streams/[streamId]/webrtc">) {
  const { streamId } = await ctx.params;
  const stream = await getOwnedStream(streamId);
  if (!stream) return Response.json({ error: "Stream not found" }, { status: 404 });
  return Response.json({ offers: stream.status === "live" ? pendingOffers(streamId) : [] }, { headers: { "Cache-Control": "no-store" } });
}

/** The creator's studio answers (or declines) one viewer. */
export async function POST(req: Request, ctx: RouteContext<"/api/streams/[streamId]/webrtc">) {
  try {
    const { streamId } = await ctx.params;
    const stream = await getOwnedStream(streamId);
    if (!stream) return Response.json({ error: "Stream not found" }, { status: 404 });
    const body = Answer.parse(await req.json());
    const ok = answerOffer(streamId, body.sessionId, body.sdp);
    return Response.json({ ok }, { status: ok ? 200 : 410 });
  } catch (err) {
    return errorResponse(err);
  }
}
