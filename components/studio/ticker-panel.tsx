"use client";

import { useEffect, useState } from "react";
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

  if (!t) return <section className="rounded-xl border p-4 text-sm text-muted-foreground">Loading sales…</section>;
  const quota = t.budget.limitPerDay ? `${t.budget.usedToday}/${t.budget.limitPerDay}` : `${t.budget.usedToday}`;

  return (
    <section aria-label="Today" className="space-y-3 rounded-xl border p-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Earned today</p>
          <p className="text-2xl font-bold tabular-nums">{formatMoney(t.todayEarnedMinor, t.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Sales today</p>
          <p className="text-2xl font-bold tabular-nums">{t.todaySales}</p>
        </div>
      </div>
      <ul className="space-y-1 text-sm" aria-live="polite">
        {t.recent.length === 0 && <li className="text-muted-foreground">No sales yet.</li>}
        {t.recent.map((s) => (
          <li
            key={s.id}
            className={`flex justify-between gap-2 rounded px-1 ${flash === s.id ? "motion-safe:animate-[rail-in_400ms_ease-out] bg-emerald-50 dark:bg-emerald-950" : ""}`}
          >
            <span className="truncate">{s.title}</span>
            <span className="shrink-0 tabular-nums text-emerald-700 dark:text-emerald-400">+{formatMoney(s.amountMinor, s.currency)}</span>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        AI frames today: {quota}
        {t.budget.mode === "saver" && <Badge variant="secondary">Free-tier saver mode</Badge>}
        {t.budget.mode === "cache_only" && <Badge variant="secondary">Quota used up: cache only</Badge>}
      </p>
    </section>
  );
}
