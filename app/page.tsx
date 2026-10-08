import { Suspense } from "react";
import { connection } from "next/server";
import { Badge } from "@/components/ui/badge";
import { allFeatureStatuses, type Feature } from "@/lib/flags";

// Phase 1 placeholder: proves the app boots and shows which integrations are live.
// The real landing page (hero clip, viewer/creator buttons, i18n) arrives in Phase 4–5.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-16">
      <header className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">Seen</h1>
        <p className="text-lg text-muted-foreground">
          If it&apos;s on screen, it&apos;s shoppable, and the creator gets paid.
        </p>
      </header>

      <section aria-labelledby="features" className="space-y-3">
        <h2 id="features" className="text-sm font-semibold uppercase tracking-wide">
          Integrations
        </h2>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Checking…</p>}>
          <FeatureList />
        </Suspense>
      </section>
    </main>
  );
}

// Reads env at request time so flipping a flag + restarting is reflected without a rebuild.
async function FeatureList() {
  await connection();
  const features = allFeatureStatuses();
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {(Object.keys(features) as Feature[]).map((name) => {
        const s = features[name];
        return (
          <li key={name} className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span className="font-medium">{name}</span>
            {s.enabled ? (
              <Badge>on</Badge>
            ) : (
              <Badge variant="outline" title={s.reason}>
                unavailable
              </Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
}
