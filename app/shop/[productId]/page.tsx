import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ExternalLink, ShieldCheck, Store, Truck, Users } from "lucide-react";
import { DemoTour } from "@/components/app/demo-tour";
import { Logo } from "@/components/app/logo";
import { PayPalLogo } from "@/components/app/paypal-logo";
import { ProductThumb } from "@/components/app/product-thumb";
import { getEnv } from "@/lib/env";
import { featureStatus } from "@/lib/flags";
import { formatMoney } from "@/lib/money";
import { getProductPage } from "@/lib/shop";
import { ProductBuy } from "./product-buy";

export const metadata: Metadata = { title: "Product" };

/**
 * A product's page in Seen: what it is, who sells it, how checkout works, and where else
 * it's sold online. Opened from a card on the live page (in a new tab, so the video keeps
 * playing); the stream and moment ride along in the URL so the creator is still credited.
 */
export default function ProductPage(props: PageProps<"/shop/[productId]">) {
  return (
    <>
      <DemoTour role="viewer" />
      <header className="border-b bg-card/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between px-4 sm:px-6 lg:px-8 py-2.5">
          <Logo />
          <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
            Checkout by <PayPalLogo className="h-3.5" />
          </span>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 sm:px-6 lg:px-8 py-6">
        <Suspense fallback={<p className="text-muted-foreground">Loading product…</p>}>
          <ProductContent params={props.params} searchParams={props.searchParams} />
        </Suspense>
      </main>
    </>
  );
}

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

async function ProductContent({
  params,
  searchParams,
}: {
  params: PageProps<"/shop/[productId]">["params"];
  searchParams: PageProps<"/shop/[productId]">["searchParams"];
}) {
  await connection();
  const { productId } = await params;
  const q = await searchParams;
  const page = await getProductPage(productId, {
    streamId: one(q.stream),
    detectionId: one(q.d),
    tsSec: Number(one(q.t) ?? 0) || 0,
  });
  if (!page) notFound();

  const { product: p, seller, similar, from } = page;
  const env = getEnv();
  const paypal = featureStatus("paypal");
  const inStock = p.stock > 0;

  return (
    <>
      {from && (
        <Link
          href={`/live/${from.creatorSlug}?stream=${encodeURIComponent(from.streamId)}`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to {from.creatorName}&apos;s stream
        </Link>
      )}

      <div className="grid gap-8 md:grid-cols-[1fr_1fr]">
        <div className="surface grid aspect-square place-items-center overflow-hidden p-6">
          <ProductThumb title={p.title} image={p.image} className="size-40 md:size-56" />
        </div>

        <section className="space-y-5">
          <div className="space-y-2">
            <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Store className="size-4" aria-hidden />
              Sold by <b className="font-medium text-foreground">{seller.name}</b>
              {env.DEMO_MODE && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">Demo partner store</span>}
            </p>
            <h1 className="text-2xl font-semibold leading-tight md:text-3xl">{p.title}</h1>
            <p className="text-3xl font-semibold tabular-nums">{formatMoney(p.priceMinor, p.currency)}</p>
            <p className={`text-sm font-medium ${inStock ? "text-success" : "text-destructive"}`}>
              {!inStock ? "Out of stock" : p.stock <= 5 ? `Only ${p.stock} left` : "In stock"}
            </p>
          </div>

          <ProductBuy
            product={{ id: p.id, title: p.title, merchantName: seller.name, priceMinor: p.priceMinor, currency: p.currency }}
            inStock={inStock}
            from={from ? { streamId: from.streamId, detectionId: from.detectionId, tsSec: from.tsSec } : null}
            paypal={paypal.enabled ? { clientId: env.PAYPAL_CLIENT_ID!, env: env.PAYPAL_ENV } : null}
            demoMode={env.DEMO_MODE}
          />

          <ul className="space-y-2 rounded-xl border bg-card p-4 text-sm">
            <li className="flex gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              Secure checkout with PayPal or a card. Seen never sees your card details.
            </li>
            <li className="flex gap-2.5">
              <Truck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              {seller.name} ships your order. PayPal emails your receipt.
            </li>
            {from && (
              <li className="flex gap-2.5">
                <Users className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                Spotted on {from.creatorName}&apos;s stream: buying here supports {from.creatorName} with a commission.
              </li>
            )}
          </ul>

          {p.description && <p className="leading-relaxed text-muted-foreground">{p.description}</p>}

          {p.attributes.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
              {p.attributes.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="capitalize text-muted-foreground">{k}</dt>
                  <dd className="capitalize">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>

      {similar.length > 0 && (
        <section aria-labelledby="elsewhere" className="space-y-3">
          <div>
            <h2 id="elsewhere" className="font-semibold">Also sold online</h2>
            <p className="text-sm text-muted-foreground">
              Similar items at other stores, found by Channel3. These links leave Seen: no PayPal checkout here
              {from ? ` and no commission for ${from.creatorName}` : ""}.
            </p>
          </div>
          <ul className="divide-y rounded-xl border bg-card">
            {similar.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-muted/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.title}</span>
                    <span className="text-muted-foreground">{s.retailer}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 tabular-nums">
                    {formatMoney(s.priceMinor, s.currency)}
                    <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
