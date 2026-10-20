import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { unauthorized, watcherAuthorized } from "@/lib/watcher-auth";

/**
 * Astropods watcher agent → "which streams should I be watching?" (SPEC §6.2:
 * get_pending_frames). Live streams whose source is the creator's own stream URL and
 * that haven't been killed. Anything the agent is watching that's not listed here,
 * it must stop: that's how stream end and the kill switch reach the agent.
 */
export async function GET(req: Request) {
  if (!watcherAuthorized(req)) return unauthorized();
  const env = getEnv();
  // A session older than the per-session cap (+ grace) whose agent never said goodbye
  // (crash, redeploy) is over: expire it so the stream can be picked up again.
  await prisma.kernelSession.updateMany({
    where: { status: "running", startedAt: { lt: new Date(Date.now() - (env.KERNEL_MAX_SESSION_MINUTES + 2) * 60_000) } },
    data: { status: "stopped", stopReason: "expired", endedAt: new Date() },
  });
  const streams = await prisma.stream.findMany({
    where: { status: "live", sourceType: "kernel_url", sourceUrl: { not: null } },
    include: { kernelSessions: { orderBy: { startedAt: "desc" }, take: 1 } },
  });
  const assignments = streams
    .filter((s) => {
      const last = s.kernelSessions[0];
      // Killed or capped after this stream went live: don't restart it.
      return !(last && last.status !== "running" && s.startedAt && last.startedAt >= s.startedAt);
    })
    .map((s) => ({ streamId: s.id, url: s.sourceUrl!, frameIntervalSec: s.frameIntervalSec }));
  return Response.json({ assignments, limits: { maxSessionMinutes: env.KERNEL_MAX_SESSION_MINUTES } });
}
