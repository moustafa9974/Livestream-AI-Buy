import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { consume } from "@/lib/budget";
import { audit } from "@/lib/commerce/db";
import { prisma } from "@/lib/db";
import { unauthorized, watcherAuthorized } from "@/lib/watcher-auth";

const Body = z.discriminatedUnion("event", [
  z.object({ event: z.literal("started"), streamId: z.string(), kernelSessionId: z.string().max(200), liveViewUrl: z.string().url().max(2000).nullable() }),
  z.object({ event: z.literal("minute"), kernelSessionId: z.string() }),
  z.object({ event: z.literal("stopped"), kernelSessionId: z.string(), reason: z.string().max(60) }),
]);

/**
 * The agent reports its KERNEL browser lifecycle. Seen keeps the caps: a new session
 * spends "kernel_sessions", each minute spends "kernel_minutes". `{ stop: true }`
 * tells the agent to shut the browser down right away.
 */
export async function POST(req: Request) {
  if (!watcherAuthorized(req)) return unauthorized();
  try {
    const body = Body.parse(await req.json());
    if (body.event === "started") {
      const stream = await prisma.stream.findUnique({ where: { id: body.streamId } });
      if (!stream || stream.status !== "live") return Response.json({ stop: true, reason: "stream_not_live" });
      if (!(await consume("kernel_sessions")).allowed) return Response.json({ stop: true, reason: "daily_session_cap" });
      await prisma.kernelSession.create({
        data: { streamId: stream.id, kernelSessionId: body.kernelSessionId, liveViewUrl: body.liveViewUrl, status: "running" },
      });
      await audit(prisma, { entityType: "Stream", entityId: stream.id, type: "kernel.started", source: "kernel", payload: { runtime: "astropods" } });
      return Response.json({ stop: false });
    }

    const row = await prisma.kernelSession.findUnique({ where: { kernelSessionId: body.kernelSessionId } });
    if (!row) return Response.json({ stop: true, reason: "unknown_session" });
    if (body.event === "minute") {
      if (row.status !== "running") return Response.json({ stop: true, reason: row.stopReason ?? "stopped" });
      if (!(await consume("kernel_minutes")).allowed) {
        await prisma.kernelSession.update({ where: { id: row.id }, data: { status: "stopped", stopReason: "daily_minute_cap", endedAt: new Date() } });
        return Response.json({ stop: true, reason: "daily_minute_cap" });
      }
      return Response.json({ stop: false });
    }
    await prisma.kernelSession.update({
      where: { id: row.id },
      data: { status: body.reason === "too_many_failures" ? "failed" : "stopped", stopReason: body.reason, endedAt: new Date() },
    });
    return Response.json({ stop: true });
  } catch (err) {
    return errorResponse(err);
  }
}
