import { existsSync } from "node:fs";
import path from "node:path";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { featureStatus } from "@/lib/flags";
import { currentStreamFor, getRail } from "@/lib/rail";
import { LiveViewer, type VideoSource } from "./live-viewer";

export default function LivePage(props: PageProps<"/live/[creatorSlug]">) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-6">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <LiveContent params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

/** Only own-content sources: the uploaded demo file, or a YouTube embed of the creator's video. */
function videoSourceFor(stream: { videoAssetUrl: string | null; sourceType: string; sourceUrl: string | null }): VideoSource {
  if (stream.videoAssetUrl?.startsWith("/") && existsSync(path.join(process.cwd(), "public", stream.videoAssetUrl))) {
    return { kind: "file", url: stream.videoAssetUrl };
  }
  if (stream.sourceType === "youtube" && stream.sourceUrl) {
    const id = stream.sourceUrl.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/)?.[1];
    if (id) return { kind: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1` };
  }
  return { kind: "none" };
}

async function LiveContent({
  params,
  searchParams,
}: {
  params: PageProps<"/live/[creatorSlug]">["params"];
  searchParams: PageProps<"/live/[creatorSlug]">["searchParams"];
}) {
  await connection();
  const { creatorSlug } = await params;
  const creator = await prisma.creator.findUnique({ where: { slug: creatorSlug } });
  if (!creator) notFound();
  // ?stream=<id> opens a specific (e.g. ended) stream as a shoppable replay.
  const requested = (await searchParams).stream;
  const replay =
    typeof requested === "string"
      ? await prisma.stream.findFirst({ where: { id: requested, creatorId: creator.id, scheduledFor: null } })
      : null;
  const stream = replay ?? (await currentStreamFor(creator.id));
  if (!stream) return <p>{creator.displayName} hasn&apos;t streamed yet.</p>;

  const env = getEnv();
  const paypal = featureStatus("paypal");
  return (
    <LiveViewer
      creator={{ slug: creator.slug, name: creator.displayName }}
      stream={{ id: stream.id, title: stream.title, status: stream.status }}
      video={videoSourceFor(stream)}
      initialRail={await getRail(stream.id)}
      paypal={paypal.enabled ? { clientId: env.PAYPAL_CLIENT_ID!, env: env.PAYPAL_ENV } : null}
      paypalUnavailableReason={paypal.reason ?? null}
    />
  );
}
