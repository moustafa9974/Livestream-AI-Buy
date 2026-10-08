"use client";

import { useEffect, useRef, useState } from "react";
import type { FrameOutcome } from "@/lib/vision/process-frame";
import { DHASH_H, DHASH_W, dHashFromGray, grayFromRgba, hamming } from "@/lib/vision/dhash";

const MAX_WIDTH = 768;
const JPEG_QUALITY = 0.7;

export interface SamplerOptions {
  streamId: string;
  active: boolean;
  /** Seconds into the content: video.currentTime for files, time since go-live for screens. */
  getTimestamp: () => number;
  baseIntervalSec: number;
  minChangeDistance: number;
  maxStaleSec: number;
  transcript?: () => string | undefined;
}

export interface SamplerState {
  last: FrameOutcome | null;
  sent: number;
  skipped: number;
  error: string | null;
}

/**
 * Samples frames from a <video> in the creator's browser (SPEC §3): canvas → JPEG
 * (≤768px, q0.7) plus a 64-bit dHash. Unchanged frames are skipped unless
 * maxStaleSec has passed. Sampling slows down or stops sending images when the
 * server reports free-tier saver / cache-only mode.
 */
export function useFrameSampler(videoRef: React.RefObject<HTMLVideoElement | null>, opts: SamplerOptions): SamplerState {
  const [state, setState] = useState<SamplerState>({ last: null, sent: 0, skipped: 0, error: null });
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    if (!opts.active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interval = opts.baseIntervalSec;
    let cacheOnly = false;
    let lastHash: string | null = null;
    let lastSentAt = 0;

    const big = document.createElement("canvas");
    const tiny = document.createElement("canvas");
    tiny.width = DHASH_W;
    tiny.height = DHASH_H;

    const schedule = () => {
      if (!stopped) timer = setTimeout(tick, interval * 1000);
    };

    async function tick() {
      const video = videoRef.current;
      const o = optsRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0 || (video.paused && !video.srcObject)) {
        return schedule(); // nothing to look at yet (or a paused file)
      }

      // Perceptual hash from a 9×8 downscale.
      const tctx = tiny.getContext("2d", { willReadFrequently: true })!;
      tctx.drawImage(video, 0, 0, DHASH_W, DHASH_H);
      const hash = dHashFromGray(grayFromRgba(tctx.getImageData(0, 0, DHASH_W, DHASH_H).data));

      const now = Date.now();
      const changed = !lastHash || hamming(hash, lastHash) >= o.minChangeDistance;
      const stale = now - lastSentAt >= o.maxStaleSec * 1000;
      if (!changed && !stale) {
        setState((s) => ({ ...s, skipped: s.skipped + 1 }));
        return schedule();
      }

      let image: string | undefined;
      if (!cacheOnly) {
        const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
        big.width = Math.round(video.videoWidth * scale);
        big.height = Math.round(video.videoHeight * scale);
        big.getContext("2d")!.drawImage(video, 0, 0, big.width, big.height);
        image = big.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1];
      }

      try {
        const res = await fetch(`/api/streams/${o.streamId}/frames`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tsSec: Math.round(o.getTimestamp() * 10) / 10, dHash: hash, image, transcript: o.transcript?.() }),
        });
        const data = (await res.json()) as FrameOutcome & { error?: string; code?: string };
        if (res.status === 409) {
          stopped = true;
          setState((s) => ({ ...s, error: "Stream is not live" }));
          return;
        }
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        lastHash = hash;
        lastSentAt = now;
        // Server-driven pacing: saver mode doubles the interval; cache-only stops sending images.
        cacheOnly = data.nextIntervalSec === null;
        interval = data.nextIntervalSec ?? o.baseIntervalSec * 2;
        setState((s) => ({ last: data, sent: s.sent + 1, skipped: s.skipped, error: null }));
      } catch (err) {
        setState((s) => ({ ...s, error: err instanceof Error ? err.message : "Frame upload failed" }));
        interval = Math.min(interval * 2, 30); // back off on errors
      }
      schedule();
    }

    timer = setTimeout(tick, 500);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [opts.active, opts.streamId, opts.baseIntervalSec, videoRef]);

  return state;
}
