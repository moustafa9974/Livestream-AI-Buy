/**
 * Latest frame per live stream, kept in memory. The studio (and the KERNEL watcher)
 * already upload a JPEG every few seconds for the AI; viewers whose browser can't open a
 * direct WebRTC connection see that frame instead of a black box.
 * One small JPEG per live stream, so memory stays tiny.
 */

/** Older than this, a snapshot is stale (the stream likely stopped sending). */
export const SNAPSHOT_MAX_AGE_MS = 90_000;

interface Snapshot {
  jpeg: Buffer;
  at: number;
}

const g = globalThis as unknown as { seenSnapshots?: Map<string, Snapshot> };
const snapshots = (g.seenSnapshots ??= new Map());

export function putSnapshot(streamId: string, jpegBase64: string, now = Date.now()): void {
  snapshots.set(streamId, { jpeg: Buffer.from(jpegBase64, "base64"), at: now });
}

export function getSnapshot(streamId: string, now = Date.now()): Snapshot | null {
  const s = snapshots.get(streamId);
  if (!s) return null;
  if (now - s.at > SNAPSHOT_MAX_AGE_MS) {
    snapshots.delete(streamId);
    return null;
  }
  return s;
}

export function clearSnapshot(streamId: string): void {
  snapshots.delete(streamId);
}
