import "dotenv/config";
import { beforeAll } from "vitest";
import { prisma } from "./db";

// Neon's free compute sleeps after ~5 idle minutes and takes a few seconds to wake.
// Wake it before any test so the first real query doesn't time out.
beforeAll(async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}, 60_000);
