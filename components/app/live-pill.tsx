import { cn } from "@/lib/utils";

/** Status pill: pulsing red "Live now", or a quiet grey label (Offline, Replay…). */
export function LivePill({ live, idleLabel = "Offline", className }: { live: boolean; idleLabel?: string; className?: string }) {
  return live ? (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-live/10 px-2.5 py-1 text-xs font-semibold text-live", className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-live motion-safe:animate-[live-ping_1.4s_ease-out_infinite]" />
      Live now
    </span>
  ) : (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground", className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/50" />
      {idleLabel}
    </span>
  );
}
