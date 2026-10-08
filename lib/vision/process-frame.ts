import type { DetectionState } from "@/generated/prisma/enums";
import { embedText } from "../ai/embeddings";
import { selectProvider } from "../ai/providers";
import { analyzeFrame } from "../ai/vision";
import type { VisionResult } from "../ai/vision-schema";
import { consume, frameIntervalFor, peek, type BudgetMode } from "../budget";
import { audit, lockRow } from "../commerce/db";
import { prisma } from "../db";
import { getEnv } from "../env";
import { DEFAULT_TRACKER, track, type TrackedDetection } from "./tracker";
import { getCachedVision, getNearestVision, putCachedVision } from "./vision-cache";

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
  itemsSeen: number;
  nextIntervalSec: number | null;
  detections: DetectionView[];
}

export class FrameError extends Error {
  constructor(readonly code: "NOT_FOUND" | "NOT_LIVE", message: string) {
    super(message);
  }
}

export async function processFrame(input: FrameInput): Promise<FrameOutcome> {
  const env = getEnv();
  const started = Date.now();
  const stream = await prisma.stream.findUnique({ where: { id: input.streamId } });
  if (!stream) throw new FrameError("NOT_FOUND", "Stream not found");
  if (stream.status !== "live") throw new FrameError("NOT_LIVE", "Stream is not live");

  // 1) Cache first: never pay quota twice for the same picture.
  let result: VisionResult | null = null;
  let source: FrameOutcome["source"] = "none";
  let provider: string | null = null;
  let note: string | undefined;
  let mode: BudgetMode = "normal";

  const exact = await getCachedVision(input.dHash);
  if (exact) {
    result = exact.result;
    source = "cache";
    provider = exact.provider;
  } else if (env.DEMO_CACHE) {
    const near = await getNearestVision(input.dHash, env.DEMO_CACHE_MAX_DISTANCE);
    if (near) {
      result = near.result;
      source = "demo_cache";
      provider = near.provider;
    }
  }

  // 2) Otherwise ask the AI, if one is configured and the budget allows.
  if (!result) {
    const ai = selectProvider();
    if (!ai) {
      note = "No AI provider configured";
    } else if (!input.imageJpegBase64) {
      note = "No image sent";
    } else {
      const budget = ai.budgetKey ? await consume(ai.budgetKey) : null;
      if (budget && !budget.allowed) {
        mode = "cache_only";
        note = "Free-tier limit reached: using cached results only";
      } else {
        try {
          const out = await analyzeFrame(
            ai,
            input.imageJpegBase64,
            { streamTitle: stream.title, transcript: input.transcript },
            env.VISION_TIMEOUT_MS,
          );
          result = out.result;
          source = "ai";
          provider = out.provider;
          await putCachedVision(input.dHash, { result, provider: out.provider });
        } catch (err) {
          note = "AI analysis failed for this frame";
          console.warn("[vision]", ai.name, err instanceof Error ? err.message : err);
        }
      }
    }
  }

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
  if (result && result.items.length > 0) {
    // Embeddings happen outside the transaction (network calls); null = word-overlap fallback.
    const incoming = await Promise.all(
      result.items.map(async (item) => ({
        item,
        embedding: await embedText(`${item.label} | ${item.category} | ${Object.values(item.attributes).join(" ")}`),
      })),
    );

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
          if (op.state === "visible") await auditVisible(tx, d.id, op.item.label, op.tsSec);
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
          if (op.becameVisible) await auditVisible(tx, op.id, op.item.label, op.lastSeenSec);
        }
      }
    }, { timeout: 15_000 }); // Neon round-trips add up; the default 5s is too tight
  }

  // 4) Tell the client how fast to sample next, based on remaining free quota.
  const ai = selectProvider();
  if (ai?.budgetKey && mode === "normal") mode = (await peek(ai.budgetKey)).mode;
  const nextIntervalSec = frameIntervalFor(mode, stream.frameIntervalSec);

  return {
    source,
    provider,
    mode,
    note,
    latencyMs: Date.now() - started,
    itemsSeen: result?.items.length ?? 0,
    nextIntervalSec,
    detections: await listDetections(stream.id, input.tsSec),
  };
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
