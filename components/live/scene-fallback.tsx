import { ProductThumb } from "@/components/app/product-thumb";
import type { RailItem } from "@/lib/rail";

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/**
 * Shown on the video stage when there's no video to play (no recording yet, or a stream
 * whose video lives elsewhere): an "AI scene" of what Seen spotted in this stream, each
 * product framed the way the AI framed it, with the moment it appeared. It shows the
 * product's magic instead of an empty black box.
 */
export function SceneFallback({ items, live, creatorName }: { items: RailItem[]; live: boolean; creatorName: string }) {
  const shown = [...items].sort((a, b) => a.firstSeenSec - b.firstSeenSec).slice(0, 6);
  return (
    // aria-hidden: a visual mirror of the product rail, which is the accessible list
    // (screen readers would otherwise hear every product twice).
    <div aria-hidden className="absolute inset-0 flex flex-col p-4 pt-12 sm:p-6 sm:pt-14">
      <div className="hero-scan pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-[oklch(0.74_0.16_225/0.14)] to-transparent" />
      <p className="relative mb-3 text-center text-xs font-medium uppercase tracking-[0.18em] text-white/60">
        {live ? `AI is watching ${creatorName}'s stream` : (
          <>
            AI scene<span className="hidden sm:inline"> · what Seen spotted in this stream</span>
          </>
        )}
      </p>
      {shown.length === 0 ? (
        <p className="relative m-auto max-w-xs text-center text-sm text-white/75">
          {live ? "Products appear here and in the list as soon as the AI spots them." : "Nothing spotted in this stream yet."}
        </p>
      ) : (
        <ul className="relative grid flex-1 grid-cols-3 content-center gap-3 sm:gap-5">
          {shown.map((i, n) => (
            <li
              key={i.detectionId}
              className={`relative grid place-items-center rounded-xl border-2 ${n >= 3 ? "max-sm:hidden" : ""} border-white/80 p-3 shadow-[0_0_0_3px_oklch(0.6_0.25_300/0.3),0_0_24px_oklch(0.6_0.25_300/0.35)] motion-safe:animate-[rail-in_500ms_ease-out_both]`}
              style={{ animationDelay: `${n * 120}ms` }}
            >
              <span className="absolute -top-3 left-2 max-w-[90%] truncate rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold text-neutral-900 shadow sm:text-[11px]">
                {i.label}
              </span>
              <ProductThumb title={i.partner?.title ?? i.label} image={i.partner?.image} className="size-12 sm:size-16" />
              <span className="mt-1.5 text-[10px] tabular-nums text-white/60 sm:text-xs">spotted at {mmss(i.firstSeenSec)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
