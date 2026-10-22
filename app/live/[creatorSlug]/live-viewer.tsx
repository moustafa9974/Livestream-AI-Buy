"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Pin, Play, Radio, ScanSearch, ShieldCheck, ShoppingBag, TrendingDown } from "lucide-react";
import { LivePill } from "@/components/app/live-pill";
import { ProductThumb } from "@/components/app/product-thumb";
import { Button } from "@/components/ui/button";
import { CheckoutDrawer, type CheckoutProduct } from "@/components/paypal/checkout-drawer";
import { formatMoney } from "@/lib/money";
import type { Rail, RailItem } from "@/lib/rail";

export type VideoSource = { kind: "file"; url: string } | { kind: "youtube"; embedUrl: string } | { kind: "none" };

interface Props {
  creator: { slug: string; name: string };
  stream: { id: string; title: string; status: string };
  video: VideoSource;
  initialRail: Rail;
  paypal: { clientId: string; env: "sandbox" | "live" } | null;
  paypalUnavailableReason: string | null;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function LiveViewer({ creator, stream, video, initialRail, paypal, paypalUnavailableReason }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [rail, setRail] = useState(initialRail);
  const [connected, setConnected] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<{ product: CheckoutProduct; attributionId: string | null } | null>(null);
  // Cards that arrived after page load get the entrance animation.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seenIds = useRef(new Set(initialRail.items.map((i) => i.detectionId)));

  useEffect(() => {
    const es = new EventSource(`/api/live/${creator.slug}/rail?stream=${encodeURIComponent(stream.id)}`);
    es.addEventListener("rail", (e) => {
      const next = JSON.parse((e as MessageEvent).data) as Rail;
      const added = next.items.map((i) => i.detectionId).filter((id) => !seenIds.current.has(id));
      added.forEach((id) => seenIds.current.add(id));
      setRail(next);
      if (added.length) setFresh(new Set(added));
    });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource reconnects on its own
    return () => es.close();
  }, [creator.slug, stream.id]);

  async function buy(item: RailItem) {
    if (!item.partner) return;
    const p = item.partner;
    let attributionId: string | null = null;
    try {
      const res = await fetch("/api/attributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          streamId: stream.id,
          detectionId: item.detectionId,
          partnerProductId: p.productId,
          tsSec: videoRef.current?.currentTime ?? item.lastSeenSec,
        }),
      });
      if (res.ok) attributionId = ((await res.json()) as { attributionId: string }).attributionId;
    } catch {
      // Checkout still works without attribution; the creator just isn't credited.
    }
    setCheckout({
      product: { id: p.productId, title: p.title, merchantName: p.merchantName, priceMinor: p.priceMinor, currency: p.currency },
      attributionId,
    });
  }

  function seek(sec: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = sec;
      void videoRef.current.play().catch(() => {});
    }
  }

  const highlight = rail.items.find((i) => i.detectionId === hovered && i.bbox);
  const isLive = stream.status === "live";

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="brand-bg grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold text-white shadow-sm ring-2 ring-card" aria-hidden>
            {initials(creator.name)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{creator.name}</h1>
            <p className="truncate text-sm text-muted-foreground">{stream.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            <span aria-hidden className={`size-1.5 rounded-full ${connected ? "bg-success" : "bg-muted-foreground/50"}`} />
            {connected ? "Shoppable in real time" : "Connecting…"}
          </span>
          <LivePill live={isLive} idleLabel="Replay" />
        </div>
      </header>

      {!paypal && (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          PayPal checkout is unavailable ({paypalUnavailableReason}). You can still browse.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_370px]">
        <section className="min-w-0 space-y-4">
          <div className="stage-dots relative aspect-video w-full overflow-hidden rounded-2xl shadow-lift ring-1 ring-black/5">
            {video.kind === "file" && (
              <video ref={videoRef} src={video.url} className="absolute inset-0 h-full w-full" autoPlay muted loop playsInline controls />
            )}
            {video.kind === "youtube" && (
              <iframe
                src={video.embedUrl}
                title={stream.title}
                className="absolute inset-0 h-full w-full"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            )}
            {video.kind === "none" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
                <span className="grid size-12 place-items-center rounded-2xl bg-white/10 backdrop-blur" aria-hidden>
                  {isLive ? <Radio className="size-6" /> : <Play className="size-6" />}
                </span>
                <p className="max-w-sm text-sm text-white/80">
                  {isLive ? `${creator.name} is live. Products appear on the right as they show up on screen.` : "Video coming soon."}
                </p>
              </div>
            )}
            {isLive && video.kind !== "youtube" && (
              <span aria-hidden className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-live px-2.5 py-1 text-[11px] font-semibold text-white">
                <span className="size-1.5 rounded-full bg-white" /> LIVE
              </span>
            )}
            {highlight?.bbox && video.kind === "file" && (
              <div
                aria-hidden
                className="pointer-events-none absolute rounded-xl border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.3)] motion-safe:transition-all"
                style={{
                  left: `${highlight.bbox[0] * 100}%`,
                  top: `${highlight.bbox[1] * 100}%`,
                  width: `${highlight.bbox[2] * 100}%`,
                  height: `${highlight.bbox[3] * 100}%`,
                }}
              />
            )}
          </div>

          {rail.items.length > 0 && video.kind === "file" && (
            <nav aria-label="Shop this moment" className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Shop this moment</span>
              {[...rail.items]
                .sort((a, b) => a.firstSeenSec - b.firstSeenSec)
                .map((i) => (
                  <button
                    key={i.detectionId}
                    onClick={() => seek(i.firstSeenSec)}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs shadow-sm transition hover:border-primary/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span className="font-medium tabular-nums text-primary">{mmss(i.firstSeenSec)}</span>
                    {i.label}
                  </button>
                ))}
            </nav>
          )}
        </section>

        <aside aria-label="Products on screen" className="min-w-0">
          <div className="lg:surface lg:p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <ShoppingBag className="size-4 text-primary" aria-hidden />
                On screen
              </h2>
              {rail.items.length > 0 && (
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                  {rail.items.length} item{rail.items.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {rail.items.length === 0 && (
              <div className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
                <ScanSearch className="mx-auto mb-2 size-5 text-primary" aria-hidden />
                Nothing yet. Products appear here as soon as the AI spots them on screen.
                <a href="/studio" target="_blank" className="mt-3 block text-xs font-medium text-primary underline-offset-2 hover:underline">
                  Are you the creator? Share your screen from the Studio ↗
                </a>
              </div>
            )}
            {/* Phones: horizontal strip under the video. Desktop: vertical rail. */}
            <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
              {rail.items.map((item) => (
                <li
                  key={item.detectionId}
                  onMouseEnter={() => setHovered(item.detectionId)}
                  onMouseLeave={() => setHovered(null)}
                  className={`w-72 shrink-0 snap-start rounded-xl border bg-card p-3 shadow-sm transition hover:border-primary/30 hover:shadow-card lg:w-auto ${
                    fresh.has(item.detectionId) ? "motion-safe:animate-[rail-in_400ms_ease-out]" : ""
                  }`}
                >
                  <RailCard item={item} canBuy={!!paypal} onBuy={() => buy(item)} />
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5" aria-hidden /> Secure checkout with PayPal · the creator earns a commission
            </p>
          </div>
        </aside>
      </div>

      {paypal && (
        <CheckoutDrawer
          product={checkout?.product ?? null}
          attributionId={checkout?.attributionId ?? null}
          onClose={() => setCheckout(null)}
          clientId={paypal.clientId}
          paypalEnv={paypal.env}
        />
      )}
    </>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function RailCard({ item, canBuy, onBuy }: { item: RailItem; canBuy: boolean; onBuy: () => void }) {
  const p = item.partner;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <ProductThumb title={p ? p.title : item.label} image={p?.image} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-sm font-medium leading-snug">{p ? p.title : item.label}</p>
            {item.state === "pinned" && <Pin className="mt-0.5 size-3.5 shrink-0 text-primary" aria-label="Pinned by the creator" />}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {p ? p.merchantName : item.state === "pinned" ? "Pinned by the creator" : "Spotted on screen"}
          </p>
          {p && (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-lg font-semibold tabular-nums">{formatMoney(p.priceMinor, p.currency)}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  p.kind === "exact" ? "bg-success/12 text-success" : "bg-accent text-accent-foreground"
                }`}
              >
                {p.kind === "exact" ? "Exact match" : "Similar"}
              </span>
            </div>
          )}
        </div>
      </div>

      {p ? (
        <>
          {item.comparison && item.comparison.savingsMinor > 0 && (
            <p className="flex items-center gap-1.5 rounded-lg bg-success/10 px-2.5 py-1.5 text-xs font-medium text-success">
              <TrendingDown className="size-3.5" aria-hidden />
              {formatMoney(item.comparison.savingsMinor, p.currency)} less than similar items
            </p>
          )}
          <Button
            onClick={onBuy}
            disabled={!canBuy}
            aria-label={`Buy ${p.title} with PayPal`}
            className="h-10 w-full rounded-xl bg-paypal text-sm font-semibold text-paypal-ink hover:bg-paypal hover:brightness-95"
          >
            {canBuy ? "Buy with PayPal" : "Checkout unavailable"}
          </Button>
        </>
      ) : item.similar.length === 0 ? (
        <p className="text-xs text-muted-foreground">Featured by the creator. Not available to buy here yet.</p>
      ) : null}

      {item.similar.length > 0 && (
        <details className="group rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs">
          <summary className="cursor-pointer list-none font-medium text-muted-foreground marker:hidden">
            <span className="inline-flex items-center gap-1">
              <ChevronRight className="size-3.5 transition group-open:rotate-90" aria-hidden />
              View similar ({item.similar.length})
            </span>
          </summary>
          <ul className="mt-1.5 space-y-1.5">
            {item.similar.map((s) => (
              <li key={s.url} className="flex justify-between gap-2">
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate underline-offset-2 hover:underline">
                  {s.title}
                </a>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatMoney(s.priceMinor, s.currency)} · {s.retailer}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
