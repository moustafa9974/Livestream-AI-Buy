"use client";

import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";

interface Ticker {
  todaySales: number;
  todayEarnedMinor: number;
  currency: string;
  recent: Array<{ id: string; title: string; amountMinor: number; currency: string; at: string }>;
  budget: { mode: "normal" | "saver" | "cache_only"; usedToday: number; limitPerDay: number | null };
}

/** Live sales ticker + today's earnings + free-tier budget, polled every few seconds. */
export function TickerPanel() {
  const [t, setT] = useState<Ticker | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let lastTop: string | undefined;
    const load = async () => {
      try {
        const res = await fetch("/api/studio/ticker");
        if (!res.ok || stop) return;
        const d = (await res.json()) as Ticker;
        const top = d.recent[0]?.id;
        if (lastTop && top && top !== lastTop) setFlash(top); // a new sale arrived
        lastTop = top;
        setT(d);
      } catch {
        // keep the last good state
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  if (!t) return <section className="surface h-44 animate-pulse p-4 text-sm text-muted-foreground">Loading sales…</section>;

  return (
    <section aria-label="Today" className="surface overflow-hidden">
      <div className="brand-bg grid grid-cols-2 gap-3 p-4 text-white">
        <div>
          <p className="text-xs text-white/75">Earned today</p>
          <p className="text-2xl font-semibold tabular-nums">{formatMoney(t.todayEarnedMinor, t.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-white/75">Sales today</p>
          <p className="text-2xl font-semibold tabular-nums">{t.todaySales}</p>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <TrendingUp className="size-3.5" aria-hidden /> Recent commission
        </p>
        <ul className="space-y-1 text-sm" aria-live="polite">
          {t.recent.length === 0 && <li className="text-muted-foreground">No sales yet.</li>}
          {t.recent.map((s) => (
            <li
              key={s.id}
              className={`flex justify-between gap-2 rounded-md px-1.5 py-0.5 ${flash === s.id ? "bg-success/12 motion-safe:animate-[rail-in_400ms_ease-out]" : ""}`}
            >
              <span className="truncate">{s.title}</span>
              <span className="shrink-0 font-medium tabular-nums text-success">+{formatMoney(s.amountMinor, s.currency)}</span>
            </li>
          ))}
        </ul>
        {t.budget.mode !== "normal" && (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            <Badge variant="secondary">AI saver mode</Badge> Fewer frames are analysed to stay within the free AI tier.
          </p>
        )}
      </div>
    </section>
  );
}
