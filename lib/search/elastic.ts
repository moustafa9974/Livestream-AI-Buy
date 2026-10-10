import { Client } from "@elastic/elasticsearch";
import { prisma } from "../db";
import { getEnv } from "../env";
import { searchWords, type ProductSearch, type SearchHit } from "./types";

/**
 * Elastic backend. Hybrid = a BM25 multi_match plus a kNN query on Gemini embeddings,
 * merged in our code. We deliberately don't use the RRF/linear retrievers: they need
 * an Enterprise license and return 403 on the free Basic license (local Docker), while
 * plain `query` and `knn` work on every license.
 *
 * Embeddings come from Gemini (dense_vector, cosine), so this also works without
 * Elastic's paid ML/semantic features.
 */

export const PRODUCT_INDEX = "partner_products";

let client: Client | undefined;

function es(): Client {
  const env = getEnv();
  client ??= new Client({
    node: env.ELASTIC_URL!,
    ...(env.ELASTIC_API_KEY ? { auth: { apiKey: env.ELASTIC_API_KEY } } : {}),
    requestTimeout: 5000,
    maxRetries: 1,
  });
  return client;
}

interface ProductDoc {
  title: string;
  description: string;
  category: string;
  attributes: string;
  merchant: string;
  in_stock: boolean;
  embedding?: number[];
}

/** (Re)creates the index and loads every partner product. `npm run search:index`. */
export async function reindexProducts(): Promise<number> {
  const env = getEnv();
  const c = es();
  if (await c.indices.exists({ index: PRODUCT_INDEX })) await c.indices.delete({ index: PRODUCT_INDEX });
  await c.indices.create({
    index: PRODUCT_INDEX,
    mappings: {
      properties: {
        title: { type: "text" },
        description: { type: "text" },
        category: { type: "text", fields: { raw: { type: "keyword" } } },
        attributes: { type: "text" },
        merchant: { type: "keyword" },
        in_stock: { type: "boolean" },
        embedding: { type: "dense_vector", dims: env.EMBEDDING_DIM, index: true, similarity: "cosine" },
      },
    },
  });

  const products = await prisma.$queryRaw<
    Array<{ id: string; title: string; description: string; category: string; attributes: Record<string, string>; merchant: string; stock: number; emb: string | null }>
  >`SELECT p.id, p.title, p.description, p.category, p.attributes, m.name AS merchant, p.stock, p.embedding::text AS emb
    FROM "PartnerProduct" p JOIN "Merchant" m ON m.id = p."merchantId"`;

  const operations = products.flatMap((p) => {
    const doc: ProductDoc = {
      title: p.title,
      description: p.description,
      category: p.category.replace(/\//g, " "),
      attributes: Object.values(p.attributes ?? {}).join(" "),
      merchant: p.merchant,
      in_stock: p.stock > 0,
      ...(p.emb ? { embedding: JSON.parse(p.emb) as number[] } : {}),
    };
    return [{ index: { _index: PRODUCT_INDEX, _id: p.id } }, doc];
  });
  if (operations.length) await c.bulk({ operations, refresh: true });
  return products.length;
}

export const elasticSearch: ProductSearch = {
  name: "elastic",
  async search({ text, embedding, limit }) {
    const c = es();
    const hits = new Map<string, SearchHit>();
    const words = searchWords(text).join(" ");

    const [bm25, knn] = await Promise.all([
      words
        ? c.search<ProductDoc>({
            index: PRODUCT_INDEX,
            size: limit,
            _source: false,
            query: {
              bool: {
                filter: [{ term: { in_stock: true } }],
                must: [{ multi_match: { query: words, fields: ["title^3", "category^2", "attributes^2", "description"], operator: "or" } }],
              },
            },
          })
        : null,
      embedding
        ? c.search<ProductDoc>({
            index: PRODUCT_INDEX,
            size: limit,
            _source: false,
            knn: { field: "embedding", query_vector: embedding, k: limit, num_candidates: Math.max(50, limit * 5), filter: { term: { in_stock: true } } },
          })
        : null,
    ]);

    // For cosine, Elastic's kNN _score is (1 + cos) / 2; convert back to cosine.
    for (const h of knn?.hits.hits ?? []) {
      if (h._id) hits.set(h._id, { productId: h._id, vectorScore: 2 * (h._score ?? 0) - 1 });
    }
    for (const h of bm25?.hits.hits ?? []) {
      if (h._id && !hits.has(h._id)) hits.set(h._id, { productId: h._id, vectorScore: null });
    }
    return [...hits.values()];
  },
};
