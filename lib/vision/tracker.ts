import type { DetectionState } from "@/generated/prisma/enums";
import type { VisionItem } from "../ai/vision-schema";

/**
 * Detection tracker (SPEC §3): turns noisy per-frame AI output into stable detections.
 *
 * - Dedupe: an item joins an existing detection when they're similar enough
 *   (embedding cosine, or word overlap when embeddings are unavailable).
 * - Stabilize: a detection becomes visible only after MIN_HITS sightings within
 *   HIT_WINDOW_SEC at sufficient confidence, so one bad frame never flashes a card.
 * - Fast lane: an item the model is very sure of AND that is clearly featured
 *   (confidence ≥ fastLaneConfidence, prominence ≥ fastLaneProminence) shows on its
 *   first sighting. Flicker comes from low-confidence, incidental items, which still
 *   need two sightings; this keeps the card within ~5–10 s of the creator holding
 *   the product up. Set fastLaneConfidence to >1 to disable.
 * - Respect the creator: hidden stays hidden, pinned stays pinned.
 *
 * Pure: takes current state, returns the changes. The caller persists them.
 */

export interface TrackedDetection {
  id: string;
  label: string;
  category: string;
  embedding: number[] | null;
  hits: number;
  firstSeenSec: number;
  lastSeenSec: number;
  confidence: number;
  state: DetectionState;
}

export interface TrackerConfig {
  minHits: number;
  hitWindowSec: number;
  minConfidence: number;
  maxVisible: number;
  sameItemCosine: number;
  sameItemOverlap: number;
  fastLaneConfidence: number;
  fastLaneProminence: number;
}

export const DEFAULT_TRACKER: TrackerConfig = {
  minHits: 2,
  hitWindowSec: 15,
  minConfidence: 0.55,
  maxVisible: 12,
  sameItemCosine: 0.86,
  sameItemOverlap: 0.5,
  fastLaneConfidence: 0.9,
  fastLaneProminence: 0.6,
};

export interface IncomingItem {
  item: VisionItem;
  embedding: number[] | null;
}

export type TrackerOp =
  | {
      kind: "update";
      id: string;
      hits: number;
      lastSeenSec: number;
      confidence: number;
      state: DetectionState;
      item: VisionItem;
      becameVisible: boolean;
    }
  | { kind: "create"; item: VisionItem; embedding: number[] | null; tsSec: number; state: DetectionState };

const STOP = new Set(["a", "an", "the", "and", "with", "of", "in", "on"]);

function tokens(label: string, category: string): Set<string> {
  const words = `${label} ${category.replace(/[/_-]/g, " ")}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)); // crude singular
  return new Set(words);
}

function overlap(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1); // Jaccard
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Similarity on a single 0–1 scale, plus whether it counts as "the same item". */
export function similarity(
  a: { label: string; category: string; embedding: number[] | null },
  b: { label: string; category: string; embedding: number[] | null },
  cfg: TrackerConfig = DEFAULT_TRACKER,
): { score: number; same: boolean } {
  const sameTop = a.category.split("/")[0] === b.category.split("/")[0];
  if (a.embedding && b.embedding && a.embedding.length === b.embedding.length) {
    const c = dot(a.embedding, b.embedding) - (sameTop ? 0 : 0.05);
    return { score: c, same: c >= cfg.sameItemCosine };
  }
  // Without embeddings, words alone can merge different things that share an adjective
  // ("wireless keyboard" vs "wireless trackpad"), so the kind of thing must agree too.
  const leafA = a.category.split("/").pop();
  const leafB = b.category.split("/").pop();
  if (leafA && leafB && leafA !== leafB) return { score: 0, same: false };
  const o = overlap(tokens(a.label, a.category), tokens(b.label, b.category));
  return { score: o, same: o >= cfg.sameItemOverlap };
}

export function track(
  existing: TrackedDetection[],
  incoming: IncomingItem[],
  tsSec: number,
  cfg: TrackerConfig = DEFAULT_TRACKER,
): TrackerOp[] {
  const ops: TrackerOp[] = [];
  const claimed = new Set<string>();
  let visibleCount = existing.filter((d) => d.state === "visible" || d.state === "pinned").length;

  // Most confident items first, so they win ties when two items look alike.
  const ordered = [...incoming].sort((a, b) => b.item.confidence - a.item.confidence);

  for (const { item, embedding } of ordered) {
    let best: { d: TrackedDetection; score: number } | null = null;
    for (const d of existing) {
      if (claimed.has(d.id)) continue;
      const sim = similarity({ label: item.label, category: item.category, embedding }, d, cfg);
      if (sim.same && (!best || sim.score > best.score)) best = { d, score: sim.score };
    }

    if (!best) {
      const fastLane = item.confidence >= cfg.fastLaneConfidence && item.prominence >= cfg.fastLaneProminence;
      const visible =
        (cfg.minHits <= 1 || fastLane) && item.confidence >= cfg.minConfidence && visibleCount < cfg.maxVisible;
      if (visible) visibleCount++;
      ops.push({ kind: "create", item, embedding, tsSec, state: visible ? "visible" : "candidate" });
      continue;
    }

    const d = best.d;
    claimed.add(d.id);
    const withinWindow = tsSec - d.lastSeenSec <= cfg.hitWindowSec;
    // A candidate that went quiet starts counting again; visible items just keep accruing.
    const hits = d.state === "candidate" && !withinWindow ? 1 : d.hits + 1;
    // Smoothed confidence so one shaky frame doesn't swing it.
    const confidence = d.hits === 0 ? item.confidence : 0.6 * d.confidence + 0.4 * item.confidence;

    let state = d.state;
    let becameVisible = false;
    if (state === "candidate" && hits >= cfg.minHits && confidence >= cfg.minConfidence && visibleCount < cfg.maxVisible) {
      state = "visible";
      becameVisible = true;
      visibleCount++;
    }
    ops.push({ kind: "update", id: d.id, hits, lastSeenSec: Math.max(d.lastSeenSec, tsSec), confidence, state, item, becameVisible });
  }
  return ops;
}
