import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  violet: "bg-primary/10 text-primary",
  blue: "bg-brand-2/10 text-brand-2",
  green: "bg-success/12 text-success",
  amber: "bg-amber-500/12 text-amber-600",
} as const;

/** KPI tile: tinted icon, label, big number, small hint. */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "violet",
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  return (
    <div className={cn("surface p-4", className)}>
      <div className="flex items-center gap-2">
        <span className={cn("grid size-8 place-items-center rounded-lg", TONES[tone])} aria-hidden>
          <Icon className="size-4" />
        </span>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
