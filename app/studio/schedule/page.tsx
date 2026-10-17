import { Suspense } from "react";
import { connection } from "next/server";
import { prisma } from "@/lib/db";
import { featureStatus } from "@/lib/flags";
import { formatMoney, sumMinor } from "@/lib/money";
import { getCurrentCreator } from "@/lib/session";
import { ScheduleView, type ScheduleEvent } from "./schedule-view";

export default function SchedulePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading schedule…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

const HOUR = 3_600_000;

/** Next N weekday occurrences (default Friday 17:00 local) for the automatic payout run. */
function nextPayoutRuns(count: number, weekday = 5, hour = 17): Date[] {
  const out: Date[] = [];
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  while (out.length < count) {
    if (d.getDay() === weekday && d > new Date()) out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

async function Content() {
  await connection();
  const creator = await getCurrentCreator();
  if (!creator) return <p>Sign in to see your schedule.</p>;
  const [streams, pending, batches] = await Promise.all([
    prisma.stream.findMany({ where: { creatorId: creator.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.commission.findMany({ where: { creatorId: creator.id, status: "PENDING" } }),
    prisma.payoutBatch.findMany({ where: { commissions: { some: { creatorId: creator.id } } }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const events: ScheduleEvent[] = [];
  for (const s of streams) {
    const start = s.scheduledFor ?? s.startedAt;
    if (!start) continue;
    const end = s.endedAt ?? new Date(start.getTime() + HOUR);
    events.push({ id: `stream-${s.id}`, name: s.scheduledFor ? `🎥 ${s.title}` : `🎥 ${s.title} (${s.status})`, startDate: start.toISOString(), endDate: end.toISOString(), resourceId: "streams" });
  }
  for (const b of batches) {
    events.push({
      id: `batch-${b.id}`,
      name: `💸 Payout ${formatMoney(b.totalMinor, b.currency)} (${b.status.toLowerCase()})`,
      startDate: b.createdAt.toISOString(),
      endDate: new Date(b.createdAt.getTime() + HOUR / 2).toISOString(),
      resourceId: "payouts",
    });
  }
  for (const run of nextPayoutRuns(4)) {
    events.push({ id: `auto-${run.getTime()}`, name: "💸 Automatic payout run", startDate: run.toISOString(), endDate: new Date(run.getTime() + HOUR / 2).toISOString(), resourceId: "payouts" });
  }
  // Pending commissions grouped by the day they become payable.
  const byDay = new Map<string, typeof pending>();
  for (const c of pending) {
    const k = c.eligibleAt.toISOString().slice(0, 10);
    byDay.set(k, [...(byDay.get(k) ?? []), c]);
  }
  for (const [day, cs] of byDay) {
    events.push({
      id: `eligible-${day}`,
      name: `✅ ${formatMoney(sumMinor(cs.map((c) => c.amountMinor - c.reversedMinor)), cs[0].currency)} becomes payable`,
      startDate: `${day}T00:00:00.000Z`,
      endDate: `${day}T23:59:00.000Z`,
      resourceId: "commissions",
      allDay: true,
    });
  }

  const bryntum = featureStatus("bryntum");
  return (
    <>
      <header>
        <p className="text-sm text-muted-foreground">{creator.displayName}</p>
        <h1 className="text-2xl font-bold tracking-tight">Schedule</h1>
        <p className="text-sm text-muted-foreground">Upcoming streams, automatic payout runs (Fridays) and when pending commissions become payable.</p>
      </header>
      <ScheduleView events={events} bryntumEnabled={bryntum.enabled} />
    </>
  );
}
