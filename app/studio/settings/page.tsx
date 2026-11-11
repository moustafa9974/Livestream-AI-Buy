import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { allFeatureStatuses, type Feature } from "@/lib/flags";
import { getCurrentCreator } from "@/lib/session";
import { ZapierSettings } from "./zapier-settings";

const LABELS: Partial<Record<Feature, string>> = {
  paypal: "PayPal checkout + payouts",
  agentToolkit: "PayPal Agent Toolkit (assistant lookups)",
  gemini: "Gemini (vision, assistant, recaps)",
  openrouter: "OpenRouter backup vision (free models)",
  channel3: "Channel3 similar items",
  kernel: "KERNEL stream-URL watcher",
  elastic: "Elastic search",
  astropods: "Astropods watcher",
  zapier: "Zapier events",
  bryntum: "Bryntum schedule",
};

export default function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 sm:px-6 lg:px-8 py-8">
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
  return (
    <>
      <PageHeader eyebrow={creator.displayName} title="Settings" description="Payouts, alerts and connected services." />

      <section aria-labelledby="payouts" className="surface space-y-2 p-5">
        <h2 id="payouts" className="font-semibold">Payouts</h2>
        <p className="text-sm">
          Commission <b>{creator.commissionRateBps / 100}%</b>, paid in <b>{creator.payoutCurrency}</b> to PayPal account{" "}
          <code className="rounded bg-muted px-1">{creator.payoutEmail}</code> (sandbox).
        </p>
      </section>

      <section aria-labelledby="zapier" className="surface space-y-3 p-5">
        <h2 id="zapier" className="font-semibold">Zapier</h2>
        <p className="text-sm text-muted-foreground">
          Get sales, payouts and stream recaps in Gmail, Slack, Discord, Google Sheets… Create a Zap with the <b>Webhooks by Zapier → Catch Hook</b>{" "}
          trigger and paste its URL here.
        </p>
        {!features.zapier.enabled && (
          <p className="rounded-lg border border-dashed p-3 text-sm">Alerts appear in the 🔔 notification center. Connect Zapier to also get them by email, Slack or text.</p>
        )}
        <ZapierSettings initialUrl={creator.zapierWebhookUrl ?? ""} enabled={features.zapier.enabled} />
      </section>

      <section aria-labelledby="integrations" className="surface space-y-3 p-5">
        <h2 id="integrations" className="font-semibold">Connected services</h2>
        {/* Only what's connected: a list of "off" switches is noise for the creator. */}
        <ul className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(LABELS) as Feature[])
            .filter((f) => features[f].enabled)
            .map((f) => (
              <li key={f} className="flex items-center justify-between gap-2 rounded-xl border bg-background p-3 text-sm">
                <span>{LABELS[f]}</span>
                <Badge className="bg-success/12 text-success">connected</Badge>
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
