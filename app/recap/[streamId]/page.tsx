import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Logo } from "@/components/app/logo";
import { prisma } from "@/lib/db";
import { mmss, publicStatsLine, recapStats } from "@/lib/recap";

export const metadata: Metadata = { title: "Stream recap" };

/** Public, shareable stream recap (SPEC §8): the marketing asset. */
export default function RecapPage(props: PageProps<"/recap/[streamId]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-12">
      <Suspense fallback={<p className="text-muted-foreground">Loading recap…</p>}>
        <Content params={props.params} />
      </Suspense>
    </main>
  );
}

async function Content({ params }: { params: PageProps<"/recap/[streamId]">["params"] }) {
  await connection();
  const { streamId } = await params;
  const stream = await prisma.stream.findUnique({ where: { id: streamId }, include: { creator: true } });
  if (!stream || stream.scheduledFor) notFound();
  const stats = await recapStats(streamId);

  const tiles = [
    { label: "Minutes", value: String(stats.durationMin) },
    { label: "Products shown", value: String(stats.products) },
    { label: "Sales", value: String(stats.sales) },
    // No earnings here: this page is public. The creator sees them in the studio.
    { label: "Best moment", value: stats.moments[0] ? mmss(stats.moments[0].atSec) : "—" },
  ];

  return (
    <>
      <header className="space-y-3 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Stream recap · {stream.creator.displayName}</p>
        <h1 className="text-3xl font-semibold md:text-4xl">{stream.title}</h1>
        {stream.recapText && <p className="text-lg">{stream.recapText}</p>}
        <p className="text-muted-foreground">{publicStatsLine(stats)}</p>
      </header>

      <section aria-label="Stats" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="surface p-4 text-center">
            <p className="brand-text text-2xl font-semibold tabular-nums">{t.value}</p>
            <p className="text-xs text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="moments" className="space-y-3">
        <h2 id="moments" className="text-lg font-semibold">Best moments</h2>
        {stats.moments.length === 0 && <p className="text-muted-foreground">No products were shown in this stream.</p>}
        <ol className="space-y-2">
          {stats.moments.slice(0, 8).map((m) => (
            <li key={m.detectionId} className="surface flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="font-medium">
                  <span className="tabular-nums text-muted-foreground">{mmss(m.atSec)}</span> · {m.productTitle ?? m.label}
                </p>
                <p className="text-xs text-muted-foreground">{m.sales} sale{m.sales === 1 ? "" : "s"}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href={`/live/${stream.creator.slug}?stream=${stream.id}`}
          className="brand-bg rounded-xl px-5 py-3 font-medium text-white shadow-lift hover:brightness-110"
        >
          Shop the replay
        </Link>
      </div>
      <p className="text-center text-xs text-muted-foreground">If it&apos;s on screen, it&apos;s shoppable, and the creator gets paid. Powered by Seen + PayPal.</p>
    </>
  );
}
