"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Activity, CircleCheck, ExternalLink, Eye, EyeOff, Film, Globe, MonitorUp, Pencil, Pin, ScanSearch, Upload, type LucideIcon } from "lucide-react";
import { LivePill } from "@/components/app/live-pill";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    setKernelBusy(true);
    try {
      const res = await fetch(`/api/streams/${stream.id}/kernel`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setLiveView(null);
      setSource(null);
      toast.success("KERNEL browser stopped");
    } catch {
      // Keep the KERNEL view: the cloud browser may still be running (and billing).
      toast.error("Couldn't stop the KERNEL browser. Try again, or use Demo panel → Kill all KERNEL sessions");
    } finally {
      setKernelBusy(false);
    }
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

  const sourceTile = (active: boolean) =>
    `flex items-center gap-3 rounded-xl border p-3 text-start transition hover:border-primary/40 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-primary ${
      active ? "border-primary/50 bg-accent/60 ring-1 ring-primary/20" : "bg-card"
    }`;
  const isBlob = !!videoUrl?.startsWith("blob:");
  // Going live already recorded the creator's consent for this stream, so a live stream
  // counts as consented (the checkbox is locked while live).
  const consented = consent || live;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="min-w-0 space-y-5">
        <PageHeader
          eyebrow={`${creatorName} · Studio`}
          title={stream.title}
          description="Go live and Seen's AI watches your video. Products it recognizes appear on your viewer page, ready to buy with PayPal. You never tag anything."
          actions={
            <>
              {last?.mode === "saver" && <Badge variant="secondary">Free-tier saver mode</Badge>}
              {last?.mode === "cache_only" && <Badge variant="secondary">Cache-only mode</Badge>}
              <LivePill live={live} />
              {ended && (
                <Link href={`/recap/${stream.id}`} className={PILL_LINK}>
                  Recap ↗
                </Link>
              )}
              <Link href={`/live/${creatorSlug}`} target="_blank" className={PILL_LINK}>
                Viewer page <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </>
          }
        />

        {!ai.enabled && (
          <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            AI provider <b>{ai.provider}</b> unavailable ({ai.reason}).{" "}
            {ai.demoCache ? "Cached demo results will still be used." : "Set DEMO_CACHE=true to use cached results."}
          </p>
        )}

        <div
          className={`stage-dots relative w-full overflow-hidden rounded-2xl shadow-lift ring-1 ring-black/5 ${live ? "outline-2 outline-offset-4 outline-live/25" : ""}`}
          style={{ aspectRatio: aspect }}
        >
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
              className="pointer-events-none absolute rounded-lg border-2 border-white shadow-[0_0_0_3px_oklch(0.53_0.23_286/0.45)] motion-safe:transition-all"
              style={{ left: `${d.bbox![0] * 100}%`, top: `${d.bbox![1] * 100}%`, width: `${d.bbox![2] * 100}%`, height: `${d.bbox![3] * 100}%` }}
            >
              <span className="absolute -top-7 left-0 whitespace-nowrap rounded-md bg-white px-2 py-0.5 text-xs font-medium text-foreground shadow">
                {d.label}
              </span>
            </div>
          ))}
          {!source && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
              <span className="grid size-12 place-items-center rounded-2xl bg-white/10 backdrop-blur" aria-hidden>
                <ScanSearch className="size-6" />
              </span>
              <p className="font-medium">Pick a source below to start</p>
              <p className="max-w-sm text-sm text-white/60">Seen samples frames, spots products and puts them next to your video for viewers.</p>
            </div>
          )}
          {source === "kernel" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/90">
              <Globe className="size-8 text-white/70" aria-hidden />
              <p>A KERNEL cloud browser is watching your stream page and sending frames.</p>
              {liveView && (
                <a href={liveView} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-white px-3 py-1.5 font-medium text-black">
                  Open KERNEL live view ↗
                </a>
              )}
            </div>
          )}
          {live && (
            <span aria-hidden className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-live px-2.5 py-1 text-[11px] font-semibold text-white">
              <span className="size-1.5 rounded-full bg-white" /> LIVE
            </span>
          )}
        </div>

        <section aria-label="Source" className="surface space-y-4 p-4">
          <p className="text-sm font-semibold">
            <span className="text-muted-foreground">1 ·</span> Choose a source
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className={`${sourceTile(source === "upload" && isBlob)} cursor-pointer focus-within:outline-2 focus-within:outline-primary`}>
              <input type="file" accept="video/*" className="sr-only" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
              <SourceIcon icon={Upload} />
              <span className="text-sm font-medium">Upload video</span>
            </label>
            <button type="button" onClick={pickDemoVideo} className={sourceTile(source === "upload" && !isBlob)}>
              <SourceIcon icon={Film} />
              <span className="text-sm font-medium">Use demo video</span>
            </button>
            <button type="button" onClick={pickScreen} className={sourceTile(source === "screen")}>
              <SourceIcon icon={MonitorUp} />
              <span className="text-sm font-medium">Share screen / OBS</span>
            </button>
          </div>

          <div className="space-y-2 rounded-xl bg-muted/60 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Globe className="size-4 text-muted-foreground" aria-hidden />
              Or watch your own stream URL with a KERNEL cloud browser
            </p>
            {kernel.enabled ? (
              source === "kernel" ? (
                <Button variant="outline" onClick={stopKernel} disabled={kernelBusy}>{kernelBusy ? "Stopping…" : "Stop KERNEL browser"}</Button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Input
                    type="url"
                    value={kernelUrl}
                    onChange={(e) => setKernelUrl(e.target.value)}
                    placeholder="https://www.twitch.tv/yourchannel"
                    aria-label="Your stream URL"
                    className="min-w-60 flex-1 bg-card"
                  />
                  <Button onClick={startKernel} disabled={!consented || !kernelUrl.startsWith("https://") || kernelBusy}>
                    {kernelBusy ? "Starting…" : "Watch with KERNEL"}
                  </Button>
                </div>
              )
            ) : (
              <p className="text-xs text-muted-foreground">KERNEL unavailable ({kernel.reason}). Screen sharing and uploads still work.</p>
            )}
            <p className="text-xs text-muted-foreground">Only your own channel. Capped per session and per day to protect credits; stops when the stream ends.</p>
          </div>
        </section>

        <section aria-label="Go live" className="surface flex flex-wrap items-center justify-between gap-4 p-4">
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={consented} onChange={(e) => setConsent(e.target.checked)} disabled={live} />
            <span>
              <span className="font-semibold text-muted-foreground">2 ·</span> This is my own content and I have the right to make it shoppable
            </span>
          </label>
          {live ? (
            <Button variant="destructive" size="lg" className="px-4" onClick={() => goLive(false)}>
              End stream
            </Button>
          ) : (
            <Button
              size="lg"
              className="brand-bg border-0 px-5 text-white shadow-sm hover:brightness-110"
              onClick={() => goLive(true)}
              disabled={!consent || !source || source === "kernel"}
            >
              Go live
            </Button>
          )}
        </section>

        {live && last?.note && (
          <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {last.note}
          </p>
        )}
        {live && source === "screen" && (
          <p className="text-xs text-muted-foreground">
            Tip: share the window or tab with your products in it. Sampling keeps running while you switch tabs.
          </p>
        )}
        <p className="text-xs text-muted-foreground" aria-live="polite">
          <Activity className="me-1.5 inline size-3.5 align-[-2px]" aria-hidden />
          Frames sent {sampler.sent} · skipped (unchanged) {sampler.skipped}
          {last && <> · last: {last.source}{last.provider ? ` (${last.provider})` : ""}, {last.itemsSeen} items, {last.latencyMs} ms (lookup {last.timings.lookupMs} · AI {last.timings.aiMs} · tracker {last.timings.trackerMs})</>}
          {last?.note && <> · {last.note}</>}
          {sampler.error && <span className="text-destructive"> · {sampler.error}</span>}
        </p>
      </section>

      <aside className="space-y-4">
        <TickerPanel />
        <section aria-labelledby="detected" className="surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="detected" className="font-semibold">Detected products</h2>
            {shown.length > 0 && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">{shown.length}</span>}
          </div>
          {shown.length === 0 && (
            <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
              <ScanSearch className="mx-auto mb-2 size-5" aria-hidden />
              Nothing confirmed yet. Items show once the AI is sure (usually within a few seconds).
            </div>
          )}
          <ul className="divide-y">
            {shown.map((d) => (
              <li key={d.id} className={`flex items-center justify-between gap-2 py-2.5 ${d.state === "hidden" ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-medium">
                    {d.state === "pinned" && <Pin className="size-3.5 shrink-0 text-primary" aria-label="Pinned" />}
                    {d.state === "hidden" && <EyeOff className="size-3.5 shrink-0" aria-label="Hidden" />}
                    {d.state === "visible" && <CircleCheck className="size-3.5 shrink-0 text-success" aria-label="Visible" />}
                    <span className="truncate">{d.label}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.category} · {Math.round(d.confidence * 100)}% · {d.hits} hits
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <Button size="icon-sm" variant="ghost" onClick={() => rename(d)} aria-label={`Correct ${d.label}`} title="Edit label">
                    <Pencil />
                  </Button>
                  {d.state !== "pinned" && d.state !== "hidden" && (
                    <Button size="icon-sm" variant="ghost" onClick={() => setState(d.id, "pinned")} aria-label={`Pin ${d.label}`} title="Pin for viewers">
                      <Pin />
                    </Button>
                  )}
                  {d.state !== "hidden" ? (
                    <Button size="icon-sm" variant="ghost" onClick={() => setState(d.id, "hidden")} aria-label={`Hide ${d.label}`} title="Hide from viewers">
                      <EyeOff />
                    </Button>
                  ) : (
                    <Button size="icon-sm" variant="ghost" onClick={() => setState(d.id, "visible")} aria-label={`Show ${d.label}`} title="Show to viewers">
                      <Eye />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {candidates.length > 0 && (
            <p className="mt-3 rounded-lg bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
              Watching {candidates.length} possible item{candidates.length > 1 ? "s" : ""}: {candidates.map((c) => c.label).join(", ")}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

const PILL_LINK = "inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-medium shadow-sm hover:bg-muted";

function SourceIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground" aria-hidden>
      <Icon className="size-4" />
    </span>
  );
}
