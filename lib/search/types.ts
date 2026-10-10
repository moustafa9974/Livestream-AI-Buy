/**
 * Product search over the partner catalog. Two implementations share this interface:
 * Elastic (BM25 + kNN) and Postgres (full-text + pgvector). Both only *retrieve*
 * candidates with raw signals; ranking happens once in lib/matching so results are
 * identical whichever backend answered.
 */
export interface SearchQuery {
  text: string;
  embedding: number[] | null;
  limit: number;
}

export interface SearchHit {
  productId: string;
  /** Cosine similarity of query vs product embedding, or null if unavailable. */
  vectorScore: number | null;
}

export interface ProductSearch {
  name: "elastic" | "postgres";
  search(q: SearchQuery): Promise<SearchHit[]>;
}

/** Text used to embed both products and detections, so their vectors are comparable. */
export function embeddingText(name: string, category: string, attributes: Record<string, unknown>): string {
  const attrs = Object.values(attributes).filter((v) => typeof v === "string").join(" ");
  return `${name} | ${category} | ${attrs}`.toLowerCase();
}

/** Lowercase alphanumeric words, crude singular, minus stopwords. Shared by both backends. */
const STOP = new Set(["a", "an", "the", "and", "with", "of", "in", "on", "for", "by", "via"]);
export function searchWords(s: string): string[] {
  return [
    ...new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 1 && !STOP.has(w))
        .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
    ),
  ];
}
