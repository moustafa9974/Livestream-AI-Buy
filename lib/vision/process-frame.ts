import type { DetectionState } from "@/generated/prisma/enums";
import { cachedEmbeddings } from "../ai/embeddings";
import { backupProvider, QuotaExhaustedError, selectProvider, type VisionProvider } from "../ai/providers";
import { analyzeFrame } from "../ai/vision";
import type { VisionResult } from "../ai/vision-schema";
import { consume, frameIntervalFor, peek, type BudgetMode } from "../budget";
import { audit, lockRow } from "../commerce/db";
import { prisma } from "../db";
import { getEnv } from "../env";
import { notify } from "../notify";
import { emitRailChanged } from "../realtime/bus";
import { getRuntimeSettings } from "../settings";
import { embeddingText } from "../search/types";
import { DEFAULT_TRACKER, track, type TrackedDetection } from "./tracker";
import { cacheableHash, getCachedVision, getNearestVision, putCachedVision } from "./vision-cache";

/** Of the frame's time budget, kept back for the backup provider if the primary hangs. */
const BACKUP_RESERVE_MS = 15_000;
const MODE_RANK: Record<BudgetMode, number> = { normal: 0, saver: 1, cache_only: 2 };

/**
 * One step of the stream watcher (SPEC §3 + §6.2): frame → (cache | AI) → tracker →
 * detections. The local in-process watcher and the Astropods agent both call this,
 * so behaviour is identical whichever runtime is active.
 */

export interface FrameInput {
  streamId: string;
  tsSec: number;
  dHash: string;
  imageJpegBase64?: string; // omitted when the client already knows it's cache-only
  transcript?: string;
}

export interface DetectionView {
  id: string;
  label: string;
  category: string;
  state: DetectionState;
  confidence: number;
  hits: number;
  bbox: [number, number, number, number] | null;
  lastSeenSec: number;
  inFrame: boolean;
}

export interface FrameOutcome {
  source: "ai" | "cache" | "demo_cache" | "none";
  provider: string | null;
  mode: BudgetMode;
  /** Why no AI ran, safe to show (e.g. "no AI provider configured", "free-tier limit reached"). */
  note?: string;
  latencyMs: number;
  /** Where the time went (ms), shown in the studio to make latency visible. */
  timings: { lookupMs: number; aiMs: number; trackerMs: number };
  itemsSeen: number;
  nextIntervalSec: number | null;
  detections: DetectionView[];
  /** Detections that just became visible; the caller matches them to products (after responding). */
  newlyVisibleIds: string[];
}

export class FrameError extends Error {
  constructor(readonly code: "NOT_FOUND" | "NOT_LIVE", message: string) {
    super(message);
  }
}

export async function processFrame(input: FrameInput): Promise<FrameOutcome> {
  const env = getEnv();
  const started = Date.now();
  const timings = { lookupMs: 0, aiMs: 0, trackerMs: 0 };
  let mark = started;
  const lap = (k: keyof typeof timings) => {
    const now = Date.now();
    timings[k] += now - mark;
    mark = now;
  };
  const stream = await prisma.stream.findUnique({ where: { id: input.streamId } });
  if (!stream) throw new FrameError("NOT_FOUND", "Stream not found");
  if (stream.status !== "live") throw new FrameError("NOT_LIVE", "Stream is not live");

  const aiOverride = (await getRuntimeSettings()).aiProvider;

  // 1) Cache first: never pay quota twice for the same picture.
  let result: VisionResult | null = null;
  let source: FrameOutcome["source"] = "none";
  let provider: string | null = null;
  let note: string | undefined;
  let mode: BudgetMode = "normal";

  // Frame-hash caching is for video files (the demo video replays identical frames).
  // Live screens/cameras rarely repeat, and mostly-white web pages hash almost the same
  // regardless of content, so a cached answer there would be someone else's frame.
  const useCache = stream.sourceType === "upload" && cacheableHash(input.dHash);
  const exact = useCache ? await getCachedVision(input.dHash) : null;
  lap("lookupMs");
  if (exact) {
    result = exact.result;
    source = "cache";
    provider = exact.provider;
  } else if (useCache && env.DEMO_CACHE) {
    const near = await getNearestVision(input.dHash, env.DEMO_CACHE_MAX_DISTANCE);
    if (near) {
      result = near.result;
      source = "demo_cache";
      provider = near.provider;
    }
  }

  // 2) Otherwise ask the AI, if one is configured and the budget allows. If the primary
  //    (Gemini) can't answer this frame, the backup (OpenRouter free models) gets it.
  if (!result) {
    const primary = selectProvider(aiOverride);
    const chain = [primary, backupProvider(primary)].filter((p): p is VisionProvider => p !== null);
    if (chain.length === 0) {
      note = "No AI provider configured";
    } else if (!input.imageJpegBase64) {
      note = "No image sent";
    } else {
      const deadline = Date.now() + env.VISION_TIMEOUT_MS;
      let outOfQuota = false;
      lap("lookupMs");
      for (const [i, ai] of chain.entries()) {
        const isLast = i === chain.length - 1;
        // Leave the backup enough time to answer when the primary hangs.
        const timeLeft = deadline - Date.now() - (isLast ? 0 : BACKUP_RESERVE_MS);
        if (timeLeft < 3_000) continue;
        const budget = ai.budgetKey ? await consume(ai.budgetKey) : null;
        if (budget && !budget.allowed) {
          outOfQuota = true;
          note = "Free-tier limit reached: using cached results only";
          continue;
        }
        try {
          const out = await analyzeFrame(ai, input.imageJpegBase64, { streamTitle: stream.title, transcript: input.transcript }, timeLeft);
          result = out.result;
          source = "ai";
          provider = out.provider;
          note = undefined;
          // Only cache real findings: an empty answer cached under a static screen's
          // hash would block every later frame from being analysed.
          if (result.items.length > 0 && cacheableHash(input.dHash)) {
            await putCachedVision(input.dHash, { result, provider: out.provider });
          }
          break;
        } catch (err) {
          if (err instanceof QuotaExhaustedError) outOfQuota = true;
          const timedOut = err instanceof Error && /abort|timed? ?out/i.test(`${err.name} ${err.message}`);
          note =
            err instanceof QuotaExhaustedError
              ? "Today's free AI quota is used up (it resets daily). Cached results only until then"
              : timedOut
                ? "The AI took too long on this frame (free tier is busy); trying again on the next one"
                : "AI analysis failed for this frame; trying again on the next one";
          console.warn("[vision]", ai.name, err instanceof Error ? err.message : err);
        }
      }
      if (!result && outOfQuota) mode = "cache_only";
    }
  }

  lap("aiMs");
  const frame = await prisma.frame.create({
    data: {
      streamId: stream.id,
      tsSec: input.tsSec,
      dHash: input.dHash,
      processed: true,
      provider: source === "ai" ? provider : source,
      latencyMs: Date.now() - started,
    },
  });

  // 3) Tracker: turn this frame's items into stable detections.
  const newlyVisibleIds: string[] = [];
  let newCandidates = false;
  if (result && result.items.length > 0) {
    // Hot path uses cached embeddings only (one query, no API call). Labels not yet
    // embedded fall back to word overlap now and get embedded in the background
    // (backfillEmbeddings), so the next frame has them.
    const vectors = await cachedEmbeddings(result.items.map((i) => embeddingText(i.label, i.category, i.attributes)));
    const incoming = result.items.map((item, i) => ({ item, embedding: vectors[i] }));

    await prisma.$transaction(async (tx) => {
      await lockRow(tx, "Stream", stream.id); // one tracker step per stream at a time
      const rows = await tx.$queryRaw<
        Array<Omit<TrackedDetection, "embedding"> & { emb: string | null }>
      >`SELECT id, label, category, hits, "firstSeenSec", "lastSeenSec", confidence, state, embedding::text AS emb
        FROM "Detection" WHERE "streamId" = ${stream.id}`;
      const existing: TrackedDetection[] = rows.map((r) => ({ ...r, embedding: r.emb ? (JSON.parse(r.emb) as number[]) : null }));

      const ops = track(existing, incoming, input.tsSec, {
        ...DEFAULT_TRACKER,
        minConfidence: env.DETECTION_MIN_CONFIDENCE,
        maxVisible: env.MAX_VISIBLE_PRODUCTS,
        fastLaneConfidence: env.DETECTION_FAST_LANE_CONFIDENCE,
        fastLaneProminence: env.DETECTION_FAST_LANE_PROMINENCE,
      });

      for (const op of ops) {
        if (op.kind === "create") {
          const d = await tx.detection.create({
            data: {
              streamId: stream.id,
              label: op.item.label,
              category: op.item.category,
              attributes: op.item.attributes,
              bbox: op.item.bbox,
              confidence: op.item.confidence,
              hits: 1,
              firstSeenSec: op.tsSec,
              lastSeenSec: op.tsSec,
              state: op.state,
              mentionedInAudio: op.item.mentionedInAudio,
              bestFrameId: frame.id,
            },
          });
          if (op.embedding) {
            await tx.$executeRaw`UPDATE "Detection" SET embedding = ${JSON.stringify(op.embedding)}::vector WHERE id = ${d.id}`;
          }
          if (op.state === "visible") {
            await auditVisible(tx, d.id, op.item.label, op.tsSec);
            newlyVisibleIds.push(d.id);
          } else {
            newCandidates = true;
          }
        } else {
          await tx.detection.update({
            where: { id: op.id },
            data: {
              hits: op.hits,
              lastSeenSec: op.lastSeenSec,
              confidence: op.confidence,
              state: op.state,
              bbox: op.item.bbox,
              ...(op.item.mentionedInAudio ? { mentionedInAudio: true } : {}),
              ...(op.becameVisible ? { bestFrameId: frame.id } : {}),
            },
          });
          if (op.becameVisible) {
            await auditVisible(tx, op.id, op.item.label, op.lastSeenSec);
            newlyVisibleIds.push(op.id);
          } else if (op.state === "candidate") {
            newCandidates = true;
          }
        }
      }
    // Neon round-trips add up; from a dev machine far from the DB region one frame took
    // 22 s (2026-10-23). In production (same region) this finishes in well under a second.
    }, { timeout: 30_000, maxWait: 10_000 });
    emitRailChanged(stream.id);
  }

  lap("trackerMs");

  // 4) Tell the client how fast to sample next, based on remaining free quota.
  // With a backup configured, sampling slows down only when both budgets are low.
  if (mode === "normal") {
    const primary = selectProvider(aiOverride);
    const modes: BudgetMode[] = [];
    for (const p of [primary, backupProvider(primary)]) {
      if (p) modes.push(p.budgetKey ? (await peek(p.budgetKey)).mode : "normal");
    }
    if (modes.length) mode = modes.reduce((best, m) => (MODE_RANK[m] < MODE_RANK[best] ? m : best));
  }
  if (mode !== "normal") void notifySaverOnce(stream.creatorId, mode);
  let nextIntervalSec = frameIntervalFor(mode, stream.frameIntervalSec);
  // A new candidate needs a second sighting to show; look again soon so it appears
  // within seconds instead of a full interval later.
  if (newCandidates && nextIntervalSec !== null) nextIntervalSec = Math.min(nextIntervalSec, 2);

  return {
    source,
    provider,
    mode,
    note,
    latencyMs: Date.now() - started,
    timings,
    itemsSeen: result?.items.length ?? 0,
    nextIntervalSec,
    detections: await listDetections(stream.id, input.tsSec),
    newlyVisibleIds,
  };
}

/** "Free-tier saver mode" heads-up, at most once a day per creator. */
async function notifySaverOnce(creatorId: string, mode: BudgetMode) {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const recent = await prisma.notification.findFirst({ where: { creatorId, type: "budget.saver_mode", createdAt: { gte: since } } });
  if (recent) return;
  await notify(creatorId, "budget.saver_mode", {
    title: mode === "cache_only" ? "Free AI quota used up for today" : "Free-tier saver mode on",
    body:
      mode === "cache_only"
        ? "Seen is using cached results until the quota resets. Products already detected stay shoppable."
        : "You're close to today's free AI limit, so Seen is sampling less often.",
    data: { mode },
  });
}

async function auditVisible(tx: Parameters<typeof audit>[0], id: string, label: string, tsSec: number) {
  await audit(tx, { entityType: "Detection", entityId: id, type: "detection.visible", source: "ai", payload: { label, tsSec } });
}

export async function listDetections(streamId: string, currentTsSec?: number): Promise<DetectionView[]> {
  const rows = await prisma.detection.findMany({
    where: { streamId },
    orderBy: [{ firstSeenSec: "asc" }],
  });
  return rows.map((d) => ({
    id: d.id,
    label: d.label,
    category: d.category,
    state: d.state,
    confidence: d.confidence,
    hits: d.hits,
    bbox: (d.bbox as [number, number, number, number] | null) ?? null,
    lastSeenSec: d.lastSeenSec,
    inFrame: currentTsSec !== undefined && d.lastSeenSec === currentTsSec,
  }));
}
