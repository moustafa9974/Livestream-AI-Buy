import type { Prisma } from "@/generated/prisma/client";
import { cachedEmbeddings, embedText } from "../ai/embeddings";
import { findSimilarItems } from "../channel3/client";
import { prisma } from "../db";
import { getEnv } from "../env";
import { emitRailChanged } from "../realtime/bus";
import { searchProducts } from "../search";
import { embeddingText } from "../search/types";
import { classify, scoreCandidate } from "./score";

/**
 * Product matcher (SPEC §3): detection → best partner product ("Buy with PayPal") +
 * up to 3 Channel3 similar items ("View similar"). Replaces the detection's previous
 * matches, so re-running (e.g. after a label correction) is safe.
 *
 * `embed: "cached"` never calls the embedding API (fast first pass: cached vector or
 * text-only scoring); `"api"` embeds if needed (accurate second pass).
 */
export async function matchDetection(
  detectionId: string,
  embed: "cached" | "api" = "api",
): Promise<{ kind: "exact" | "similar" | null; backend: string; usedVector: boolean }> {
  const env = getEnv();
  const rows = await prisma.$queryRaw<
    Array<{ id: string; streamId: string; label: string; category: string; attributes: Record<string, string>; emb: string | null }>
  >`SELECT id, "streamId", label, category, attributes, embedding::text AS emb FROM "Detection" WHERE id = ${detectionId}`;
  const d = rows[0];
  if (!d) return { kind: null, backend: "none", usedVector: false };

  const attributes = d.attributes ?? {};
  const embText = embeddingText(d.label, d.category, attributes);
  const embedding = d.emb
    ? (JSON.parse(d.emb) as number[])
    : embed === "api"
      ? await embedText(embText)
      : (await cachedEmbeddings([embText]))[0];
  if (!d.emb && embedding) {
    await prisma.$executeRaw`UPDATE "Detection" SET embedding = ${JSON.stringify(embedding)}::vector WHERE id = ${detectionId}`;
  }
  const text = `${d.label} ${d.category.replace(/\//g, " ")} ${Object.values(attributes).join(" ")}`;

  // Channel3 (an outside API, up to a few seconds) runs alongside but doesn't hold up the
  // Buy now card: the partner match is saved and pushed to viewers first.
  const similarPromise = findSimilarItems(`${attributes.color ?? ""} ${d.label}`, 3).catch(() => []);
  const { backend, hits } = await searchProducts({ text, embedding, limit: 10 });

  const products = await prisma.partnerProduct.findMany({ where: { id: { in: hits.map((h) => h.productId) } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const thresholds = embedding
    ? { exact: env.MATCH_EXACT_SCORE, similar: env.MATCH_SIMILAR_SCORE }
    : { exact: env.MATCH_TEXT_EXACT_SCORE, similar: env.MATCH_TEXT_SIMILAR_SCORE };

  let best: { productId: string; score: number; kind: "exact" | "similar" } | null = null;
  for (const h of hits) {
    const p = byId.get(h.productId);
    if (!p) continue;
    const s = scoreCandidate(
      { label: d.label, category: d.category, attributes },
      { title: p.title, category: p.category, attributes: (p.attributes ?? {}) as Record<string, string> },
      embedding ? h.vectorScore : null,
    );
    const kind = classify(s, thresholds);
    if (kind && (!best || s.score > best.score)) best = { productId: p.id, score: s.score, kind };
  }

  // 1) Partner match now: this is what gives viewers the Buy now card.
  await prisma.$transaction(async (tx) => {
    await tx.productMatch.deleteMany({ where: { detectionId, source: "partner" } });
    if (best) {
      await tx.productMatch.create({
        data: { detectionId, source: "partner", partnerProductId: best.productId, score: best.score, kind: best.kind },
      });
    }
    await tx.detection.update({ where: { id: detectionId }, data: { updatedAt: new Date() } });
  });
  emitRailChanged(d.streamId);

  // 2) Open-web "similar items" when Channel3 answers (replacing any from a previous match).
  const similar = await similarPromise;
  await prisma.$transaction(async (tx) => {
    await tx.productMatch.deleteMany({ where: { detectionId, source: "channel3" } });
    for (const [i, s] of similar.entries()) {
      await tx.productMatch.create({
        data: {
          detectionId,
          source: "channel3",
          externalRef: s as unknown as Prisma.InputJsonValue,
          score: 1 - i * 0.1, // rank order from Channel3
          kind: "similar",
        },
      });
    }
    // Touch the detection so rail version checks see the change.
    await tx.detection.update({ where: { id: detectionId }, data: { updatedAt: new Date() } });
  });

  emitRailChanged(d.streamId);
  return { kind: best?.kind ?? null, backend, usedVector: embedding !== null };
}

const MATCH_CONCURRENCY = 4;

/**
 * Matches in small parallel batches; failures never break the rail. Returns the ids
 * that were matched without an embedding (text-only), so a second pass can refine them.
 */
export async function matchDetections(ids: string[], embed: "cached" | "api" = "api"): Promise<string[]> {
  const textOnly: string[] = [];
  for (let i = 0; i < ids.length; i += MATCH_CONCURRENCY) {
    await Promise.all(
      ids.slice(i, i + MATCH_CONCURRENCY).map((id) =>
        matchDetection(id, embed)
          .then((r) => void (r.usedVector || textOnly.push(id)))
          .catch((err) => console.warn("[match]", id, err instanceof Error ? err.message : err)),
      ),
    );
  }
  return textOnly;
}

/**
 * After a frame: show a card fast (cached vectors / text), then embed new labels and
 * re-match the ones that were text-only. Matching never blocks the frame response.
 */
export async function matchNewlyVisible(streamId: string, ids: string[]): Promise<void> {
  const textOnly = ids.length ? await matchDetections(ids, "cached") : [];
  await backfillEmbeddings(streamId).catch(() => {});
  if (textOnly.length) await matchDetections(textOnly, "api");
}

/**
 * Embeds a stream's detections that don't have a vector yet (background, after the
 * frame response). Warms the embedding cache so the next frame's dedupe is semantic.
 */
export async function backfillEmbeddings(streamId: string): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ id: string; label: string; category: string; attributes: Record<string, string> }>>`
    SELECT id, label, category, attributes FROM "Detection"
    WHERE "streamId" = ${streamId} AND embedding IS NULL AND state <> 'hidden' LIMIT 10`;
  await Promise.all(
    rows.map(async (d) => {
      const vec = await embedText(embeddingText(d.label, d.category, d.attributes ?? {}));
      if (vec) await prisma.$executeRaw`UPDATE "Detection" SET embedding = ${JSON.stringify(vec)}::vector WHERE id = ${d.id} AND embedding IS NULL`;
    }),
  );
}
