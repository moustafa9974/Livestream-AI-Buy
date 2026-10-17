import { Suspense } from "react";
import { connection } from "next/server";
import { Badge } from "@/components/ui/badge";
import { getEnv } from "@/lib/env";
import { allFeatureStatuses, type Feature } from "@/lib/flags";
import { getCurrentCreator } from "@/lib/session";
import { ZapierSettings } from "./zapier-settings";

const LABELS: Partial<Record<Feature, string>> = {
  paypal: "PayPal checkout + payouts",
  agentToolkit: "PayPal Agent Toolkit (assistant lookups)",
  gemini: "Gemini (vision, assistant, recaps)",
  channel3: "Channel3 similar items",
  kernel: "KERNEL stream-URL watcher",
  elastic: "Elastic search",
  astropods: "Astropods watcher",
  zapier: "Zapier events",
  bryntum: "Bryntum schedule",
};

export default function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading settings…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  await connection();
  const creator = await getCurrentCreator();
  if (!creator) return <p>Sign in to change settings.</p>;
  const features = allFeatureStatuses();
  const env = getEnv();
  return (
    <>
      <header>
        <p className="text-sm text-muted-foreground">{creator.displayName}</p>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      </header>

      <section aria-labelledby="payouts" className="space-y-2">
        <h2 id="payouts" className="text-lg font-semibold">Payouts</h2>
        <p className="text-sm">
          Commission <b>{creator.commissionRateBps / 100}%</b>, paid in <b>{creator.payoutCurrency}</b> to PayPal account{" "}
          <code className="rounded bg-muted px-1">{creator.payoutEmail}</code> (sandbox).
        </p>
      </section>

      <section aria-labelledby="zapier" className="space-y-3">
        <h2 id="zapier" className="text-lg font-semibold">Zapier</h2>
        <p className="text-sm text-muted-foreground">
          Get sales, payouts and stream recaps in Gmail, Slack, Discord, Google Sheets… Create a Zap with the <b>Webhooks by Zapier → Catch Hook</b>{" "}
          trigger and paste its URL here. Recipes: docs/SPONSORS.md.
        </p>
        {!features.zapier.enabled && (
          <p className="rounded-lg border border-dashed p-3 text-sm">Zapier is off ({features.zapier.reason}). Events still appear in the 🔔 notification center.</p>
        )}
        <ZapierSettings initialUrl={creator.zapierWebhookUrl ?? ""} enabled={features.zapier.enabled} />
      </section>

      <section aria-labelledby="integrations" className="space-y-3">
        <h2 id="integrations" className="text-lg font-semibold">Integrations</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(LABELS) as Feature[]).map((f) => (
            <li key={f} className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
              <span>{LABELS[f]}</span>
              {features[f].enabled ? <Badge>on</Badge> : <Badge variant="outline" title={features[f].reason}>off</Badge>}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          AI provider: {env.AI_PROVIDER} · vision model {env.GEMINI_VISION_MODEL} (+ fallbacks) · demo cache {env.DEMO_CACHE ? "on" : "off"}
        </p>
      </section>
    </>
  );
}
