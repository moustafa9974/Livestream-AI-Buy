"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 3000;

/**
 * Keeps the earnings page live: when a sale lands or a payout/refund changes a row, the
 * server data is refreshed in place (no reload). The AG Grids then update by row id, so
 * new sales animate in and changed cells flash instead of the table re-drawing.
 */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    let stop = false;
    let last: string | null = null;
    async function tick() {
      // Skip hidden tabs: nobody is watching, and it saves database round trips.
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch("/api/studio/earnings/version", { cache: "no-store" });
          if (res.ok) {
            const { version } = (await res.json()) as { version: string };
            if (last !== null && version !== last) router.refresh();
            last = version;
          }
        } catch {
          // Offline for a moment: try again next tick.
        }
      }
      if (!stop) setTimeout(tick, POLL_MS);
    }
    void tick();
    return () => {
      stop = true;
    };
  }, [router]);

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" aria-hidden />
      Live: updates as sales come in
    </span>
  );
}
