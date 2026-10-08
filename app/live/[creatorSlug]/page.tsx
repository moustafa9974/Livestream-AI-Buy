import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { featureStatus } from "@/lib/flags";
import { ProductShelf } from "./product-shelf";

// Phase 2 viewer page: a static shelf of the creator's detected products with a real
// PayPal checkout. Phase 4 replaces the shelf with the live SSE product rail + video.
export default function LivePage(props: PageProps<"/live/[creatorSlug]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <LiveContent params={props.params} />
      </Suspense>
    </main>
  );
}

async function LiveContent({ params }: { params: PageProps<"/live/[creatorSlug]">["params"] }) {
  await connection();
  const { creatorSlug } = await params;
  const creator = await prisma.creator.findUnique({ where: { slug: creatorSlug } });
  if (!creator) notFound();

  // Attribute purchases to the creator's current stream (live first, then the newest).
  const stream =
    (await prisma.stream.findFirst({ where: { creatorId: creator.id, status: "live" }, orderBy: { startedAt: "desc" } })) ??
    (await prisma.stream.findFirst({ where: { creatorId: creator.id, status: "idle" }, orderBy: { createdAt: "desc" } })) ??
    (await prisma.stream.findFirst({ where: { creatorId: creator.id }, orderBy: { createdAt: "desc" } }));
  const matches = await prisma.productMatch.findMany({
    where: {
      source: "partner",
      detection: { stream: { creatorId: creator.id }, state: { in: ["visible", "pinned"] } },
    },
    include: { partnerProduct: { include: { merchant: true } }, detection: true },
    orderBy: { detection: { firstSeenSec: "asc" } },
  });
  const seen = new Set<string>();
  const products = matches.flatMap((m) => {
    const p = m.partnerProduct;
    if (!p || seen.has(p.id)) return [];
    seen.add(p.id);
    return [{
      id: p.id,
      title: p.title,
      merchantName: p.merchant.name,
      priceMinor: p.priceMinor,
      currency: p.currency,
      category: p.category,
      detectionId: stream?.id === m.detection.streamId ? m.detectionId : undefined,
      kind: m.kind,
    }];
  });

  const env = getEnv();
  const paypal = featureStatus("paypal");

  return (
    <>
      <header className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">Shopping with</p>
        <h1 className="text-3xl font-bold tracking-tight">{creator.displayName}</h1>
        {stream && <p className="text-muted-foreground">{stream.title}</p>}
      </header>
      {!paypal.enabled && (
        <p role="status" className="rounded-lg border border-dashed p-3 text-sm">
          PayPal checkout is unavailable ({paypal.reason}). Browsing still works.
        </p>
      )}
      <ProductShelf
        products={products}
        streamId={stream?.id ?? null}
        clientId={paypal.enabled ? env.PAYPAL_CLIENT_ID! : null}
        paypalEnv={env.PAYPAL_ENV}
      />
    </>
  );
}
