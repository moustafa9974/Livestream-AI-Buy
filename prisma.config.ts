import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * The local Docker database from docker-compose.yml / .env.example. Used when no
 * DATABASE_URL is set, because `npm install` runs `prisma generate` (which needs no
 * database) before a fresh clone has a .env: requiring the variable made the very
 * first setup command fail.
 */
const LOCAL_DOCKER_URL = "postgresql://seen:seen@localhost:5432/seen";

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
  return (process.env.DATABASE_URL || LOCAL_DOCKER_URL).replace("-pooler.", ".");
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
