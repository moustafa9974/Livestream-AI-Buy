"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{creator.name}</h1>
          <p className="text-sm text-muted-foreground">{stream.title}</p>
        </div>
        <div className="flex items-center gap-2">
          {isLive ? <Badge>● Live</Badge> : <Badge variant="outline">Replay</Badge>}
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {connected ? "Shoppable in real time" : "Connecting…"}
          </span>
        </div>
      </header>

      {!paypal && (
        <p role="status" className="rounded-lg border border-dashed p-3 text-sm">
          PayPal checkout is unavailable ({paypalUnavailableReason}). You can still browse.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="space-y-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
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
              <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">
                {isLive ? `${creator.name} is live. Products appear on the right as they show up on screen.` : "Video coming soon."}
              </p>
            )}
            {highlight?.bbox && video.kind === "file" && (
              <div
                aria-hidden
                className="pointer-events-none absolute rounded-lg border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.25)] motion-safe:transition-all"
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
              <span className="text-sm font-medium">Shop this moment:</span>
              {[...rail.items]
                .sort((a, b) => a.firstSeenSec - b.firstSeenSec)
                .map((i) => (
                  <button
                    key={i.detectionId}
                    onClick={() => seek(i.firstSeenSec)}
                    className="rounded-full border px-3 py-1 text-xs hover:bg-muted focus-visible:outline-2"
                  >
                    {mmss(i.firstSeenSec)} · {i.label}
                  </button>
                ))}
            </nav>
          )}
        </section>

        <aside aria-label="Products on screen" className="min-w-0">
          <h2 className="mb-2 font-semibold">On screen</h2>
          {rail.items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing yet. Products appear here as soon as the AI spots them on screen.
            </p>
          )}
          {/* Phones: horizontal strip under the video. Desktop: vertical rail. */}
          <ul className="flex snap-x gap-3 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
            {rail.items.map((item) => (
              <li
                key={item.detectionId}
                onMouseEnter={() => setHovered(item.detectionId)}
                onMouseLeave={() => setHovered(null)}
                className={`w-72 shrink-0 snap-start rounded-xl border bg-card p-3 lg:w-auto ${
                  fresh.has(item.detectionId) ? "motion-safe:animate-[rail-in_400ms_ease-out]" : ""
                }`}
              >
                <RailCard item={item} canBuy={!!paypal} onBuy={() => buy(item)} />
              </li>
            ))}
          </ul>
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

function RailCard({ item, canBuy, onBuy }: { item: RailItem; canBuy: boolean; onBuy: () => void }) {
  const p = item.partner;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{p ? p.title : item.label}</p>
          <p className="truncate text-xs text-muted-foreground">
            {p ? p.merchantName : item.state === "pinned" ? "Pinned by the creator" : "Spotted on screen"}
          </p>
        </div>
        {p && <Badge variant={p.kind === "exact" ? "default" : "outline"}>{p.kind === "exact" ? "Exact match" : "Similar"}</Badge>}
      </div>

      {p ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xl font-bold tabular-nums">{formatMoney(p.priceMinor, p.currency)}</span>
            {item.comparison && item.comparison.savingsMinor > 0 && (
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {formatMoney(item.comparison.savingsMinor, p.currency)} less than similar items
              </span>
            )}
          </div>
          <Button onClick={onBuy} disabled={!canBuy} aria-label={`Buy ${p.title} with PayPal`}>
            {canBuy ? "Buy with PayPal" : "Checkout unavailable"}
          </Button>
        </>
      ) : item.similar.length === 0 ? (
        <p className="text-xs text-muted-foreground">Featured by the creator. Not available to buy here yet.</p>
      ) : null}

      {item.similar.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">View similar ({item.similar.length})</summary>
          <ul className="mt-1 space-y-1">
            {item.similar.map((s) => (
              <li key={s.url} className="flex justify-between gap-2">
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate underline-offset-2 hover:underline">
                  {s.title}
                </a>
                <span className="shrink-0 tabular-nums">{formatMoney(s.priceMinor, s.currency)} · {s.retailer}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

