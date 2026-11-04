import { beforeEach, describe, expect, it } from "vitest";
import { getEnv } from "../env";
import { clearSnapshot, getSnapshot, putSnapshot, SNAPSHOT_MAX_AGE_MS } from "./snapshot";
import {
  answerOffer,
  ANSWERED_TTL_MS,
  clearStreamSessions,
  createOffer,
  iceServersFrom,
  MAX_PENDING_PER_STREAM,
  OFFER_TTL_MS,
  pendingOffers,
  resetSessionsForTests,
  sessionStatus,
} from "./webrtc";

const env = (extra: Record<string, string> = {}) => getEnv({ DATABASE_URL: "postgres://x", ...extra });

beforeEach(() => resetSessionsForTests());

describe("WebRTC signaling", () => {
  it("offer → creator sees it → answer → viewer collects it", () => {
    const o = createOffer("s1", "OFFER", 0);
    if (!o.ok) throw new Error("expected ok");
    expect(pendingOffers("s1", 1)).toEqual([{ id: o.id, sdp: "OFFER" }]);
    expect(sessionStatus("s1", o.id, 1)).toEqual({ status: "pending" });

    expect(answerOffer("s1", o.id, "ANSWER", 2)).toBe(true);
    expect(pendingOffers("s1", 3)).toEqual([]);
    expect(sessionStatus("s1", o.id, 3)).toEqual({ status: "answered", sdp: "ANSWER" });
  });

  it("a creator can't answer another stream's offer, or answer twice", () => {
    const o = createOffer("s1", "OFFER", 0);
    if (!o.ok) throw new Error("expected ok");
    expect(answerOffer("other-stream", o.id, "X", 1)).toBe(false);
    expect(sessionStatus("other-stream", o.id, 1).status).toBe("expired");
    expect(answerOffer("s1", o.id, "A", 1)).toBe(true);
    expect(answerOffer("s1", o.id, "B", 2)).toBe(false);
    expect(sessionStatus("s1", o.id, 3).sdp).toBe("A");
  });

  it("declined offers (viewer limit) report rejected", () => {
    const o = createOffer("s1", "OFFER", 0);
    if (!o.ok) throw new Error("expected ok");
    answerOffer("s1", o.id, null, 1);
    expect(sessionStatus("s1", o.id, 2).status).toBe("rejected");
  });

  it("unanswered offers expire; answered ones linger long enough to collect", () => {
    const a = createOffer("s1", "A", 0);
    const b = createOffer("s1", "B", 0);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    answerOffer("s1", b.id, "ANS", 10);
    expect(sessionStatus("s1", a.id, OFFER_TTL_MS + 1).status).toBe("expired");
    expect(sessionStatus("s1", b.id, OFFER_TTL_MS + 1).status).toBe("answered");
    expect(sessionStatus("s1", b.id, 10 + ANSWERED_TTL_MS + 1).status).toBe("expired");
  });

  it("caps waiting offers per stream so a studio can't be flooded", () => {
    for (let i = 0; i < MAX_PENDING_PER_STREAM; i++) expect(createOffer("s1", `O${i}`, 0).ok).toBe(true);
    expect(createOffer("s1", "one too many", 0)).toEqual({ ok: false, reason: "busy" });
    expect(createOffer("s2", "other stream is fine", 0).ok).toBe(true);
  });

  it("ending a stream drops its handshakes", () => {
    const o = createOffer("s1", "OFFER", 0);
    if (!o.ok) throw new Error("expected ok");
    clearStreamSessions("s1");
    expect(pendingOffers("s1", 1)).toEqual([]);
  });

  it("ICE servers: free STUN by default, TURN only when configured", () => {
    expect(iceServersFrom(env())).toEqual([{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]);
    const withTurn = iceServersFrom(
      env({ WEBRTC_STUN_URLS: "stun:a:1", WEBRTC_TURN_URL: "turn:t:3478", WEBRTC_TURN_USERNAME: "u", WEBRTC_TURN_CREDENTIAL: "c" }),
    );
    expect(withTurn).toEqual([{ urls: ["stun:a:1"] }, { urls: "turn:t:3478", username: "u", credential: "c" }]);
  });
});

describe("frame snapshots", () => {
  it("serves the latest frame and forgets stale ones", () => {
    putSnapshot("s1", Buffer.from("jpeg-1").toString("base64"), 0);
    putSnapshot("s1", Buffer.from("jpeg-2").toString("base64"), 5);
    expect(getSnapshot("s1", 10)?.jpeg.toString()).toBe("jpeg-2");
    expect(getSnapshot("s1", 5 + SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
    putSnapshot("s1", "AA==", 0);
    clearSnapshot("s1");
    expect(getSnapshot("s1", 1)).toBeNull();
  });
});
