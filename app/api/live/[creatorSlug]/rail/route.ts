import { prisma } from "@/lib/db";
import { getRail, railVersion } from "@/lib/rail";
import { onRailChanged } from "@/lib/realtime/bus";

const POLL_MS = 3000; // fallback for changes made by another process
const HEARTBEAT_MS = 15000; // keeps proxies from closing idle connections

/**
 * Server-Sent Events: pushes the product rail to viewers. Sends the full rail on
 * connect and whenever it changes (instant in-process signal, plus a cheap version
 * poll). The rail is small, so full snapshots keep the client trivial.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/live/[creatorSlug]/rail">) {
  const { creatorSlug } = await ctx.params;
  const url = new URL(req.url);
  const creator = await prisma.creator.findUnique({ where: { slug: creatorSlug } });
  if (!creator) return new Response("Not found", { status: 404 });
  // The page passes the stream it rendered so viewer and rail agree.
  const streamId = url.searchParams.get("stream");
  const stream = streamId ? await prisma.stream.findFirst({ where: { id: streamId, creatorId: creator.id } }) : null;
  if (!stream) return new Response("Stream not found", { status: 404 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const body = new ReadableStream({
    async start(controller) {
      let lastVersion = "";
      let sending = false;
      let closed = false;

      const send = async (force = false) => {
        if (closed || sending) return;
        sending = true;
        try {
          const version = await railVersion(stream.id);
          if (force || version !== lastVersion) {
            const rail = await getRail(stream.id);
            lastVersion = rail.version;
            controller.enqueue(encoder.encode(`event: rail\ndata: ${JSON.stringify(rail)}\n\n`));
          }
        } catch (err) {
          console.warn("[rail sse]", err instanceof Error ? err.message : err);
        } finally {
          sending = false;
        }
      };

      const off = onRailChanged(stream.id, () => void send());
      const poll = setInterval(() => void send(), POLL_MS);
      const beat = setInterval(() => !closed && controller.enqueue(encoder.encode(`: ping\n\n`)), HEARTBEAT_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        off();
        clearInterval(poll);
        clearInterval(beat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", cleanup);
      await send(true);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
