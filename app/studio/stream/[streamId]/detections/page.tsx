import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db";
import { getOwnedStream } from "@/lib/studio";
import { DetectionsGrid, type DetectionRow } from "./detections-grid";

export default function DetectionsPage(props: PageProps<"/studio/stream/[streamId]/detections">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading detections…</p>}>
        <Content params={props.params} />
      </Suspense>
    </main>
  );
}

async function Content({ params }: { params: PageProps<"/studio/stream/[streamId]/detections">["params"] }) {
  await connection();
  const { streamId } = await params;
  const stream = await getOwnedStream(streamId);
  if (!stream) notFound();
  const [detections, streams] = await Promise.all([
    prisma.detection.findMany({
      where: { streamId },
      orderBy: { firstSeenSec: "asc" },
      include: {
        matches: { include: { partnerProduct: true } },
        attributions: { include: { orders: { where: { status: { in: ["CAPTURED", "PARTIALLY_REFUNDED"] } } } } },
      },
    }),
    prisma.stream.findMany({ where: { creatorId: stream.creatorId, scheduledFor: null }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const rows: DetectionRow[] = detections.map((d) => {
    const partner = d.matches.find((m) => m.source === "partner" && m.partnerProduct);
    return {
      id: d.id,
      label: d.label,
      category: d.category,
      confidence: Math.round(d.confidence * 100),
      hits: d.hits,
      state: d.state,
      match: partner ? `${partner.partnerProduct!.title} (${partner.kind})` : d.matches.length ? "similar items only" : "none",
      firstSeenSec: d.firstSeenSec,
      clicks: d.attributions.length,
      sales: d.attributions.reduce((n, a) => n + a.orders.length, 0),
    };
  });

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Detections</p>
          <h1 className="text-2xl font-bold tracking-tight">{stream.title}</h1>
        </div>
        <nav aria-label="Streams" className="flex flex-wrap gap-2 text-sm">
          {streams.map((s) => (
            <Link
              key={s.id}
              href={`/studio/stream/${s.id}/detections`}
              aria-current={s.id === stream.id ? "page" : undefined}
              className={`rounded-md border px-2.5 py-1 ${s.id === stream.id ? "bg-muted font-medium" : ""}`}
            >
              {s.title} · {s.status}
            </Link>
          ))}
        </nav>
      </header>
      <p className="text-sm text-muted-foreground">Double-click a label to correct it. Hidden products never show to viewers in this stream.</p>
      <DetectionsGrid rows={rows} />
    </>
  );
}
