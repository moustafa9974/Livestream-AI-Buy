"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { type IceServers } from "./rtc";
import { useLiveVideo } from "./use-live-video";

const SNAPSHOT_REFRESH_MS = 3000;

/**
 * What a viewer sees while the creator is live, best first:
 * 1. real-time video straight from the creator's browser (WebRTC),
 * 2. the latest frame the studio sent for AI analysis (refreshes every few seconds),
 * 3. `fallback` (a video file, YouTube embed, or "live" placeholder).
 */
export function LiveStage({
  creatorSlug,
  streamId,
  iceServers,
  fallback,
}: {
  creatorSlug: string;
  streamId: string;
  iceServers: IceServers;
  fallback: ReactNode;
}) {
  const { media, status } = useLiveVideo({ creatorSlug, streamId, enabled: true, iceServers });
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tick, setTick] = useState(0);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const realtime = status === "live" && !!media;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = media;
    if (media) v.play().catch(() => {});
  }, [media]);

  // Keep the snapshot fresh until real-time video takes over.
  useEffect(() => {
    if (realtime) return;
    const t = setInterval(() => setTick((n) => n + 1), SNAPSHOT_REFRESH_MS);
    return () => clearInterval(t);
  }, [realtime]);

  const snapshotUrl = `/api/live/${encodeURIComponent(creatorSlug)}/snapshot?stream=${encodeURIComponent(streamId)}&t=${tick}`;

  return (
    <>
      {fallback}
      {!realtime && (
        // eslint-disable-next-line @next/next/no-img-element -- a live JPEG that changes every few seconds; next/image would cache it
        <img
          src={snapshotUrl}
          alt=""
          aria-hidden
          className={`absolute inset-0 h-full w-full bg-black object-contain transition-opacity ${hasSnapshot ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setHasSnapshot(true)}
          onError={() => setHasSnapshot(false)}
        />
      )}
      <video
        ref={videoRef}
        className={`absolute inset-0 h-full w-full bg-black object-contain ${realtime ? "" : "hidden"}`}
        autoPlay
        muted
        playsInline
        controls
      />
      <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
        <Radio className="size-3" aria-hidden />
        {realtime
          ? "Real-time video"
          : status === "connecting"
            ? "Connecting to live video…"
            : hasSnapshot
              ? "Live preview · updates every few seconds"
              : "Waiting for the creator's video…"}
      </span>
    </>
  );
}
