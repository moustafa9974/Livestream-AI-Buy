import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHeader } from "@/components/app/page-header";
import { prisma } from "@/lib/db";
import { getOwnedStream } from "@/lib/studio";
import { DetectionsGrid, type DetectionRow } from "./detections-grid";

export default function DetectionsPage(props: PageProps<"/studio/stream/[streamId]/detections">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
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
      <PageHeader
        eyebrow="Detections"
        title={stream.title}
        description="Double-click a label to correct it. Hidden products never show to viewers in this stream."
      />
      <nav aria-label="Streams" className="flex flex-wrap gap-2 text-sm">
        {streams.map((s) => (
          <Link
            key={s.id}
            href={`/studio/stream/${s.id}/detections`}
            aria-current={s.id === stream.id ? "page" : undefined}
            className={`rounded-full border px-3 py-1 shadow-sm transition ${
              s.id === stream.id ? "border-primary/40 bg-accent font-medium text-accent-foreground" : "bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.title} · {s.status}
          </Link>
        ))}
      </nav>
      <DetectionsGrid rows={rows} />
    </>
  );
}
