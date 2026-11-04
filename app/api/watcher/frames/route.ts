import { after } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { matchNewlyVisible } from "@/lib/matching/match";
import { putSnapshot } from "@/lib/realtime/snapshot";
import { FrameError, processFrame } from "@/lib/vision/process-frame";
import { dHashFromJpeg } from "@/lib/vision/server-hash";
import { unauthorized, watcherAuthorized } from "@/lib/watcher-auth";

const Body = z.object({
  streamId: z.string().min(1),
  kernelSessionId: z.string().min(1),
  tsSec: z.number().nonnegative(),
  image: z.string().min(100).max(2_000_000).regex(/^[A-Za-z0-9+/=]+$/, "base64 JPEG only"),
});

/**
 * The agent posts a screenshot of the creator's player (SPEC §6.2: analyze_frame →
 * upsert_detection → match_products → publish_rail_update all happen here, in the
 * same pipeline the browser sampler uses). The fingerprint is computed server-side.
 */
export async function POST(req: Request) {
  if (!watcherAuthorized(req)) return unauthorized();
  try {
    const body = Body.parse(await req.json());
    const session = await prisma.kernelSession.findUnique({ where: { kernelSessionId: body.kernelSessionId } });
    if (!session || session.streamId !== body.streamId || session.status !== "running") {
      return Response.json({ stop: true, reason: "session_not_running" });
    }
    // KERNEL streams have no browser to send WebRTC video, so viewers see these frames.
    putSnapshot(body.streamId, body.image);
    const jpeg = Buffer.from(body.image, "base64");
    const outcome = await processFrame({ streamId: body.streamId, tsSec: body.tsSec, dHash: dHashFromJpeg(jpeg), imageJpegBase64: body.image });
    await prisma.kernelSession.update({ where: { id: session.id }, data: { framesSent: { increment: 1 } } });
    after(() => matchNewlyVisible(body.streamId, outcome.newlyVisibleIds));
    return Response.json({
      stop: false,
      nextIntervalSec: outcome.nextIntervalSec,
      mode: outcome.mode,
      itemsSeen: outcome.itemsSeen,
      note: outcome.note ?? null,
    });
  } catch (err) {
    if (err instanceof FrameError) return Response.json({ stop: true, reason: err.code }, { status: 409 });
    return errorResponse(err);
  }
}
