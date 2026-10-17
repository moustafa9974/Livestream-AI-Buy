import { Suspense } from "react";
import { connection } from "next/server";
import { getEarnings } from "@/lib/commerce/earnings";
import { featureStatus } from "@/lib/flags";
import { formatMoney } from "@/lib/money";
import { getCurrentCreator } from "@/lib/session";
import { EarningsTable, ProductsGrid } from "./earnings-table";
import { PayMeNow } from "./pay-me-now";

// Earnings (SPEC §8): KPI tiles, Pay me now, per-product grid and sales ledger (AG Grid), timeline.
export default function EarningsPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8">
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
    { label: "Sales", value: String(data.kpis.salesCount), hint: `${money(data.kpis.grossMinor)} gross` },
    { label: "Upcoming commission", value: money(data.kpis.upcomingMinor), hint: `${money(data.kpis.payableNowMinor)} payable now` },
    { label: "In payout", value: money(data.kpis.inPayoutMinor), hint: "Sent to PayPal" },
    { label: "Paid to you", value: money(data.kpis.paidMinor), hint: data.kpis.topProduct ? `Top: ${data.kpis.topProduct}` : "" },
  ];

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{creator.displayName}</p>
          <h1 className="text-3xl font-bold tracking-tight">Earnings</h1>
        </div>
        <PayMeNow
          payableMinor={data.kpis.payableNowMinor}
          currency={data.currency}
          openBatchId={data.openBatch}
          unavailableReason={paypal.enabled ? null : paypal.reason ?? "PayPal unavailable"}
        />
      </header>

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">{t.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{t.value}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{t.hint}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="by-product" className="space-y-3">
        <h2 id="by-product" className="text-lg font-semibold">By product</h2>
        {data.products.length ? <ProductsGrid rows={data.products} /> : <p className="text-muted-foreground">No clicks yet.</p>}
      </section>

      <section aria-labelledby="ledger" className="space-y-3">
        <h2 id="ledger" className="text-lg font-semibold">Commission ledger</h2>
        <EarningsTable rows={data.rows} canRefund={paypal.enabled} />
      </section>

      <section aria-labelledby="timeline" className="space-y-3">
        <h2 id="timeline" className="text-lg font-semibold">Timeline</h2>
        <ol className="space-y-2 text-sm">
          {data.timeline.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-3 border-s-2 ps-3">
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
