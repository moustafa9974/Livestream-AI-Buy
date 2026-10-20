import { timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";

/** Bearer-token check for the Astropods watcher agent (constant-time). */
export function watcherAuthorized(req: Request): boolean {
  const expected = getEnv().WATCHER_TOKEN;
  if (!expected) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });
