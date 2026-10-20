"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { TickerPanel } from "@/components/studio/ticker-panel";
import { useFrameSampler } from "@/components/studio/use-frame-sampler";
import { Input } from "@/components/ui/input";
import type { DetectionView } from "@/lib/vision/process-frame";

type Source = "upload" | "screen" | "kernel";

interface Props {
  stream: { id: string; title: string; status: string; frameIntervalSec: number; videoAssetUrl: string | null };
  initialDetections: DetectionView[];
  creatorName: string;
  creatorSlug: string;
  kernel: { enabled: boolean; reason: string | null; liveViewUrl: string | null; running: boolean };
  ai: { provider: string; enabled: boolean; reason: string | null; demoCache: boolean };
  tuning: { minChangeDistance: number; maxStaleSec: number };
}

const STATE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  visible: "default",
  pinned: "default",
  candidate: "outline",
  hidden: "secondary",
};

export function LiveStudio({ stream, initialDetections, creatorName, creatorSlug, kernel, ai, tuning }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<Source | null>(kernel.running ? "kernel" : null);
  const [kernelUrl, setKernelUrl] = useState("");
  const [liveView, setLiveView] = useState<string | null>(kernel.running ? kernel.liveViewUrl : null);
  const [kernelBusy, setKernelBusy] = useState(false);
  const [polled, setPolled] = useState<DetectionView[] | null>(null);
  const [ended, setEnded] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [live, setLive] = useState(stream.status === "live");
  // Creator edits apply instantly; the next frame response confirms them from the server.
  const [overrides, setOverrides] = useState<Record<string, DetectionView["state"]>>({});
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const [aspect, setAspect] = useState(16 / 9);
  const liveSince = useRef(0);

  const sampler = useFrameSampler(videoRef, {
    streamId: stream.id,
    active: live && (source === "upload" || source === "screen"),
    getTimestamp: () =>
      source === "screen" ? (Date.now() - liveSince.current) / 1000 : (videoRef.current?.currentTime ?? 0),
    baseIntervalSec: stream.frameIntervalSec,
    minChangeDistance: tuning.minChangeDistance,
    maxStaleSec: tuning.maxStaleSec,
  });

  // KERNEL frames are produced server-side, so poll detections instead of sampling here.
  useEffect(() => {
    if (!live || source !== "kernel") return;
    let stop = false;
    const load = () =>
      fetch(`/api/streams/${stream.id}/detections`)
        .then((r) => r.json())
        .then((d: { detections: DetectionView[] }) => !stop && setPolled(d.detections))
        .catch(() => {});
    void load();
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [live, source, stream.id]);

  // With the Astropods watcher the live-view link arrives once the agent has started its
  // browser, so poll for it.
  useEffect(() => {
    if (source !== "kernel" || liveView) return;
    let stop = false;
    const t = setInterval(() => {
      fetch(`/api/streams/${stream.id}/kernel`)
        .then((r) => r.json())
        .then((d: { session?: { liveViewUrl: string | null } | null }) => !stop && d.session?.liveViewUrl && setLiveView(d.session.liveViewUrl))
        .catch(() => {});
    }, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [source, liveView, stream.id]);

  // Release object URLs / screen tracks when replaced or unmounted.
  useEffect(() => () => {
    if (videoUrl?.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  function pickFile(file: File) {
    stopScreen();
    setVideoUrl(URL.createObjectURL(file));
    setSource("upload");
  }

  function pickDemoVideo() {
    stopScreen();
    setVideoUrl(stream.videoAssetUrl ?? "/demo/demo.mp4");
    setSource("upload");
  }

  async function pickScreen() {
    try {
      const media = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      setVideoUrl(null);
      setSource("screen");
      const v = videoRef.current!;
      v.srcObject = media;
      await v.play();
      media.getVideoTracks()[0].addEventListener("ended", () => setSource(null));
    } catch {
      toast.error("Screen sharing was cancelled or blocked");
    }
  }

  function stopScreen() {
    const v = videoRef.current;
    const media = v?.srcObject as MediaStream | null;
    media?.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
  }

  async function goLive(start: boolean) {
    const res = await fetch(`/api/streams/${stream.id}/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(start ? { action: "start", sourceType: source, consentOwnContent: true } : { action: "stop" }),
    });
    if (!res.ok) return toast.error("Couldn't change stream status");
    liveSince.current = Date.now();
    setLive(start);
    if (!start) {
      setEnded(true);
      setLiveView(null);
      toast.success("Stream ended. Your recap is being written");
    }
    if (start) {
      toast.success("You're live. Seen is watching for products");
      videoRef.current?.play().catch(() => {});
    }
  }

  async function startKernel() {
    setKernelBusy(true);
    try {
      const res = await fetch(`/api/streams/${stream.id}/kernel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: kernelUrl, consentOwnContent: true }),
      });
      const data = (await res.json()) as { liveViewUrl?: string | null; queued?: boolean; error?: string; reason?: string };
      if (!res.ok) throw new Error(data.error ?? data.reason ?? "KERNEL failed");
      stopScreen();
      setVideoUrl(null);
      setSource("kernel");
      setLive(true);
      setLiveView(data.liveViewUrl ?? null);
      toast.success(data.queued ? "Handed to the Astropods watcher. It will open a KERNEL browser shortly" : "A KERNEL cloud browser is watching your stream");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "KERNEL failed");
    } finally {
      setKernelBusy(false);
    }
  }

  async function stopKernel() {
    await fetch(`/api/streams/${stream.id}/kernel`, { method: "DELETE" });
    setLiveView(null);
    setSource(null);
  }

  async function rename(d: DetectionView) {
    const label = window.prompt("What is this product? (e.g. 'wireless clip-on mic')", d.label)?.trim();
    if (!label || label === d.label) return;
    const res = await fetch(`/api/detections/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    if (!res.ok) return toast.error("Rename failed");
    setRenamed((r) => ({ ...r, [d.id]: label.toLowerCase() }));
    toast.success("Corrected. Re-matching products…");
  }

  async function setState(id: string, state: "visible" | "pinned" | "hidden") {
    const res = await fetch(`/api/detections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) return toast.error("Update failed");
    setOverrides((o) => ({ ...o, [id]: state }));
  }

  const last = sampler.last;
  const base = source === "kernel" ? (polled ?? initialDetections) : (last?.detections ?? initialDetections);
  const detections = base.map((d) => ({ ...d, state: overrides[d.id] ?? d.state, label: renamed[d.id] ?? d.label }));
  const boxes = detections.filter((d) => d.inFrame && d.bbox && d.state !== "hidden");
  const shown = detections.filter((d) => d.state !== "candidate");
  const candidates = detections.filter((d) => d.state === "candidate");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{creatorName} · Studio</p>
            <h1 className="text-2xl font-bold tracking-tight">{stream.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/live/${creatorSlug}`} target="_blank" className="text-sm underline-offset-2 hover:underline">
              Viewer page ↗
            </Link>
            {ended && (
              <Link href={`/recap/${stream.id}`} className="text-sm underline-offset-2 hover:underline">
                Recap ↗
              </Link>
            )}
            {live ? <Badge>● Live</Badge> : <Badge variant="outline">Offline</Badge>}
            {last?.mode === "saver" && <Badge variant="secondary">Free-tier saver mode</Badge>}
            {last?.mode === "cache_only" && <Badge variant="secondary">Cache-only mode</Badge>}
          </div>
        </header>

        {!ai.enabled && (
          <p role="status" className="rounded-lg border border-dashed p-3 text-sm">
            AI provider <b>{ai.provider}</b> unavailable ({ai.reason}).{" "}
            {ai.demoCache ? "Cached demo results will still be used." : "Set DEMO_CACHE=true to use cached results."}
          </p>
        )}

        <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: aspect }}>
          <video
            ref={videoRef}
            src={videoUrl ?? undefined}
            className="absolute inset-0 h-full w-full"
            controls={source === "upload"}
            muted
            playsInline
            loop
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth) setAspect(v.videoWidth / v.videoHeight);
            }}
            onError={() => source === "upload" && toast.error("Couldn't load that video")}
          />
          {/* Detection boxes from the latest analysed frame */}
          {boxes.map((d) => (
            <div
              key={d.id}
              className="pointer-events-none absolute rounded-md border-2 border-yellow-300 motion-safe:transition-all"
              style={{ left: `${d.bbox![0] * 100}%`, top: `${d.bbox![1] * 100}%`, width: `${d.bbox![2] * 100}%`, height: `${d.bbox![3] * 100}%` }}
            >
              <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-yellow-300 px-1.5 text-xs font-medium text-black">
                {d.label}
              </span>
            </div>
          ))}
          {!source && (
            <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">
              Pick a source below to start
            </p>
          )}
          {source === "kernel" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/90">
              <p>A KERNEL cloud browser is watching your stream page and sending frames.</p>
              {liveView && (
                <a href={liveView} target="_blank" rel="noopener noreferrer" className="rounded-md bg-white px-3 py-1.5 font-medium text-black">
                  Open KERNEL live view ↗
                </a>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center">
            <input type="file" accept="video/*" className="sr-only" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
            <span className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted">Upload video</span>
          </label>
          <Button variant="outline" onClick={pickDemoVideo}>Use demo video</Button>
          <Button variant="outline" onClick={pickScreen}>Share screen / OBS</Button>
        </div>

        <div className="space-y-2 rounded-xl border p-4">
          <p className="text-sm font-medium">Or watch your own stream URL with a KERNEL cloud browser</p>
          {kernel.enabled ? (
            source === "kernel" ? (
              <Button variant="outline" onClick={stopKernel}>Stop KERNEL browser</Button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Input
                  type="url"
                  value={kernelUrl}
                  onChange={(e) => setKernelUrl(e.target.value)}
                  placeholder="https://www.twitch.tv/yourchannel"
                  aria-label="Your stream URL"
                  className="min-w-60 flex-1"
                />
                <Button onClick={startKernel} disabled={!consent || !kernelUrl.startsWith("https://") || kernelBusy}>
                  {kernelBusy ? "Starting…" : "Watch with KERNEL"}
                </Button>
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground">KERNEL unavailable ({kernel.reason}). Screen sharing and uploads still work.</p>
          )}
          <p className="text-xs text-muted-foreground">Only your own channel. Capped per session and per day to protect credits; stops when the stream ends.</p>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-xl border p-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={live} />
            This is my own content and I have the right to make it shoppable
          </label>
          {live ? (
            <Button variant="destructive" onClick={() => goLive(false)}>End stream</Button>
          ) : (
            <Button onClick={() => goLive(true)} disabled={!consent || !source || source === "kernel"}>Go live</Button>
          )}
        </div>

        {live && last?.note && (
          <p role="alert" className="rounded-lg border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {last.note}
          </p>
        )}
        {live && source === "screen" && (
          <p className="text-xs text-muted-foreground">
            Tip: share the window or tab with your products in it. Sampling keeps running while you switch tabs.
          </p>
        )}
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Frames sent {sampler.sent} · skipped (unchanged) {sampler.skipped}
          {last && <> · last: {last.source}{last.provider ? ` (${last.provider})` : ""}, {last.itemsSeen} items, {last.latencyMs} ms (lookup {last.timings.lookupMs} · AI {last.timings.aiMs} · tracker {last.timings.trackerMs})</>}
          {last?.note && <> · {last.note}</>}
          {sampler.error && <span className="text-destructive"> · {sampler.error}</span>}
        </p>
      </section>

      <aside className="space-y-4">
        <TickerPanel />
        <h2 className="font-semibold">Detected products</h2>
        {shown.length === 0 && <p className="text-sm text-muted-foreground">Nothing confirmed yet. Items show once the AI is sure (usually within a few seconds).</p>}
        <ul className="space-y-2">
          {shown.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{d.label}</p>
                <p className="text-xs text-muted-foreground">
                  {d.category} · {Math.round(d.confidence * 100)}% · {d.hits} hits
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Badge variant={STATE_VARIANT[d.state]}>{d.state}</Badge>
                <Button size="sm" variant="ghost" onClick={() => rename(d)} aria-label={`Correct ${d.label}`}>Edit</Button>
                {d.state !== "pinned" && d.state !== "hidden" && (
                  <Button size="sm" variant="ghost" onClick={() => setState(d.id, "pinned")} aria-label={`Pin ${d.label}`}>Pin</Button>
                )}
                {d.state !== "hidden" ? (
                  <Button size="sm" variant="ghost" onClick={() => setState(d.id, "hidden")} aria-label={`Hide ${d.label}`}>Hide</Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setState(d.id, "visible")} aria-label={`Show ${d.label}`}>Show</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {candidates.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Watching {candidates.length} possible item{candidates.length > 1 ? "s" : ""}: {candidates.map((c) => c.label).join(", ")}
          </p>
        )}
      </aside>
    </div>
  );
}
