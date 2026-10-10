"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFrameSampler } from "@/components/studio/use-frame-sampler";
import type { DetectionView } from "@/lib/vision/process-frame";

type Source = "upload" | "screen";

interface Props {
  stream: { id: string; title: string; status: string; frameIntervalSec: number; videoAssetUrl: string | null };
  initialDetections: DetectionView[];
  creatorName: string;
  ai: { provider: string; enabled: boolean; reason: string | null; demoCache: boolean };
  tuning: { minChangeDistance: number; maxStaleSec: number };
}

const STATE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  visible: "default",
  pinned: "default",
  candidate: "outline",
  hidden: "secondary",
};

export function LiveStudio({ stream, initialDetections, creatorName, ai, tuning }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [live, setLive] = useState(stream.status === "live");
  // Creator edits apply instantly; the next frame response confirms them from the server.
  const [overrides, setOverrides] = useState<Record<string, DetectionView["state"]>>({});
  const [aspect, setAspect] = useState(16 / 9);
  const liveSince = useRef(0);

  const sampler = useFrameSampler(videoRef, {
    streamId: stream.id,
    active: live && source !== null,
    getTimestamp: () =>
      source === "screen" ? (Date.now() - liveSince.current) / 1000 : (videoRef.current?.currentTime ?? 0),
    baseIntervalSec: stream.frameIntervalSec,
    minChangeDistance: tuning.minChangeDistance,
    maxStaleSec: tuning.maxStaleSec,
  });

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
    if (start) {
      toast.success("You're live. Seen is watching for products");
      videoRef.current?.play().catch(() => {});
    }
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
  const detections = (last?.detections ?? initialDetections).map((d) => (overrides[d.id] ? { ...d, state: overrides[d.id] } : d));
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
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center">
            <input type="file" accept="video/*" className="sr-only" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
            <span className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted">Upload video</span>
          </label>
          <Button variant="outline" onClick={pickDemoVideo}>Use demo video</Button>
          <Button variant="outline" onClick={pickScreen}>Share screen / OBS</Button>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-xl border p-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={live} />
            This is my own content and I have the right to make it shoppable
          </label>
          {live ? (
            <Button variant="destructive" onClick={() => goLive(false)}>End stream</Button>
          ) : (
            <Button onClick={() => goLive(true)} disabled={!consent || !source}>Go live</Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground" aria-live="polite">
          Frames sent {sampler.sent} · skipped (unchanged) {sampler.skipped}
          {last && <> · last: {last.source}{last.provider ? ` (${last.provider})` : ""}, {last.itemsSeen} items, {last.latencyMs} ms (lookup {last.timings.lookupMs} · AI {last.timings.aiMs} · tracker {last.timings.trackerMs})</>}
          {last?.note && <> · {last.note}</>}
          {sampler.error && <span className="text-destructive"> · {sampler.error}</span>}
        </p>
      </section>

      <aside className="space-y-4">
        <h2 className="font-semibold">Detected products</h2>
        {shown.length === 0 && <p className="text-sm text-muted-foreground">Nothing confirmed yet. An item shows after it&apos;s seen twice.</p>}
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
