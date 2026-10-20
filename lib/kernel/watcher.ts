import Kernel from "@onkernel/sdk";
import { chromium, type Browser, type Page } from "playwright-core";
import { consume, peek } from "../budget";
import { prisma } from "../db";
import { getEnv } from "../env";
import { isEnabled } from "../flags";
import { matchNewlyVisible } from "../matching/match";
import { processFrame } from "../vision/process-frame";
import { dHashFromJpeg } from "../vision/server-hash";

/**
 * KERNEL "watch my stream URL" source (SPEC §3.4, §7): a KERNEL cloud browser opens the
 * creator's own public stream page; we connect over CDP (Playwright), find the video
 * player and screenshot just that region every N seconds into the same frame pipeline.
 *
 * Hard caps protect the hackathon credits:
 *   - KERNEL_MAX_SESSIONS_PER_DAY (budget "kernel_sessions")
 *   - KERNEL_MAX_SESSION_MINUTES per session, plus the daily minute budget
 *   - auto-stop when the stream ends or frames keep failing; kill switch in the demo panel
 * Runs in-process on the web server (no paid worker), one loop per stream.
 */

interface Watch {
  sessionRowId: string;
  kernelSessionId: string;
  streamId: string;
  browser: Browser | null;
  timer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  minutesCharged: number;
  failures: number;
  stopping: boolean;
}

const g = globalThis as unknown as { seenKernelWatches?: Map<string, Watch> };
const watches = (g.seenKernelWatches ??= new Map<string, Watch>());

let client: Kernel | undefined;
function kernel(): Kernel {
  client ??= new Kernel({ apiKey: getEnv().KERNEL_API_KEY });
  return client;
}

export class KernelUnavailable extends Error {}

export function isPublicHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    // The browser runs in KERNEL's cloud, but still refuse obvious internal targets.
    return !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) && u.hostname.includes(".");
  } catch {
    return false;
  }
}

export async function startKernelWatch(streamId: string, url: string): Promise<{ liveViewUrl: string | null; sessionId: string }> {
  const env = getEnv();
  if (!isEnabled("kernel")) throw new KernelUnavailable("KERNEL is not configured");
  if (!isPublicHttpsUrl(url)) throw new KernelUnavailable("Use the public https:// URL of your own stream page");
  if (watches.has(streamId)) throw new KernelUnavailable("A KERNEL browser is already watching this stream");
  if ((await peek("kernel_minutes")).mode === "cache_only") throw new KernelUnavailable("Today's KERNEL minutes are used up");
  if (!(await consume("kernel_sessions")).allowed) throw new KernelUnavailable("Today's KERNEL session limit is reached");

  const created = await kernel().browsers.create({
    start_url: url,
    headless: false, // live view needs a headful browser
    stealth: true,
    viewport: { width: 1280, height: 720 },
    // KERNEL deletes the browser itself after this, even if our process dies.
    timeout_seconds: env.KERNEL_MAX_SESSION_MINUTES * 60 + 60,
  });

  const row = await prisma.kernelSession.create({
    data: { streamId, kernelSessionId: created.session_id, liveViewUrl: created.browser_live_view_url ?? null, status: "running" },
  });
  const watch: Watch = {
    sessionRowId: row.id,
    kernelSessionId: created.session_id,
    streamId,
    browser: null,
    timer: null,
    startedAt: Date.now(),
    minutesCharged: 0,
    failures: 0,
    stopping: false,
  };
  watches.set(streamId, watch);

  try {
    watch.browser = await chromium.connectOverCDP(created.cdp_ws_url, { timeout: 30_000 });
  } catch (err) {
    await stopWatch(watch, "cdp_connect_failed");
    throw new KernelUnavailable(`Couldn't connect to the KERNEL browser: ${err instanceof Error ? err.message : err}`);
  }
  schedule(watch, 3000);
  return { liveViewUrl: row.liveViewUrl, sessionId: created.session_id };
}

function schedule(w: Watch, ms: number) {
  if (!w.stopping) w.timer = setTimeout(() => void tick(w), ms);
}

async function currentPage(w: Watch): Promise<Page | null> {
  const ctx = w.browser?.contexts()[0];
  return ctx?.pages()[0] ?? null;
}

async function tick(w: Watch) {
  const env = getEnv();
  try {
    const stream = await prisma.stream.findUnique({ where: { id: w.streamId } });
    if (!stream || stream.status !== "live") return void (await stopWatch(w, "stream_not_live"));

    const elapsedMin = (Date.now() - w.startedAt) / 60_000;
    if (elapsedMin >= env.KERNEL_MAX_SESSION_MINUTES) return void (await stopWatch(w, "session_minute_cap"));
    // Charge the daily minute budget as each new minute starts.
    while (w.minutesCharged < Math.ceil(elapsedMin)) {
      if (!(await consume("kernel_minutes")).allowed) return void (await stopWatch(w, "daily_minute_cap"));
      w.minutesCharged++;
    }

    const page = await currentPage(w);
    if (!page) throw new Error("no page in KERNEL browser");
    // The biggest visible <video> is the player; fall back to the whole viewport.
    const box = await page
      .evaluate(() => {
        const vids = [...document.querySelectorAll("video")]
          .map((v) => v.getBoundingClientRect())
          .filter((r) => r.width > 160 && r.height > 90)
          .sort((a, b) => b.width * b.height - a.width * a.height);
        const r = vids[0];
        return r ? { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height } : null;
      })
      .catch(() => null);
    const jpeg = await page.screenshot({ type: "jpeg", quality: 70, ...(box ? { clip: box } : {}), timeout: 15_000 });

    const outcome = await processFrame({
      streamId: w.streamId,
      tsSec: Math.round((Date.now() - w.startedAt) / 100) / 10,
      dHash: dHashFromJpeg(jpeg),
      imageJpegBase64: Buffer.from(jpeg).toString("base64"),
    });
    void matchNewlyVisible(w.streamId, outcome.newlyVisibleIds).catch(() => {});
    await prisma.kernelSession.update({ where: { id: w.sessionRowId }, data: { framesSent: { increment: 1 } } });
    w.failures = 0;
    schedule(w, (outcome.nextIntervalSec ?? stream.frameIntervalSec * 2) * 1000);
  } catch (err) {
    w.failures++;
    console.warn("[kernel]", w.kernelSessionId, err instanceof Error ? err.message : err);
    if (w.failures >= 5) return void (await stopWatch(w, "too_many_failures"));
    schedule(w, 5000);
  }
}

async function stopWatch(w: Watch, reason: string, status: "stopped" | "failed" = "stopped") {
  if (w.stopping) return;
  w.stopping = true;
  if (w.timer) clearTimeout(w.timer);
  watches.delete(w.streamId);
  await w.browser?.close().catch(() => {});
  // Deleting the KERNEL browser is what stops usage billing; retry once.
  await kernel()
    .browsers.deleteByID(w.kernelSessionId)
    .catch(() => kernel().browsers.deleteByID(w.kernelSessionId))
    .catch((err) => console.warn("[kernel] delete failed", err instanceof Error ? err.message : err));
  await prisma.kernelSession
    .update({ where: { id: w.sessionRowId }, data: { status: reason === "too_many_failures" ? "failed" : status, stopReason: reason, endedAt: new Date() } })
    .catch(() => {});
}

export async function stopKernelForStream(streamId: string, reason = "creator_stopped"): Promise<boolean> {
  const w = watches.get(streamId);
  if (w) {
    await stopWatch(w, reason);
    return true;
  }
  // Not ours in memory (e.g. server restarted): still make sure KERNEL deletes it.
  const rows = await prisma.kernelSession.findMany({ where: { streamId, status: "running" } });
  for (const r of rows) await killRow(r.id, r.kernelSessionId, reason);
  return rows.length > 0;
}

/** Demo-panel kill switch: stop every running KERNEL browser, in memory and in the DB. */
export async function killAllKernelSessions(): Promise<number> {
  let n = 0;
  for (const w of [...watches.values()]) {
    await stopWatch(w, "kill_switch");
    n++;
  }
  const rows = await prisma.kernelSession.findMany({ where: { status: "running" } });
  for (const r of rows) {
    await killRow(r.id, r.kernelSessionId, "kill_switch");
    n++;
  }
  return n;
}

async function killRow(id: string, kernelSessionId: string, reason: string) {
  // Locally we own the KERNEL browser and delete it; with the Astropods agent, marking the
  // row stopped is the signal (the agent polls and deletes its own browser).
  const env = getEnv();
  if (env.WATCHER_RUNTIME === "local" && env.KERNEL_API_KEY) await kernel().browsers.deleteByID(kernelSessionId).catch(() => {});
  await prisma.kernelSession.update({ where: { id }, data: { status: "stopped", stopReason: reason, endedAt: new Date() } });
}

export async function kernelStatus(streamId: string) {
  const row = await prisma.kernelSession.findFirst({ where: { streamId }, orderBy: { startedAt: "desc" } });
  return row
    ? { running: (getEnv().WATCHER_RUNTIME === "astropods" || watches.has(streamId)) && row.status === "running", liveViewUrl: row.liveViewUrl, framesSent: row.framesSent, status: row.status, stopReason: row.stopReason }
    : null;
}
