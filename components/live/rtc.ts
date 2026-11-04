/** ICE server shape passed from the server (mirrors lib/realtime/webrtc RTCIceServerLike). */
export type IceServers = RTCIceServer[];

/**
 * Resolves when the browser has finished gathering ICE candidates (or after a timeout).
 * We send the SDP only after this, so all candidates travel inside it and signaling is a
 * single offer/answer round trip: no separate candidate exchange to relay.
 */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    // A slow STUN server shouldn't stall the handshake: host candidates are enough on
    // the same network, and whatever was gathered by now is usually enough elsewhere.
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
