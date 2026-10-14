import { priceComparison, type SimilarItem } from "./channel3/parse";
import { prisma } from "./db";

/**
 * What viewers see next to the video: confirmed (visible/pinned) detections with their
 * partner product and open-web similar items. Hidden items never appear. Prices come
 * from the DB (partner) or Channel3 offers (links only), never from the AI.
 */

export interface RailItem {
  detectionId: string;
  label: string;
  state: "visible" | "pinned";
  firstSeenSec: number;
  lastSeenSec: number;
  bbox: [number, number, number, number] | null;
  partner: {
    productId: string;
    title: string;
    merchantName: string;
    priceMinor: number;
    currency: string;
    image: string | null;
    kind: "exact" | "similar";
  } | null;
  similar: SimilarItem[];
  comparison: { similarMedianMinor: number; savingsMinor: number } | null;
}

export interface Rail {
  streamId: string;
  status: string;
  version: string;
  items: RailItem[];
}

/** Cheap change detector for SSE polling: count + latest update across detections. */
export async function railVersion(streamId: string): Promise<string> {
  const agg = await prisma.detection.aggregate({ where: { streamId }, _count: true, _max: { updatedAt: true } });
  return `${agg._count}:${agg._max.updatedAt?.getTime() ?? 0}`;
}

export async function getRail(streamId: string): Promise<Rail> {
  const [stream, version, detections] = await Promise.all([
    prisma.stream.findUniqueOrThrow({ where: { id: streamId } }),
    railVersion(streamId),
    prisma.detection.findMany({
      where: { streamId, state: { in: ["visible", "pinned"] } },
      include: { matches: { include: { partnerProduct: { include: { merchant: true } } } } },
    }),
  ]);

  const all: RailItem[] = detections.map((d) => {
    const pm = d.matches.find((m) => m.source === "partner" && m.partnerProduct);
    const p = pm?.partnerProduct ?? null;
    const similar = d.matches
      .filter((m) => m.source === "channel3" && m.externalRef)
      .sort((a, b) => b.score - a.score)
      .map((m) => m.externalRef as unknown as SimilarItem);
    return {
      detectionId: d.id,
      label: d.label,
      state: d.state as "visible" | "pinned",
      firstSeenSec: d.firstSeenSec,
      lastSeenSec: d.lastSeenSec,
      bbox: (d.bbox as [number, number, number, number] | null) ?? null,
      partner:
        p && pm
          ? {
              productId: p.id,
              title: p.title,
              merchantName: p.merchant.name,
              priceMinor: p.priceMinor,
              currency: p.currency,
              image: p.images[0] ?? null,
              kind: pm.kind,
            }
          : null,
      similar,
      comparison: p ? priceComparison(p.priceMinor, p.currency, similar) : null,
    };
  });

  // Viewers see things they can act on (a partner product, or similar items elsewhere),
  // plus anything the creator pinned: a pin means "show this", even before it's buyable.
  // The studio still lists every detection (lib/vision listDetections).
  const items = all.filter((i) => i.partner || i.similar.length > 0 || i.state === "pinned");

  // Pinned first, then most recently seen: the thing on screen now is at the top.
  items.sort((a, b) => (a.state === b.state ? b.lastSeenSec - a.lastSeenSec : a.state === "pinned" ? -1 : 1));
  return { streamId, status: stream.status, version, items };
}

/** The stream a creator's viewer page follows: live first, then idle, then latest. */
export async function currentStreamFor(creatorId: string) {
  return (
    (await prisma.stream.findFirst({ where: { creatorId, status: "live" }, orderBy: { startedAt: "desc" } })) ??
    (await prisma.stream.findFirst({ where: { creatorId, status: "idle" }, orderBy: { createdAt: "desc" } })) ??
    (await prisma.stream.findFirst({ where: { creatorId }, orderBy: { createdAt: "desc" } }))
  );
}
