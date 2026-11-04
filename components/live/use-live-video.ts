"use client";

import { useEffect, useState } from "react";
import { type IceServers, sleep, waitForIceGathering } from "./rtc";

export type LiveVideoStatus = "off" | "connecting" | "live" | "unavailable";

interface Options {
  creatorSlug: string;
  streamId: string;
  enabled: boolean;
  iceServers: IceServers;
}

const ANSWER_POLL_MS = 1000;
const ANSWER_TIMEOUT_MS = 15_000; // the studio polls every 1.5 s, then gathers ICE
const CONNECT_TIMEOUT_MS = 12_000;
const RETRY_MS = [4000, 8000, 15_000, 30_000];

class GiveUp extends Error {}

/**
 * Viewer side of live video: asks the creator's studio for a direct WebRTC connection
 * and returns the incoming stream. On any failure (strict network, viewer limit, studio
 * closed) it reports "unavailable" so the page shows frame snapshots, and keeps retrying
 * with backoff while the stream is live.
 */
export function useLiveVideo({ creatorSlug, streamId, enabled, iceServers }: Options) {
  const [media, setMedia] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<LiveVideoStatus>("off");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    const base = `/api/live/${encodeURIComponent(creatorSlug)}/webrtc`;

    async function attempt(): Promise<RTCPeerConnection> {
      const conn = new RTCPeerConnection({ iceServers });
      pc = conn;
      conn.addTransceiver("video", { direction: "recvonly" });
      conn.addTransceiver("audio", { direction: "recvonly" });
      const incoming = new MediaStream();
      conn.addEventListener("track", (e) => {
        incoming.addTrack(e.track);
        if (!cancelled) setMedia(incoming);
      });

      await conn.setLocalDescription(await conn.createOffer());
      await waitForIceGathering(conn);
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId, sdp: conn.localDescription?.sdp }),
      });
      if (res.status === 404 || res.status === 503) throw new GiveUp(); // not live, or feature off
      if (!res.ok) throw new Error("offer failed");
      const { sessionId } = (await res.json()) as { sessionId: string };

      const deadline = Date.now() + ANSWER_TIMEOUT_MS;
      for (;;) {
        if (cancelled) throw new GiveUp();
        if (Date.now() > deadline) throw new Error("no answer");
        await sleep(ANSWER_POLL_MS);
        const r = await fetch(`${base}?stream=${encodeURIComponent(streamId)}&session=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        const s = (await r.json()) as { status: string; sdp?: string };
        if (s.status === "answered" && s.sdp) {
          await conn.setRemoteDescription({ type: "answer", sdp: s.sdp });
          break;
        }
        if (s.status === "rejected" || s.status === "expired") throw new Error(s.status);
      }

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("connect timeout")), CONNECT_TIMEOUT_MS);
        const check = () => {
          if (conn.connectionState === "connected") {
            clearTimeout(timer);
            resolve();
          } else if (conn.connectionState === "failed" || conn.connectionState === "closed") {
            clearTimeout(timer);
            reject(new Error(conn.connectionState));
          }
        };
        conn.addEventListener("connectionstatechange", check);
        check();
      });
      return conn;
    }

    /** Resolves when an established connection drops. */
    const untilDropped = (conn: RTCPeerConnection) =>
      new Promise<void>((resolve) => {
        const check = () => {
          const s = conn.connectionState;
          if (s === "failed" || s === "closed") resolve();
          if (s === "disconnected") setTimeout(() => conn.connectionState !== "connected" && resolve(), 4000);
        };
        conn.addEventListener("connectionstatechange", check);
      });

    async function run() {
      let failures = 0;
      while (!cancelled) {
        setStatus(failures === 0 ? "connecting" : "unavailable");
        try {
          const conn = await attempt();
          if (cancelled) return;
          failures = 0;
          setStatus("live");
          await untilDropped(conn);
        } catch (err) {
          if (err instanceof GiveUp) {
            if (!cancelled) setStatus("unavailable");
            return;
          }
          failures++;
        }
        pc?.close();
        pc = null;
        if (cancelled) return;
        setMedia(null);
        setStatus("unavailable");
        await sleep(RETRY_MS[Math.min(failures, RETRY_MS.length) - 1] ?? RETRY_MS[0]);
      }
    }
    void run();

    return () => {
      cancelled = true;
      pc?.close();
      setMedia(null);
      setStatus("off");
    };
  }, [creatorSlug, streamId, enabled, iceServers]);

  return { media, status };
}
