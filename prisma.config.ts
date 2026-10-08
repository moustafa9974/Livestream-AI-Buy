import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Migrations need a direct (non-pooled) connection: Neon's pooler runs PgBouncer in
 * transaction mode, which breaks the advisory locks `prisma migrate` uses. The app
 * itself keeps using the pooled DATABASE_URL at runtime.
 * DIRECT_DATABASE_URL wins if set; otherwise Neon's direct host is the pooled host
 * without "-pooler". Non-Neon URLs (e.g. local Docker) pass through unchanged.
 */
function migrationUrl(): string {
  const direct = process.env.DIRECT_DATABASE_URL;
  if (direct) return direct;
  return env("DATABASE_URL").replace("-pooler.", ".");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: migrationUrl(),
  },
});
