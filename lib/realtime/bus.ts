import { EventEmitter } from "node:events";

/**
 * In-process "rail changed" signal. The watcher emits after detections/matches change;
 * SSE connections listening for that stream push immediately. It's an optimization:
 * SSE also polls a cheap version query, so updates made by another process (e.g. the
 * Astropods watcher) still arrive within a few seconds.
 */
const g = globalThis as unknown as { seenBus?: EventEmitter };
const bus = (g.seenBus ??= new EventEmitter().setMaxListeners(1000));

export function emitRailChanged(streamId: string): void {
  bus.emit(`rail:${streamId}`);
}

export function onRailChanged(streamId: string, fn: () => void): () => void {
  bus.on(`rail:${streamId}`, fn);
  return () => bus.off(`rail:${streamId}`, fn);
}
