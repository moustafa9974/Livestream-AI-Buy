import { connection } from "next/server";
import { prisma } from "@/lib/db";
import { allFeatureStatuses } from "@/lib/flags";

/**
 * Render health check + a judge-friendly status page. Reports which features are on
 * and why others are off. Feature reasons never include secret values (see lib/flags).
 */
export async function GET() {
  await connection(); // always run at request time, never prerendered

  let db: "ok" | "down" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "down";
  }

  return Response.json(
    { status: db === "ok" ? "ok" : "degraded", db, features: allFeatureStatuses() },
    { status: db === "ok" ? 200 : 503 },
  );
}
