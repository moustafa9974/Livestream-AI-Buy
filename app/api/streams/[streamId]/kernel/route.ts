import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { audit } from "@/lib/commerce/db";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { featureStatus } from "@/lib/flags";
import { isPublicHttpsUrl, kernelStatus, KernelUnavailable, startKernelWatch, stopKernelForStream } from "@/lib/kernel/watcher";
import { getOwnedStream } from "@/lib/studio";

const Body = z.object({
  url: z.string().url().max(500),
  // KERNEL only watches the creator's OWN stream page (SPEC §3.4); consent is stored.
  consentOwnContent: z.literal(true),
});

export async function GET(_req: Request, ctx: RouteContext<"/api/streams/[streamId]/kernel">) {
  const { streamId } = await ctx.params;
  const stream = await getOwnedStream(streamId);
  if (!stream) return Response.json({ error: "Stream not found" }, { status: 404 });
  const s = featureStatus("kernel");
  return Response.json({ enabled: s.enabled, reason: s.reason ?? null, session: await kernelStatus(streamId) });
}

/** Start watching the creator's own stream URL in a KERNEL cloud browser (also goes live). */
export async function POST(req: Request, ctx: RouteContext<"/api/streams/[streamId]/kernel">) {
  try {
    const { streamId } = await ctx.params;
    const stream = await getOwnedStream(streamId);
    if (!stream) return Response.json({ error: "Stream not found" }, { status: 404 });
    const s = featureStatus("kernel");
    if (!s.enabled) return Response.json({ error: "KERNEL is unavailable", reason: s.reason }, { status: 503 });
    const body = Body.parse(await req.json());
    if (!isPublicHttpsUrl(body.url)) return Response.json({ error: "Use the public https:// URL of your own stream page" }, { status: 400 });

    const now = new Date();
    await prisma.stream.update({
      where: { id: streamId },
      data: { status: "live", sourceType: "kernel_url", sourceUrl: body.url, consentOwnContent: true, consentAt: now, startedAt: now, endedAt: null },
    });
    // Astropods runtime: the hosted agent picks the stream up from /api/watcher/assignments
    // and reports its live-view link back; the studio polls GET for it.
    if (getEnv().WATCHER_RUNTIME === "astropods") {
      await audit(prisma, { entityType: "Stream", entityId: streamId, type: "kernel.queued", source: "creator", payload: { runtime: "astropods" } });
      return Response.json({ queued: true, liveViewUrl: null });
    }
    const started = await startKernelWatch(streamId, body.url);
    await audit(prisma, { entityType: "Stream", entityId: streamId, type: "kernel.started", source: "kernel", payload: { sessionId: started.sessionId } });
    return Response.json(started);
  } catch (err) {
    if (err instanceof KernelUnavailable) return Response.json({ error: err.message }, { status: 409 });
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/streams/[streamId]/kernel">) {
  try {
    const { streamId } = await ctx.params;
    const stream = await getOwnedStream(streamId);
    if (!stream) return Response.json({ error: "Stream not found" }, { status: 404 });
    const stopped = await stopKernelForStream(streamId, "creator_stopped");
    if (stopped) await audit(prisma, { entityType: "Stream", entityId: streamId, type: "kernel.stopped", source: "creator" });
    return Response.json({ stopped });
  } catch (err) {
    return errorResponse(err);
  }
}
