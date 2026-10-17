/**
 * `npm run db:seed` / `npm run demo:reset`: deterministic demo data (lib/demo/seed.ts).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { seedDemo } from "../lib/demo/seed";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

seedDemo(prisma)
  .then((r) => console.log("Seeded demo data:", { ...r.counts, demoCacheFrames: r.demoCacheFrames, productEmbeddings: r.productEmbeddings }))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
