import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { getEnv } from "./env";

const VIEWER_COOKIE = "seen_viewer";

/** Anonymous viewer identity (cookie → ViewerSession row). No login, no PII. */
export async function getOrCreateViewerSession(locale = "en") {
  const jar = await cookies();
  let anonId = jar.get(VIEWER_COOKIE)?.value;
  if (!anonId) {
    anonId = randomUUID();
    jar.set(VIEWER_COOKIE, anonId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }
  return prisma.viewerSession.upsert({
    where: { anonId },
    create: { anonId, locale },
    update: {},
  });
}

export const DEMO_CREATOR_SLUG = "maya-makes";

/**
 * The logged-in creator. Until real auth exists (Phase 5), DEMO_MODE auto-logs-in the
 * demo creator so judges need no signup; with DEMO_MODE off, studio APIs are closed.
 */
export async function getCurrentCreator() {
  if (!getEnv().DEMO_MODE) return null;
  return prisma.creator.findUnique({ where: { slug: DEMO_CREATOR_SLUG } });
}
