"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Handshake, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { BookingView } from "@/lib/bookings";
import { defaultSlotFromDrag, MAX_SLOT_MINUTES } from "@/lib/bookings-rules";

export interface ScheduleEvent {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  resourceId: "streams" | "payouts" | "commissions" | "bookings";
  allDay?: boolean;
}

export interface Brand {
  id: string;
  name: string;
  products: Array<{ id: string; title: string }>;
}

const RESOURCES = [
  { id: "streams", name: "Streams", eventColor: "violet" },
  { id: "payouts", name: "Payouts", eventColor: "green" },
  { id: "commissions", name: "Commissions", eventColor: "orange" },
  { id: "bookings", name: "Brand slots", eventColor: "teal" },
];

/**
 * Bryntum Calendar is a commercial product; its public *trial* build (evaluation use,
 * watermarked) is loaded from jsDelivr at runtime only when BRYNTUM_ENABLED=true, so
 * no Bryntum code is committed or installed. Pinned version, per supply-chain hygiene.
 * API used (checked against the 7.3.7 type definitions): features.drag (CalendarDrag:
 * creatable/draggable/resizable), eventEdit/eventMenu/scheduleMenu off, listeners
 * beforeDragCreate / dragCreateEnd / eventClick / beforeEventDelete, eventStore.add/getById,
 * record.set/remove.
 */
const BRYNTUM_VERSION = "7.3.7";
const CDN = `https://cdn.jsdelivr.net/npm/@bryntum/calendar-trial@${BRYNTUM_VERSION}`;

interface BryntumRecord {
  id: string | number;
  startDate: Date;
  endDate: Date;
  set(fields: object): void;
  remove(): void;
}
interface BryntumCalendarInstance {
  destroy(): void;
  eventStore: { add(record: object): unknown; getById(id: string): BryntumRecord | undefined };
}
interface BryntumGlobal {
  calendar?: { Calendar: new (config: Record<string, unknown>) => BryntumCalendarInstance };
}

// One load per page. React runs effects twice in development, and two copies of the
// script make Bryntum refuse to start ("bundle was loaded multiple times").
let loading: Promise<NonNullable<BryntumGlobal["calendar"]>> | null = null;

function loadBryntum(): Promise<NonNullable<BryntumGlobal["calendar"]>> {
  loading ??= injectBryntum().catch((err) => {
    loading = null; // let a later visit retry, e.g. after a network blip
    throw err;
  });
  return loading;
}

function injectBryntum(): Promise<NonNullable<BryntumGlobal["calendar"]>> {
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

const STATUS_LABEL: Record<BookingView["status"], string> = { REQUESTED: "requested", APPROVED: "approved", DECLINED: "declined" };
const bookingName = (b: BookingView) => `🤝 ${b.merchant}: ${b.product} (${STATUS_LABEL[b.status]})`;
const bookingEvent = (b: BookingView): ScheduleEvent => ({
  id: `booking-${b.id}`,
  name: bookingName(b),
  startDate: b.startsAt,
  endDate: b.endsAt,
  resourceId: "bookings",
});

/** "2026-11-12T19:00" for <input type="datetime-local">, in the viewer's local time. */
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

interface FormState {
  startsAt: string;
  endsAt: string;
  merchantId: string;
  productId: string;
  note: string;
}

export function ScheduleView({
  events,
  bookings: initialBookings,
  brands,
  bryntumEnabled,
}: {
  events: ScheduleEvent[];
  bookings: BookingView[];
  brands: Brand[];
  bryntumEnabled: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const cal = useRef<BryntumCalendarInstance | null>(null);
  // The record Bryntum drew while dragging; replaced by the saved slot, or removed on cancel.
  const draft = useRef<BryntumRecord | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">(bryntumEnabled ? "loading" : "idle");
  const [bookings, setBookings] = useState(initialBookings);
  const bookingsRef = useRef(bookings);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  // The calendar is built once from the first render's data; later changes are applied to
  // its event store directly, so it doesn't flicker or lose the viewed month.
  const initial = useRef({ events, bookings: initialBookings });

  useEffect(() => {
    bookingsRef.current = bookings;
  }, [bookings]);

  function openForm(slot: { startsAt: Date; endsAt: Date }) {
    const brand = brands[0];
    setForm({
      startsAt: toLocalInput(slot.startsAt),
      endsAt: toLocalInput(slot.endsAt),
      merchantId: brand?.id ?? "",
      productId: brand?.products[0]?.id ?? "",
      note: "",
    });
  }

  function closeForm() {
    draft.current?.remove();
    draft.current = null;
    setForm(null);
  }

  useEffect(() => {
    if (!bryntumEnabled || !host.current) return;
    let cancelled = false;
    loadBryntum()
      .then(({ Calendar }) => {
        if (cancelled || !host.current) return;
        cal.current = new Calendar({
          appendTo: host.current,
          date: new Date(),
          // Month shows streams, payout runs and payable dates at a glance (week view hides
          // evening streams below the fold).
          mode: "month",
          height: 640,
          resources: RESOURCES,
          events: [...initial.current.events, ...initial.current.bookings.filter((b) => b.status !== "DECLINED").map(bookingEvent)],
          features: {
            // Drag on an empty day/time to request a brand slot. Existing items stay put:
            // streams and payouts come from the ledger, not from the calendar.
            drag: { creatable: true, draggable: false, resizable: false, newName: "New brand slot" },
            eventEdit: false, // our own form instead, validated on the server
            eventMenu: false,
            scheduleMenu: false,
          },
          listeners: {
            beforeDragCreate: ({ date }: { date: Date }) => date.getTime() >= startOfToday().getTime(),
            dragCreateEnd: ({ eventRecord }: { eventRecord: BryntumRecord }) => {
              draft.current = eventRecord;
              openForm(defaultSlotFromDrag(eventRecord.startDate, eventRecord.endDate));
            },
            eventClick: ({ eventRecord }: { eventRecord: BryntumRecord }) => {
              const b = bookingsRef.current.find((x) => `booking-${x.id}` === String(eventRecord.id));
              if (b) document.getElementById(`slot-${b.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            },
            beforeEventDelete: () => false, // nothing is deleted from the calendar itself
          },
        });
        setState("ready");
      })
      .catch(() => !cancelled && setState("failed"));
    return () => {
      cancelled = true;
      cal.current?.destroy();
      cal.current = null;
    };
    // openForm only reads `brands`, which never changes on this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bryntumEnabled]);

  async function submit() {
    if (!form) return;
    setBusy(true);
    try {
      const res = await fetch("/api/studio/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: form.merchantId,
          productId: form.productId,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
          note: form.note || undefined,
        }),
      });
      const data = (await res.json()) as { booking?: BookingView; error?: string };
      if (!res.ok || !data.booking) throw new Error(data.error ?? "Couldn't save the slot");
      const b = data.booking;
      draft.current?.remove();
      draft.current = null;
      cal.current?.eventStore.add(bookingEvent(b));
      setBookings((list) => [...list, b].sort((x, y) => x.startsAt.localeCompare(y.startsAt)));
      setForm(null);
      toast.success(`Slot requested: ${b.merchant} on ${when(b.startsAt)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the slot");
    } finally {
      setBusy(false);
    }
  }

  async function decide(b: BookingView, status: "APPROVED" | "DECLINED") {
    const res = await fetch(`/api/studio/bookings/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = (await res.json()) as { booking?: BookingView; error?: string };
    if (!res.ok || !data.booking) return toast.error(data.error ?? "Couldn't update the slot");
    const next = data.booking;
    setBookings((list) => list.map((x) => (x.id === next.id ? next : x)));
    const rec = cal.current?.eventStore.getById(`booking-${next.id}`);
    if (next.status === "DECLINED") rec?.remove();
    else rec?.set({ name: bookingName(next) });
    toast.success(status === "APPROVED" ? `Approved: ${next.merchant} will be featured` : "Slot declined");
  }

  const brand = brands.find((x) => x.id === form?.merchantId);
  const upcoming = bookings.filter((b) => new Date(b.endsAt) > new Date() || b.status === "REQUESTED");

  return (
    <>
      {!bryntumEnabled || state === "failed" ? (
        <>
          <p className="text-xs text-muted-foreground">
            {state === "failed"
              ? "Bryntum couldn't load, so this is the built-in list view."
              : "Built-in list view. Set BRYNTUM_ENABLED=true to use the Bryntum Calendar (trial)."}
          </p>
          <AgendaList events={[...events, ...bookings.filter((b) => b.status !== "DECLINED").map(bookingEvent)]} />
        </>
      ) : (
        <>
          {state === "loading" && <p className="text-sm text-muted-foreground">Loading Bryntum Calendar…</p>}
          {state === "ready" && <p className="text-sm text-muted-foreground">Tip: drag across a day to request a brand slot.</p>}
          <div ref={host} className="surface overflow-hidden" />
        </>
      )}

      <section aria-labelledby="slots" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="slots" className="flex items-center gap-2 font-semibold">
            <Handshake className="size-4 text-primary" aria-hidden /> Brand slots
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const start = new Date(startOfToday().getTime() + 86_400_000);
              start.setHours(19, 0, 0, 0);
              openForm({ startsAt: start, endsAt: new Date(start.getTime() + 3_600_000) });
            }}
          >
            <Plus aria-hidden /> Request a slot
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Partner stores ask to have a product featured during your stream. Approve the ones you like; nothing is featured without your OK.
        </p>
        {upcoming.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No brand slots yet.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {upcoming.map((b) => (
              <li key={b.id} id={`slot-${b.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {b.merchant}: {b.product}
                  </p>
                  <p className="text-muted-foreground">
                    {when(b.startsAt)} – {new Date(b.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {b.note ? ` · “${b.note}”` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={b.status === "APPROVED" ? "default" : b.status === "DECLINED" ? "outline" : "secondary"}>{STATUS_LABEL[b.status]}</Badge>
                  {b.status === "REQUESTED" && (
                    <>
                      <Button size="sm" onClick={() => void decide(b, "APPROVED")}>
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void decide(b, "DECLINED")}>
                        Decline
                      </Button>
                    </>
                  )}
                  {b.status === "APPROVED" && (
                    <Button size="sm" variant="ghost" onClick={() => void decide(b, "DECLINED")}>
                      Cancel
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet open={!!form} onOpenChange={(open) => !open && closeForm()}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Request a brand slot</SheetTitle>
            <SheetDescription>A partner store asks to have a product featured in this time slot. You approve it afterwards.</SheetDescription>
          </SheetHeader>
          {form && (
            <form
              className="space-y-4 px-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="space-y-1 text-sm">
                <label htmlFor="slot-brand" className="font-medium">Brand</label>
                <select
                  id="slot-brand"
                  className="h-9 w-full rounded-lg border bg-card px-2"
                  value={form.merchantId}
                  onChange={(e) => {
                    const next = brands.find((x) => x.id === e.target.value);
                    setForm({ ...form, merchantId: e.target.value, productId: next?.products[0]?.id ?? "" });
                  }}
                >
                  {brands.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 text-sm">
                <label htmlFor="slot-product" className="font-medium">Product to feature</label>
                <select id="slot-product" className="h-9 w-full rounded-lg border bg-card px-2" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                  {brand?.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 text-sm">
                  <label htmlFor="slot-start" className="font-medium">Starts</label>
                  <Input id="slot-start" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} required />
                </div>
                <div className="space-y-1 text-sm">
                  <label htmlFor="slot-end" className="font-medium">Ends</label>
                  <Input id="slot-end" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} required />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Up to {MAX_SLOT_MINUTES / 60} hours, in the future, not overlapping another slot.</p>
              <div className="space-y-1 text-sm">
                <label htmlFor="slot-note" className="font-medium">Note from the brand (optional)</label>
                <Textarea id="slot-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={280} rows={2} placeholder="e.g. Show the new speckled glaze, please" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !form.productId}>
                  {busy ? "Saving…" : "Request slot"}
                </Button>
                <Button type="button" variant="ghost" onClick={closeForm}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </SheetContent>
      </Sheet>
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
              <li key={e.id} className="surface flex gap-3 p-3 text-sm">
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
