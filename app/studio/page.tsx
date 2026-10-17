import { Suspense } from "react";
import { connection } from "next/server";
import { getEnv } from "@/lib/env";
import { featureStatus } from "@/lib/flags";
import { currentStreamFor } from "@/lib/rail";
import { getCurrentCreator } from "@/lib/session";
import { kernelStatus } from "@/lib/kernel/watcher";
import { listDetections } from "@/lib/vision/process-frame";
import { LiveStudio } from "./live-studio";

// Creator Studio (SPEC §8): source picker (upload / screen / own stream URL via KERNEL),
// go live, live detection boxes, detections list, sales ticker, budget indicator.
export default function StudioLivePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading studio…</p>}>
        <StudioContent />
      </Suspense>
    </main>
  );
}

async function StudioContent() {
  await connection();
  const creator = await getCurrentCreator();
  if (!creator) return <p>Sign in to open the studio.</p>;
  const stream = await currentStreamFor(creator.id);
  if (!stream) return <p>No stream yet.</p>;

  const env = getEnv();
  const k = featureStatus("kernel");
  const ks = await kernelStatus(stream.id);
  const ai = featureStatus(env.AI_PROVIDER === "gemini" ? "gemini" : env.AI_PROVIDER === "ollama" ? "ollama" : "claude");

  return (
    <LiveStudio
      stream={{ id: stream.id, title: stream.title, status: stream.status, frameIntervalSec: stream.frameIntervalSec, videoAssetUrl: stream.videoAssetUrl }}
      initialDetections={await listDetections(stream.id)}
      creatorName={creator.displayName}
      creatorSlug={creator.slug}
      kernel={{ enabled: k.enabled, reason: k.reason ?? null, liveViewUrl: ks?.liveViewUrl ?? null, running: !!ks?.running && stream.status === "live" }}
      ai={{ provider: env.AI_PROVIDER, enabled: ai.enabled, reason: ai.reason ?? null, demoCache: env.DEMO_CACHE }}
      tuning={{ minChangeDistance: env.DHASH_MIN_DISTANCE, maxStaleSec: env.MAX_STALE_SECONDS }}
    />
  );
}
