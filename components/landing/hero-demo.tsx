import type { CSSProperties } from "react";
import { BadgeCheck, Coffee, Mic, Shirt } from "lucide-react";
import { ProductThumb } from "@/components/app/product-thumb";

/**
 * The landing hero, animated in pure CSS (no video, no JS): the AI's boxes lock onto
 * products on the stage, each product's card slides into the rail, then a "creator got
 * paid" toast pops. One 10-second loop; every element's timing is its own keyframe
 * (seq-a … seq-g in globals.css), so the whole scene stays in sync. People who turn off
 * motion see the finished frame.
 */

const seq = (name: string): CSSProperties => ({ animation: `${name} 10s cubic-bezier(.2,.8,.2,1) infinite` });

const OBJECTS = [
  // The "scene": products sitting on the creator's desk, drawn as lit glyphs.
  { Icon: Shirt, label: "black hoodie · 96%", box: "left-[8%] top-[24%] h-[46%] w-[42%]", icon: "size-28 sm:size-32", hue: 300, seq: "seq-a", right: false },
  { Icon: Coffee, label: "speckled mug · 93%", box: "right-[9%] top-[58%] h-[24%] w-[26%]", icon: "size-12 sm:size-14", hue: 45, seq: "seq-c", right: true },
  { Icon: Mic, label: "clip-on mic · 91%", box: "right-[12%] top-[16%] h-[26%] w-[20%]", icon: "size-11 sm:size-12", hue: 320, seq: "seq-e", right: true },
] as const;

const CARDS = [
  { title: "Oversized Hoodie: Black", merchant: "Northloop Apparel", price: "$45.00", seq: "seq-b" },
  { title: "Speckled Stoneware Mug", merchant: "Kiln & Co. Home", price: "$22.00", seq: "seq-d" },
  { title: "Clip-On Wireless Mic Kit", merchant: "Studio Signal", price: "$69.00", seq: "seq-f" },
];

export function HeroDemo() {
  return (
    <div aria-hidden className="relative">
      {/* Spotlight behind the device frame. */}
      <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-[radial-gradient(60%_60%_at_50%_40%,oklch(0.6_0.25_300/0.35),transparent_70%)] blur-2xl" />
      <div className="glass grid gap-3 rounded-[1.75rem] p-3 shadow-lift sm:grid-cols-[1fr_220px]">
        <div className="stage-dots relative aspect-[4/5] overflow-hidden rounded-2xl ring-1 ring-white/5 sm:aspect-auto sm:min-h-[380px]">
          <span className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-live px-2.5 py-1 text-[11px] font-bold tracking-wide text-white shadow-[0_0_20px_oklch(0.67_0.24_22/0.6)]">
            <span className="size-1.5 rounded-full bg-white motion-safe:animate-pulse" /> LIVE
          </span>
          <span className="glass absolute right-3 top-3 z-10 rounded-full px-2.5 py-1 text-[11px] text-white/85">1.2k watching</span>

          {/* AI scan line sweeping the frame. */}
          <div className="hero-scan pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-[oklch(0.74_0.16_225/0.18)] to-transparent" />

          {OBJECTS.map((o) => (
            <div key={o.label} className={`absolute ${o.box} grid place-items-center`}>
              <o.Icon
                className={o.icon}
                strokeWidth={1.25}
                style={{ color: `oklch(0.82 0.08 ${o.hue})`, filter: `drop-shadow(0 0 22px oklch(0.6 0.2 ${o.hue} / 0.55))` }}
              />
              <div className="hero-seq absolute inset-0 rounded-xl border-2 border-white/90 shadow-[0_0_0_4px_oklch(0.6_0.25_300/0.35),0_0_30px_oklch(0.6_0.25_300/0.45)]" style={seq(o.seq)}>
                <span className={`absolute -top-7 ${o.right ? "right-0" : "left-0"} whitespace-nowrap rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-neutral-900 shadow-lg`}>
                  {o.label}
                </span>
              </div>
            </div>
          ))}

          <div className="hero-seq glass absolute inset-x-4 bottom-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-white" style={seq("seq-g")}>
            <BadgeCheck className="size-4 shrink-0 text-success" />
            <span className="min-w-0 truncate">
              Paid · <b className="font-semibold">Maya earned $4.50</b>
            </span>
          </div>
        </div>

        <ul className="flex flex-col gap-2">
          {CARDS.map((c) => (
            <li key={c.title} className="hero-seq rounded-xl border border-white/10 bg-card/80 p-2.5 shadow-card" style={seq(c.seq)}>
              <div className="flex gap-2.5">
                <ProductThumb title={c.title} className="size-11" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{c.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{c.merchant}</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">{c.price}</p>
                </div>
              </div>
              <span className="glow-cta mt-2 block rounded-lg py-1.5 text-center text-xs font-semibold text-white">Buy now</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
