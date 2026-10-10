import { embedText } from "../ai/embeddings";
import { prisma } from "../db";
import { embeddingText } from "./types";

/**
 * Fills PartnerProduct.embedding for products that don't have one yet. Embeddings
 * are cached by text hash, so re-running after a reseed costs no quota.
 */
export async function embedCatalog(): Promise<{ embedded: number; skipped: number }> {
  const missing = await prisma.$queryRaw<Array<{ id: string; title: string; category: string; attributes: Record<string, string> }>>`
    SELECT id, title, category, attributes FROM "PartnerProduct" WHERE embedding IS NULL`;
  let embedded = 0;
  for (const p of missing) {
    // Title without the ": Colour" suffix reads like what the camera sees.
    const name = p.title.split(":")[0];
    const vec = await embedText(embeddingText(name, p.category, p.attributes ?? {}));
    if (!vec) continue;
    await prisma.$executeRaw`UPDATE "PartnerProduct" SET embedding = ${JSON.stringify(vec)}::vector WHERE id = ${p.id}`;
    embedded++;
  }
  return { embedded, skipped: missing.length - embedded };
}
