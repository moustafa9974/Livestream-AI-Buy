"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ExternalLink, Pin, ScanSearch, ShieldCheck, ShoppingBag, TrendingDown } from "lucide-react";
import { LivePill } from "@/components/app/live-pill";
import { LiveStage } from "@/components/live/live-stage";
import { SceneFallback } from "@/components/live/scene-fallback";
import { ShopperChat } from "@/components/live/shopper-chat";
import type { IceServers } from "@/components/live/rtc";
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
  /** Demo mode: one person plays viewer and creator, so checkout offers "see Maya's side". */
  demoMode: boolean;
  /** Real-time video from the creator's browser (WebRTC); null when the feature is off. */
  liveVideo: { iceServers: IceServers } | null;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function LiveViewer({ creator, stream, video, initialRail, paypal, demoMode, liveVideo }: Props) {
  const router = useRouter();
  const [wentLive, setWentLive] = useState(false);
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
  // The rail stream carries the status, so the page notices when the stream ends.
  const isLive = rail.status === "live";

  // On a replay, watch for the creator going live so the viewer can jump to it.
  useEffect(() => {
    if (isLive) return;
    let stop = false;
    const check = () =>
      fetch(`/api/live/${encodeURIComponent(creator.slug)}/now`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { liveStreamId: string | null }) => !stop && setWentLive(!!d.liveStreamId && d.liveStreamId !== stream.id))
        .catch(() => {});
    const t = setInterval(check, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [isLive, creator.slug, stream.id]);

  const recorded = (
    <>
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
      {video.kind === "none" && <SceneFallback items={rail.items} live={isLive} creatorName={creator.name} />}
    </>
  );

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

      {wentLive && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-live/30 bg-live/10 p-3 text-sm">
          <span className="inline-flex items-center gap-2 font-medium">
            <span className="size-2 rounded-full bg-live motion-safe:animate-pulse" aria-hidden />
            {creator.name} just went live.
          </span>
          <Button
            size="sm"
            onClick={() => {
              router.replace(`/live/${creator.slug}`);
              router.refresh();
              setWentLive(false);
            }}
          >
            Watch live
          </Button>
        </div>
      )}

      {!isLive && rail.items.length > 0 && (
        <p role="status" className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">
          {creator.name} isn&apos;t live right now. This is the latest stream as a <b className="text-foreground">shoppable replay</b>: everything the AI
          spotted is still for sale, and {creator.name} still earns commission on it.
        </p>
      )}

      {!paypal && (
        <p role="status" className="notice-warn p-3 text-sm">
          Checkout is unavailable right now. You can still browse.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_370px]">
        <section className="min-w-0 space-y-4">
          <div className="stage-dots relative aspect-video w-full overflow-hidden rounded-2xl shadow-lift ring-1 ring-black/5">
            {isLive && liveVideo ? (
              <LiveStage creatorSlug={creator.slug} streamId={stream.id} iceServers={liveVideo.iceServers} fallback={recorded} />
            ) : (
              recorded
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
            <div className="mb-3">
              <ShopperChat
                creatorSlug={creator.slug}
                creatorName={creator.name}
                streamId={stream.id}
                canBuy={!!paypal}
                onBuy={(detectionId) => {
                  // Same path as a card's Buy button: attribution first, then the PayPal drawer.
                  const item = rail.items.find((i) => i.detectionId === detectionId);
                  if (item) void buy(item);
                }}
              />
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
                  <RailCard
                    item={item}
                    canBuy={!!paypal}
                    onBuy={() => buy(item)}
                    // The product page opens in a new tab (video keeps playing) and carries the
                    // stream moment, so buying from it still credits the creator.
                    productHref={
                      item.partner
                        ? `/shop/${encodeURIComponent(item.partner.productId)}?stream=${encodeURIComponent(stream.id)}&d=${encodeURIComponent(item.detectionId)}&t=${Math.round(item.lastSeenSec)}`
                        : null
                    }
                  />
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
          demoMode={demoMode}
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

function RailCard({ item, canBuy, onBuy, productHref }: { item: RailItem; canBuy: boolean; onBuy: () => void; productHref: string | null }) {
  const p = item.partner;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <ProductThumb title={p ? p.title : item.label} image={p?.image} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            {p && productHref ? (
              <a
                href={productHref}
                target="_blank"
                rel="noopener"
                className="line-clamp-2 text-sm font-medium leading-snug underline-offset-2 hover:text-primary hover:underline"
                title="Product details, seller and where else it's sold"
              >
                {p.title}
                <ExternalLink className="ms-1 inline size-3 align-baseline text-muted-foreground" aria-label="(opens product page in a new tab)" />
              </a>
            ) : (
              <p className="line-clamp-2 text-sm font-medium leading-snug">{p ? p.title : item.label}</p>
            )}
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
          {/* PayPal's brand rules: PayPal-branded buttons come from the PayPal SDK (in the
              checkout drawer). Our own trigger stays neutral. */}
          <div className="space-y-1">
            <Button onClick={onBuy} disabled={!canBuy} aria-label={`Buy ${p.title}`} className="glow-cta h-10 w-full rounded-xl border-0 text-sm font-semibold text-white hover:brightness-110">
              {canBuy ? "Buy now" : "Checkout unavailable"}
            </Button>
            {canBuy && <p className="text-center text-[11px] text-muted-foreground">Pay with PayPal or card</p>}
          </div>
        </>
      ) : item.similar.length === 0 ? (
        <p className="text-xs text-muted-foreground">Featured by the creator. Not available to buy here yet.</p>
      ) : null}

      {item.similar.length > 0 && (
        <div className="rounded-lg bg-muted/60 px-2.5 py-2 text-xs">
          {/* Real stores, visible at a glance. Leaving Seen means no PayPal checkout here
              and no commission, so say so. */}
          <p className="mb-1 font-medium text-muted-foreground">{p ? "Also sold online (leaves Seen)" : "Where to buy it (leaves Seen)"}</p>
          <ul className="space-y-1">
            {item.similar.slice(0, 3).map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-card"
                  title={s.title}
                >
                  <span className="truncate">{s.retailer}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground">
                    {formatMoney(s.priceMinor, s.currency)}
                    <ExternalLink className="size-3" aria-hidden />
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {item.similar.length > 3 && (
            <details className="group mt-1">
              <summary className="cursor-pointer list-none px-1 text-muted-foreground marker:hidden">
                <span className="inline-flex items-center gap-1">
                  <ChevronRight className="size-3 transition group-open:rotate-90" aria-hidden />
                  {item.similar.length - 3} more
                </span>
              </summary>
              <ul className="mt-1 space-y-1">
                {item.similar.slice(3).map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="flex justify-between gap-2 rounded px-1 py-0.5 hover:bg-card" title={s.title}>
                      <span className="truncate">{s.retailer}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{formatMoney(s.priceMinor, s.currency)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
