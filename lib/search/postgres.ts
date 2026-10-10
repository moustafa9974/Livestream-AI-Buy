import { prisma } from "../db";
import { searchWords, type ProductSearch, type SearchHit } from "./types";

/**
 * Fallback search, always available: Postgres full-text (OR of query words, so
 * "black hooded sweatshirt" still finds "Hoodie") unioned with pgvector nearest
 * neighbours. Works on Neon's free tier with no extra services.
 */
export const postgresSearch: ProductSearch = {
  name: "postgres",
  async search({ text, embedding, limit }) {
    const hits = new Map<string, SearchHit>();

    if (embedding) {
      const vec = JSON.stringify(embedding);
      const rows = await prisma.$queryRaw<Array<{ id: string; cos: number }>>`
        SELECT id, 1 - (embedding <=> ${vec}::vector) AS cos
        FROM "PartnerProduct"
        WHERE embedding IS NOT NULL AND stock > 0
        ORDER BY embedding <=> ${vec}::vector
        LIMIT ${limit}`;
      for (const r of rows) hits.set(r.id, { productId: r.id, vectorScore: Number(r.cos) });
    }

    const words = searchWords(text);
    if (words.length > 0) {
      // Words are [a-z0-9] only (searchWords), so this OR-query can't inject tsquery syntax.
      const tsq = words.join(" | ");
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "PartnerProduct"
        WHERE stock > 0 AND to_tsvector('english', title || ' ' || description || ' ' || category || ' ' || attributes::text)
              @@ to_tsquery('english', ${tsq})
        ORDER BY ts_rank_cd(to_tsvector('english', title || ' ' || description || ' ' || category || ' ' || attributes::text),
                            to_tsquery('english', ${tsq})) DESC
        LIMIT ${limit}`;
      for (const r of rows) if (!hits.has(r.id)) hits.set(r.id, { productId: r.id, vectorScore: null });
    }

    // Text-only candidates still get a vector score when both vectors exist.
    const missing = [...hits.values()].filter((h) => h.vectorScore === null).map((h) => h.productId);
    if (embedding && missing.length) {
      const vec = JSON.stringify(embedding);
      const rows = await prisma.$queryRaw<Array<{ id: string; cos: number }>>`
        SELECT id, 1 - (embedding <=> ${vec}::vector) AS cos FROM "PartnerProduct"
        WHERE id = ANY(${missing}) AND embedding IS NOT NULL`;
      for (const r of rows) hits.set(r.id, { productId: r.id, vectorScore: Number(r.cos) });
    }
    return [...hits.values()];
  },
};
