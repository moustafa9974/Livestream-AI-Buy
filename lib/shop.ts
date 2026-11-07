import type { SimilarItem } from "./channel3/parse";
import { prisma } from "./db";
import { similarByProduct, similarFromMatches } from "./rail";

/**
 * Data for a product's page in Seen: the partner product (price and stock from the DB,
 * never from AI), its seller, where else it's sold online (Channel3 results already
 * stored for a detection of it, so the page costs no API calls), and the stream it was
 * spotted on, so a purchase from this page still credits the creator.
 */
export interface ProductPage {
  product: {
    id: string;
    title: string;
    description: string;
    category: string;
    priceMinor: number;
    currency: string;
    image: string | null;
    stock: number;
    attributes: Array<[string, string]>;
  };
  seller: { name: string };
  similar: SimilarItem[];
  /** Where the viewer came from; null when the page was opened directly. */
  from: { streamId: string; detectionId: string | null; tsSec: number; creatorSlug: string; creatorName: string } | null;
}

export async function getProductPage(
  productId: string,
  ctx: { streamId?: string; detectionId?: string; tsSec?: number },
): Promise<ProductPage | null> {
  const p = await prisma.partnerProduct.findUnique({ where: { id: productId }, include: { merchant: true } });
  if (!p) return null;

  // Only trust the stream/detection from the URL if they really belong together.
  const stream = ctx.streamId
    ? await prisma.stream.findUnique({ where: { id: ctx.streamId }, include: { creator: true } })
    : null;
  const detection = stream && ctx.detectionId
    ? await prisma.detection.findFirst({
        where: { id: ctx.detectionId, streamId: stream.id, state: { not: "hidden" } },
        include: { matches: true },
      })
    : null;
  const ownDetection = detection?.matches.some((m) => m.partnerProductId === p.id) ? detection : null;

  // Similar items: from the detection the viewer clicked, else the latest one of this
  // product that has some.
  const own = ownDetection ? similarFromMatches(ownDetection.matches) : [];
  const similar = own.length > 0 ? own : ((await similarByProduct([p.id])).get(p.id) ?? []);

  const attrs = (p.attributes && typeof p.attributes === "object" && !Array.isArray(p.attributes) ? p.attributes : {}) as Record<string, unknown>;

  return {
    product: {
      id: p.id,
      title: p.title,
      description: p.description,
      category: p.category,
      priceMinor: p.priceMinor,
      currency: p.currency,
      image: p.images[0] ?? null,
      stock: p.stock,
      attributes: Object.entries(attrs)
        .filter(([, v]) => typeof v === "string" || typeof v === "number")
        .map(([k, v]) => [k.replace(/_/g, " "), String(v)]),
    },
    seller: { name: p.merchant.name },
    similar,
    from: stream
      ? {
          streamId: stream.id,
          detectionId: ownDetection?.id ?? null,
          tsSec: Math.max(0, ctx.tsSec ?? 0),
          creatorSlug: stream.creator.slug,
          creatorName: stream.creator.displayName,
        }
      : null,
  };
}
