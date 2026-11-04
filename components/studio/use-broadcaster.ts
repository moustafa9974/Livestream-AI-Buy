"use client";

import { useEffect, useRef, useState } from "react";
import { type IceServers, waitForIceGathering } from "@/components/live/rtc";

interface Options {
  streamId: string;
  /** Broadcast only while live and the feature is on. */
  active: boolean;
  /** The media to send. Called when a viewer connects (tracks may appear late for files). */
  getMedia: () => MediaStream | null;
  /** Changes when the source changes (new screen share, new file): reconnects everyone. */
  mediaKey: string | null;
  iceServers: IceServers;
  maxViewers: number;
}

const POLL_MS = 1500;

/**
 * Creator side of live video. Polls Seen for viewers waiting to connect and answers each
 * with a direct WebRTC connection carrying the creator's video. Seen only relays the
 * handshake; the video goes from this browser straight to each viewer.
 */
export function useBroadcaster({ streamId, active, getMedia, mediaKey, iceServers, maxViewers }: Options) {
  const [viewers, setViewers] = useState(0);
  const latest = useRef({ getMedia, iceServers, maxViewers });
  useEffect(() => {
    latest.current = { getMedia, iceServers, maxViewers };
  });

  useEffect(() => {
    if (!active || !mediaKey) return;
    let stopped = false;
    const peers = new Map<string, RTCPeerConnection>();
    const handled = new Set<string>();
    const count = () => !stopped && setViewers(peers.size);

    const reply = (sessionId: string, sdp: string | null) =>
      fetch(`/api/streams/${streamId}/webrtc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, sdp }),
      }).catch(() => {});

    async function answer(sessionId: string, offerSdp: string) {
      const { getMedia: media, iceServers: servers, maxViewers: max } = latest.current;
      const stream = media();
      // At the limit, or nothing to send yet (a file that hasn't started): decline, the
      // viewer falls back to snapshots and retries later.
      if (peers.size >= max || !stream || stream.getTracks().length === 0) return reply(sessionId, null);

      const pc = new RTCPeerConnection({ iceServers: servers });
      peers.set(sessionId, pc);
      count();
      const drop = () => {
        pc.close();
        if (peers.get(sessionId) === pc) peers.delete(sessionId);
        count();
      };
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") drop();
        // "disconnected" can recover on its own; give it a moment before giving up.
        if (pc.connectionState === "disconnected") setTimeout(() => pc.connectionState === "disconnected" && drop(), 5000);
      });
      try {
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await waitForIceGathering(pc);
        if (stopped) return drop();
        await reply(sessionId, pc.localDescription?.sdp ?? null);
      } catch {
        drop();
        await reply(sessionId, null);
      }
    }

    async function poll() {
      while (!stopped) {
        try {
          const res = await fetch(`/api/streams/${streamId}/webrtc`, { cache: "no-store" });
          const data = res.ok ? ((await res.json()) as { offers: Array<{ id: string; sdp: string }> }) : { offers: [] };
          for (const o of data.offers) {
            if (handled.has(o.id)) continue;
            handled.add(o.id);
            void answer(o.id, o.sdp);
          }
        } catch {
          // Network blip: keep polling.
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }
    void poll();

    return () => {
      stopped = true;
      peers.forEach((pc) => pc.close());
      peers.clear();
      setViewers(0);
    };
  }, [active, mediaKey, streamId]);

  return { viewers };
}
