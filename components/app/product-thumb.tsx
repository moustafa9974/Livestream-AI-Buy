import {
  Coffee,
  CupSoda,
  Flame,
  Footprints,
  Glasses,
  Headphones,
  Keyboard,
  Lamp,
  Laptop,
  Mic,
  Package,
  Shirt,
  Sprout,
  Webcam,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// The demo catalog has no photos, so products get a tinted tile with an icon that fits
// the product kind. A real image wins when there is one.
const KINDS: Array<[RegExp, LucideIcon, number]> = [
  [/hoodie|tee|shirt|sweat|beanie|cap|jacket/i, Shirt, 286],
  [/sneaker|shoe/i, Footprints, 252],
  [/sunglass|glasses/i, Glasses, 60],
  [/headphone|earbud/i, Headphones, 200],
  [/webcam|camera/i, Webcam, 230],
  [/mic/i, Mic, 320],
  [/tumbler|bottle/i, CupSoda, 180],
  [/mug|cup/i, Coffee, 40],
  [/lamp|light/i, Lamp, 80],
  [/keyboard/i, Keyboard, 260],
  [/laptop/i, Laptop, 240],
  [/planter|plant/i, Sprout, 150],
  [/candle/i, Flame, 25],
];

export function ProductThumb({ title, image, className }: { title: string; image?: string | null; className?: string }) {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element -- remote merchant images, unknown hosts
    return <img src={image} alt="" className={cn("size-14 shrink-0 rounded-lg object-cover", className)} />;
  }
  const [, Icon, hue] = KINDS.find(([re]) => re.test(title)) ?? [null, Package, 286];
  return (
    <span
      aria-hidden
      className={cn("grid size-14 shrink-0 place-items-center rounded-lg", className)}
      style={{ background: `oklch(0.95 0.04 ${hue})`, color: `oklch(0.5 0.16 ${hue})` }}
    >
      <Icon className="size-6" strokeWidth={1.75} />
    </span>
  );
}
