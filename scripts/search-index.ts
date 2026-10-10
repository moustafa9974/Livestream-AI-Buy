/**
 * Rebuilds the Elastic product index from the DB: `npm run search:index`.
 * Needs ELASTIC_URL (+ ELASTIC_API_KEY for Elastic Cloud). Run after db:seed.
 */
import "dotenv/config";
import { prisma } from "../lib/db";
import { reindexProducts } from "../lib/search/elastic";

reindexProducts()
  .then((n) => console.log(`Indexed ${n} partner products into Elastic`))
  .catch((err) => {
    console.error("Elastic reindex failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
