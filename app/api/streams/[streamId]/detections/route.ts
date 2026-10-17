import { getOwnedStream } from "@/lib/studio";
import { listDetections } from "@/lib/vision/process-frame";

/** Studio polls this while a server-side source (KERNEL) is producing frames. */
export async function GET(_req: Request, ctx: RouteContext<"/api/streams/[streamId]/detections">) {
  const { streamId } = await ctx.params;
  const stream = await getOwnedStream(streamId);
  if (!stream) return Response.json({ error: "Stream not found" }, { status: 404 });
  const detections = await listDetections(streamId);
  // "In frame" = seen in the most recent analysed frame.
  const latest = Math.max(-1, ...detections.map((d) => d.lastSeenSec));
  return Response.json({ status: stream.status, detections: detections.map((d) => ({ ...d, inFrame: d.lastSeenSec === latest })) });
}
