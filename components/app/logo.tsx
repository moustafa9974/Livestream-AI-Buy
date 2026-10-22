import Link from "next/link";
import { ScanEye } from "lucide-react";
import { cn } from "@/lib/utils";

/** Seen wordmark: gradient tile with an eye, plus an optional suffix ("Studio"). */
export function Logo({ suffix, href = "/", className }: { suffix?: string; href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="brand-bg grid size-7 place-items-center rounded-lg text-white shadow-sm" aria-hidden>
        <ScanEye className="size-4" strokeWidth={2.25} />
      </span>
      <span>
        Seen{suffix && <span className="font-normal text-muted-foreground"> {suffix}</span>}
      </span>
    </Link>
  );
}
