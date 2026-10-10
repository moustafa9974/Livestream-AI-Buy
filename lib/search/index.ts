import { isEnabled } from "../flags";
import { elasticSearch } from "./elastic";
import { postgresSearch } from "./postgres";
import type { SearchHit, SearchQuery } from "./types";

/**
 * Search with Elastic when enabled, falling back to Postgres on any error so the rail
 * never stalls because a sponsor service is down or out of trial.
 */
export async function searchProducts(q: SearchQuery): Promise<{ backend: "elastic" | "postgres"; hits: SearchHit[] }> {
  if (isEnabled("elastic")) {
    try {
      return { backend: "elastic", hits: await elasticSearch.search(q) };
    } catch (err) {
      console.warn("[search] Elastic failed, using Postgres:", err instanceof Error ? err.message : err);
    }
  }
  return { backend: "postgres", hits: await postgresSearch.search(q) };
}
