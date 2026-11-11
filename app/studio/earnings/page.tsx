import { Suspense } from "react";
import { connection } from "next/server";
import { Banknote, Clock, Send, ShoppingBag } from "lucide-react";
import { PageHeader, SectionTitle } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { getEarnings } from "@/lib/commerce/earnings";
import { featureStatus } from "@/lib/flags";
import { formatMoney } from "@/lib/money";
import { getCurrentCreator } from "@/lib/session";
import { EarningsTable, ProductsGrid } from "./earnings-table";
import { LiveRefresh } from "./live-refresh";
import { PayMeNow } from "./pay-me-now";

// Earnings (SPEC §8): KPI tiles, Pay me now, per-product grid and sales ledger (AG Grid), timeline.
export default function EarningsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-8 px-4 sm:px-6 lg:px-8 py-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading earnings…</p>}>
        <EarningsContent />
      </Suspense>
    </main>
  );
}

async function EarningsContent() {
  await connection();
  const creator = await getCurrentCreator();
  if (!creator) return <p>Sign in to see your earnings.</p>;
  const data = await getEarnings(creator.id);
  const paypal = featureStatus("paypal");
  const money = (minor: number) => formatMoney(minor, data.currency);

  const tiles = [
    { icon: ShoppingBag, tone: "violet" as const, label: "Sales", value: String(data.kpis.salesCount), hint: `${money(data.kpis.grossMinor)} gross` },
    { icon: Clock, tone: "amber" as const, label: "Upcoming commission", value: money(data.kpis.upcomingMinor), hint: `${money(data.kpis.payableNowMinor)} payable now` },
    { icon: Send, tone: "blue" as const, label: "In payout", value: money(data.kpis.inPayoutMinor), hint: "Sent to PayPal" },
    { icon: Banknote, tone: "green" as const, label: "Paid to you", value: money(data.kpis.paidMinor), hint: data.kpis.topProduct ? `Top: ${data.kpis.topProduct}` : "" },
  ];

  return (
    <>
      <PageHeader
        eyebrow={creator.displayName}
        title="Earnings"
        description={`When a viewer buys something they saw on your stream, the store is paid through PayPal and you earn ${creator.commissionRateBps / 100}% commission. Newest sales are at the top of the ledger. Pay me now sends what you have earned to your PayPal account with PayPal Payouts.`}
        actions={
          <>
            <LiveRefresh />
            <PayMeNow
              payableMinor={data.kpis.payableNowMinor}
              currency={data.currency}
              openBatchId={data.openBatch}
              unavailableReason={paypal.enabled ? null : paypal.reason ?? "PayPal unavailable"}
              payoutEmail={creator.payoutEmail}
            />
          </>
        }
      />

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <StatCard key={t.label} icon={t.icon} tone={t.tone} label={t.label} value={t.value} hint={t.hint} />
        ))}
      </section>

      <section aria-labelledby="by-product" className="space-y-3">
        <SectionTitle id="by-product">By product</SectionTitle>
        {data.products.length ? <ProductsGrid rows={data.products} /> : <p className="text-muted-foreground">No clicks yet.</p>}
      </section>

      <section aria-labelledby="ledger" className="space-y-3">
        <SectionTitle id="ledger">Commission ledger</SectionTitle>
        <EarningsTable rows={data.rows} canRefund={paypal.enabled} />
      </section>

      <section aria-labelledby="timeline" className="space-y-3">
        <SectionTitle id="timeline">Timeline</SectionTitle>
        <ol className="surface relative space-y-0 p-4 text-sm">
          {data.timeline.map((e) => (
            <li key={e.id} className="relative flex flex-wrap gap-x-3 border-s-2 border-border pb-3 ps-4 last:pb-0">
              <span aria-hidden className="absolute -start-[5px] top-1.5 size-2 rounded-full bg-primary ring-2 ring-card" />
              <time className="tabular-nums text-muted-foreground" dateTime={e.createdAt}>
                {new Date(e.createdAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" })} UTC
              </time>
              <span className="font-medium">{e.type}</span>
              <span className="text-muted-foreground">via {e.source}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
