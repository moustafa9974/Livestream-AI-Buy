import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { getOwnedStream } from "@/lib/studio";
import { isDHash } from "@/lib/vision/dhash";
import { FrameError, processFrame } from "@/lib/vision/process-frame";

// ~768px JPEG at q0.7 is ~60–150 KB; base64 adds a third. 600 KB leaves headroom.
const MAX_IMAGE_B64 = 600_000;

const Body = z.object({
  tsSec: z.number().nonnegative(),
  dHash: z.string().refine(isDHash, "dHash must be 16 hex chars"),
  image: z.string().max(MAX_IMAGE_B64).regex(/^[A-Za-z0-9+/=]+$/, "base64 JPEG only").optional(),
  transcript: z.string().max(1000).optional(),
});

/** Creator's browser posts sampled frames here while live. */
export async function POST(req: Request, ctx: RouteContext<"/api/streams/[streamId]/frames">) {
  try {
    const { streamId } = await ctx.params;
    const stream = await getOwnedStream(streamId);
    if (!stream) return Response.json({ error: "Stream not found" }, { status: 404 });
    const body = Body.parse(await req.json());
    const outcome = await processFrame({
      streamId,
      tsSec: body.tsSec,
      dHash: body.dHash,
      imageJpegBase64: body.image,
      transcript: body.transcript,
    });
    return Response.json(outcome);
  } catch (err) {
    if (err instanceof FrameError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.code === "NOT_FOUND" ? 404 : 409 });
    }
    return errorResponse(err);
  }
}
