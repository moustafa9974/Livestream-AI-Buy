import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// DB integration tests: hit the real DATABASE_URL (with a fake PayPal). Sequential,
// because they share one database.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["**/*.db.test.ts"],
    setupFiles: ["lib/test-db-setup.ts"],
    exclude: ["node_modules", ".next"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
