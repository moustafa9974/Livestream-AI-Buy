import { Suspense } from "react";
import { connection } from "next/server";
import { getEnv } from "@/lib/env";
import { featureStatus } from "@/lib/flags";
import { currentStreamFor } from "@/lib/rail";
import { getCurrentCreator } from "@/lib/session";
import { listDetections } from "@/lib/vision/process-frame";
import { LiveStudio } from "./live-studio";

// Phase 3 studio: source picker, go live, live detection boxes, pin/hide.
// Phase 5 adds the full studio (sales ticker, KERNEL source, assistant, AG Grid).
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
  const ai = featureStatus(env.AI_PROVIDER === "gemini" ? "gemini" : env.AI_PROVIDER === "ollama" ? "ollama" : "claude");

  return (
    <LiveStudio
      stream={{ id: stream.id, title: stream.title, status: stream.status, frameIntervalSec: stream.frameIntervalSec, videoAssetUrl: stream.videoAssetUrl }}
      initialDetections={await listDetections(stream.id)}
      creatorName={creator.displayName}
      ai={{ provider: env.AI_PROVIDER, enabled: ai.enabled, reason: ai.reason ?? null, demoCache: env.DEMO_CACHE }}
      tuning={{ minChangeDistance: env.DHASH_MIN_DISTANCE, maxStaleSec: env.MAX_STALE_SECONDS }}
    />
  );
}
