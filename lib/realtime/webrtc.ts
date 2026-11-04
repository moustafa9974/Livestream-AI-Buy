import { randomUUID } from "node:crypto";
import type { Env } from "../env";

/**
 * WebRTC signaling for live video, creator → viewers, browser to browser.
 *
 * Seen never touches the video. It only passes the connection handshake (SDP):
 * a viewer posts an offer, the creator's studio picks it up and posts an answer, the
 * viewer polls for it. ICE candidates travel inside the SDP (gathered before sending),
 * so there is no separate candidate exchange.
 *
 * State is in memory, like lib/realtime/bus.ts: Render's free tier runs one instance, and
 * a handshake only lives for seconds. If the server restarts mid-handshake, the viewer
 * simply retries.
 */

export type SessionStatus = "pending" | "answered" | "rejected" | "expired";

interface Session {
  id: string;
  streamId: string;
  offer: string;
  answer: string | null;
  rejected: boolean;
  createdAt: number;
  answeredAt: number | null;
}

/** An unanswered offer older than this is dropped (the studio may be closed). */
export const OFFER_TTL_MS = 30_000;
/** Answered sessions are kept briefly so the viewer's poll can collect the answer. */
export const ANSWERED_TTL_MS = 60_000;
/** Max offers waiting per stream, so nobody can flood a creator's studio. */
export const MAX_PENDING_PER_STREAM = 10;

const g = globalThis as unknown as { seenRtc?: Map<string, Session> };
const sessions = (g.seenRtc ??= new Map());

function sweep(now: number) {
  for (const [id, s] of sessions) {
    const age = now - (s.answeredAt ?? s.createdAt);
    if (age > (s.answeredAt || s.rejected ? ANSWERED_TTL_MS : OFFER_TTL_MS)) sessions.delete(id);
  }
}

export function createOffer(streamId: string, sdp: string, now = Date.now()): { ok: true; id: string } | { ok: false; reason: "busy" } {
  sweep(now);
  const pending = [...sessions.values()].filter((s) => s.streamId === streamId && !s.answer && !s.rejected).length;
  if (pending >= MAX_PENDING_PER_STREAM) return { ok: false, reason: "busy" };
  const id = randomUUID();
  sessions.set(id, { id, streamId, offer: sdp, answer: null, rejected: false, createdAt: now, answeredAt: null });
  return { ok: true, id };
}

/** Offers the creator's studio still has to answer. */
export function pendingOffers(streamId: string, now = Date.now()): Array<{ id: string; sdp: string }> {
  sweep(now);
  return [...sessions.values()]
    .filter((s) => s.streamId === streamId && !s.answer && !s.rejected)
    .map((s) => ({ id: s.id, sdp: s.offer }));
}

/** The creator answers (sdp) or declines (null, e.g. at the viewer limit). */
export function answerOffer(streamId: string, id: string, sdp: string | null, now = Date.now()): boolean {
  sweep(now);
  const s = sessions.get(id);
  // Scoped by stream: a creator can only answer offers made to their own stream.
  if (!s || s.streamId !== streamId || s.answer || s.rejected) return false;
  if (sdp) s.answer = sdp;
  else s.rejected = true;
  s.answeredAt = now;
  return true;
}

export function sessionStatus(streamId: string, id: string, now = Date.now()): { status: SessionStatus; sdp?: string } {
  sweep(now);
  const s = sessions.get(id);
  if (!s || s.streamId !== streamId) return { status: "expired" };
  if (s.rejected) return { status: "rejected" };
  if (s.answer) return { status: "answered", sdp: s.answer };
  return { status: "pending" };
}

/** Stream ended: drop its handshakes. */
export function clearStreamSessions(streamId: string): void {
  for (const [id, s] of sessions) if (s.streamId === streamId) sessions.delete(id);
}

/** For tests only. */
export function resetSessionsForTests(): void {
  sessions.clear();
}

/** ICE servers for browsers. STUN is free; TURN only if configured. */
export function iceServersFrom(env: Env): RTCIceServerLike[] {
  const stun = env.WEBRTC_STUN_URLS.split(",").map((u) => u.trim()).filter(Boolean);
  const servers: RTCIceServerLike[] = stun.length ? [{ urls: stun }] : [];
  if (env.WEBRTC_TURN_URL) {
    servers.push({ urls: env.WEBRTC_TURN_URL, username: env.WEBRTC_TURN_USERNAME, credential: env.WEBRTC_TURN_CREDENTIAL });
  }
  return servers;
}

/** Same shape as the DOM's RTCIceServer, declared here so server code needs no DOM types. */
export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}
