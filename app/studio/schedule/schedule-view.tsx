"use client";

import { useEffect, useRef, useState } from "react";

export interface ScheduleEvent {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  resourceId: "streams" | "payouts" | "commissions";
  allDay?: boolean;
}

const RESOURCES = [
  { id: "streams", name: "Streams", eventColor: "violet" },
  { id: "payouts", name: "Payouts", eventColor: "green" },
  { id: "commissions", name: "Commissions", eventColor: "orange" },
];

/**
 * Bryntum Calendar is a commercial product; its public *trial* build (evaluation use,
 * watermarked) is loaded from jsDelivr at runtime only when BRYNTUM_ENABLED=true, so
 * no Bryntum code is committed or installed. Pinned version, per supply-chain hygiene.
 */
const BRYNTUM_VERSION = "7.3.7";
const CDN = `https://cdn.jsdelivr.net/npm/@bryntum/calendar-trial@${BRYNTUM_VERSION}`;

interface BryntumCalendarInstance {
  destroy(): void;
}
interface BryntumGlobal {
  calendar?: { Calendar: new (config: Record<string, unknown>) => BryntumCalendarInstance };
}

function loadBryntum(): Promise<NonNullable<BryntumGlobal["calendar"]>> {
  const w = window as unknown as { bryntum?: BryntumGlobal };
  if (w.bryntum?.calendar) return Promise.resolve(w.bryntum.calendar);
  if (!document.querySelector(`link[data-bryntum]`)) {
    // v7 ships structural CSS plus a separate theme file.
    for (const file of ["calendar.css", "stockholm-light.css"]) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = `${CDN}/${file}`;
      css.dataset.bryntum = "1";
      document.head.appendChild(css);
    }
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${CDN}/calendar.umd.js`;
    s.onload = () => (w.bryntum?.calendar ? resolve(w.bryntum.calendar) : reject(new Error("Bryntum did not load")));
    s.onerror = () => reject(new Error("Bryntum CDN unreachable"));
    document.head.appendChild(s);
  });
}

export function ScheduleView({ events, bryntumEnabled }: { events: ScheduleEvent[]; bryntumEnabled: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">(bryntumEnabled ? "loading" : "idle");

  useEffect(() => {
    if (!bryntumEnabled || !host.current) return;
    let cal: BryntumCalendarInstance | null = null;
    let cancelled = false;
    loadBryntum()
      .then(({ Calendar }) => {
        if (cancelled || !host.current) return;
        cal = new Calendar({
          appendTo: host.current,
          date: new Date(),
          mode: "week",
          height: 640,
          readOnly: true,
          resources: RESOURCES,
          events,
        });
        setState("ready");
      })
      .catch(() => !cancelled && setState("failed"));
    return () => {
      cancelled = true;
      cal?.destroy();
    };
  }, [bryntumEnabled, events]);

  if (!bryntumEnabled || state === "failed") {
    return (
      <>
        <p className="text-xs text-muted-foreground">
          {state === "failed"
            ? "Bryntum couldn't load, so this is the built-in list view."
            : "Built-in list view. Set BRYNTUM_ENABLED=true to use the Bryntum Calendar (trial)."}
        </p>
        <AgendaList events={events} />
      </>
    );
  }
  return (
    <>
      {state === "loading" && <p className="text-sm text-muted-foreground">Loading Bryntum Calendar…</p>}
      <div ref={host} className="overflow-hidden rounded-xl border" />
    </>
  );
}

function AgendaList({ events }: { events: ScheduleEvent[] }) {
  const sorted = [...events].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const days = new Map<string, ScheduleEvent[]>();
  for (const e of sorted) {
    const k = new Date(e.startDate).toDateString();
    days.set(k, [...(days.get(k) ?? []), e]);
  }
  return (
    <ol className="space-y-4">
      {[...days.entries()].map(([day, list]) => (
        <li key={day}>
          <h2 className="mb-1 text-sm font-semibold">{day}</h2>
          <ul className="space-y-1">
            {list.map((e) => (
              <li key={e.id} className="flex gap-3 rounded-lg border p-2 text-sm">
                <span className="w-16 shrink-0 tabular-nums text-muted-foreground">
                  {e.allDay ? "all day" : new Date(e.startDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span>{e.name}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
