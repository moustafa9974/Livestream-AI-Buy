/**
 * Seen stream-watcher agent (runs on Astropods; SPEC §6.2).
 *
 * Loop: ask Seen which creator streams to watch (get_pending_frames) → for each, open
 * the creator's own stream page in a KERNEL cloud browser → screenshot the video player
 * every few seconds → POST it to Seen, which runs analyze_frame → upsert_detection →
 * match_products → publish_rail_update in its normal pipeline.
 *
 * Seen owns every rule that matters (who may be watched, caps, kill switch); this agent
 * only follows instructions and stops the moment Seen says so. With no KERNEL key
 * (LOCAL_BROWSER=1) it uses a local Chromium instead, for testing without credits.
 */
import { createServer } from "node:http";
import Kernel from "@onkernel/sdk";
import { chromium, type Browser, type Page } from "playwright-core";

const SEEN = (process.env.SEEN_API_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.SEEN_WATCHER_TOKEN ?? "";
const KERNEL_KEY = process.env.KERNEL_API_KEY ?? "";
const LOCAL = process.env.LOCAL_BROWSER === "1";
const POLL_MS = Number(process.env.POLL_SECONDS ?? 5) * 1000;
const PORT = Number(process.env.PORT ?? 8080);

if (!SEEN || !TOKEN) throw new Error("SEEN_API_URL and SEEN_WATCHER_TOKEN are required");
if (!LOCAL && !KERNEL_KEY) throw new Error("KERNEL_API_KEY is required (or LOCAL_BROWSER=1 for local testing)");

const kernel = KERNEL_KEY ? new Kernel({ apiKey: KERNEL_KEY }) : null;
const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

interface Assignment {
  streamId: string;
  url: string;
  frameIntervalSec: number;
}

interface Watch {
  streamId: string;
  sessionId: string;
  browser: Browser;
  page: Page;
  startedAt: number;
  minutesReported: number;
  failures: number;
  timer: NodeJS.Timeout | null;
  stopping: boolean;
}

const watches = new Map<string, Watch>();
let maxSessionMinutes = 10;

async function seen<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${SEEN}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (res.status === 401) throw new Error("Seen rejected the watcher token");
  return data;
}

/** Tool: get_pending_frames. Which streams Seen wants watched right now. */
async function getAssignments(): Promise<Assignment[]> {
  const d = await seen<{ assignments?: Assignment[]; limits?: { maxSessionMinutes?: number } }>("/api/watcher/assignments");
  if (d.limits?.maxSessionMinutes) maxSessionMinutes = d.limits.maxSessionMinutes;
  return d.assignments ?? [];
}

async function openBrowser(url: string): Promise<{ sessionId: string; liveViewUrl: string | null; browser: Browser }> {
  if (kernel) {
    const created = await kernel.browsers.create({
      start_url: url,
      headless: false, // live view needs a headful browser
      stealth: true,
      viewport: { width: 1280, height: 720 },
      timeout_seconds: maxSessionMinutes * 60 + 60, // KERNEL deletes it even if we crash
    });
    const browser = await chromium.connectOverCDP(created.cdp_ws_url, { timeout: 30_000 });
    return { sessionId: created.session_id, liveViewUrl: created.browser_live_view_url ?? null, browser };
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url, { timeout: 60_000 });
  return { sessionId: `local-${Date.now()}`, liveViewUrl: null, browser };
}

async function start(a: Assignment) {
  log("starting", { streamId: a.streamId });
  const { sessionId, liveViewUrl, browser } = await openBrowser(a.url);
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error("no page in browser");
  const w: Watch = { streamId: a.streamId, sessionId, browser, page, startedAt: Date.now(), minutesReported: 0, failures: 0, timer: null, stopping: false };
  watches.set(a.streamId, w);
  const ack = await seen<{ stop?: boolean; reason?: string }>("/api/watcher/session", {
    method: "POST",
    body: { event: "started", streamId: a.streamId, kernelSessionId: sessionId, liveViewUrl },
  });
  if (ack.stop) return stop(w, ack.reason ?? "refused");
  schedule(w, 2000);
}

function schedule(w: Watch, ms: number) {
  if (!w.stopping) w.timer = setTimeout(() => void capture(w), ms);
}

/** Screenshot the biggest visible <video> (or the whole viewport) and send it to Seen. */
async function capture(w: Watch) {
  try {
    const elapsedMin = (Date.now() - w.startedAt) / 60_000;
    if (elapsedMin >= maxSessionMinutes) return void (await stop(w, "session_minute_cap"));
    if (w.minutesReported < Math.floor(elapsedMin)) {
      w.minutesReported++;
      const m = await seen<{ stop?: boolean; reason?: string }>("/api/watcher/session", {
        method: "POST",
        body: { event: "minute", kernelSessionId: w.sessionId },
      });
      if (m.stop) return void (await stop(w, m.reason ?? "seen_stop"));
    }

    const box = await w.page
      .evaluate(() => {
        const r = [...document.querySelectorAll("video")]
          .map((v) => v.getBoundingClientRect())
          .filter((b) => b.width > 160 && b.height > 90)
          .sort((a, b) => b.width * b.height - a.width * a.height)[0];
        return r ? { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height } : null;
      })
      .catch(() => null);
    const jpeg = await w.page.screenshot({ type: "jpeg", quality: 70, ...(box ? { clip: box } : {}), timeout: 15_000 });

    const res = await seen<{ stop?: boolean; reason?: string; nextIntervalSec?: number | null; itemsSeen?: number; note?: string | null }>(
      "/api/watcher/frames",
      { method: "POST", body: { streamId: w.streamId, kernelSessionId: w.sessionId, tsSec: Math.round((Date.now() - w.startedAt) / 100) / 10, image: jpeg.toString("base64") } },
    );
    if (res.stop) return void (await stop(w, res.reason ?? "seen_stop"));
    log("frame", { streamId: w.streamId, items: res.itemsSeen, note: res.note ?? undefined });
    w.failures = 0;
    schedule(w, (res.nextIntervalSec ?? 8) * 1000);
  } catch (err) {
    w.failures++;
    log("frame_failed", { streamId: w.streamId, error: err instanceof Error ? err.message : String(err) });
    if (w.failures >= 5) return void (await stop(w, "too_many_failures"));
    schedule(w, 5000);
  }
}

async function stop(w: Watch, reason: string) {
  if (w.stopping) return;
  w.stopping = true;
  if (w.timer) clearTimeout(w.timer);
  watches.delete(w.streamId);
  await w.browser.close().catch(() => {});
  if (kernel) await kernel.browsers.deleteByID(w.sessionId).catch(() => kernel.browsers.deleteByID(w.sessionId)).catch(() => {});
  await seen("/api/watcher/session", { method: "POST", body: { event: "stopped", kernelSessionId: w.sessionId, reason } }).catch(() => {});
  log("stopped", { streamId: w.streamId, reason });
}

/** Reconcile: start newly assigned streams, stop ones Seen no longer lists. */
async function poll() {
  try {
    const assignments = await getAssignments();
    const wanted = new Set(assignments.map((a) => a.streamId));
    for (const w of [...watches.values()]) if (!wanted.has(w.streamId)) await stop(w, "unassigned");
    for (const a of assignments) {
      if (!watches.has(a.streamId)) await start(a).catch((err) => log("start_failed", { streamId: a.streamId, error: err instanceof Error ? err.message : String(err) }));
    }
  } catch (err) {
    log("poll_failed", { error: err instanceof Error ? err.message : String(err) });
  } finally {
    setTimeout(() => void poll(), POLL_MS);
  }
}

// Health endpoint for the Astropods healthcheck.
createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, watching: watches.size }));
  } else {
    res.writeHead(404).end();
  }
}).listen(PORT, () => log("watcher up", { seen: SEEN, mode: kernel ? "kernel" : "local-browser", port: PORT }));

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    for (const w of [...watches.values()]) await stop(w, "agent_shutdown");
    process.exit(0);
  });
}

void poll();
