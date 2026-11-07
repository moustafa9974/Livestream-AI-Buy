"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckoutDrawer, type CheckoutProduct } from "@/components/paypal/checkout-drawer";

interface Props {
  product: CheckoutProduct;
  inStock: boolean;
  /** The stream moment the viewer came from, so the creator is credited for this sale. */
  from: { streamId: string; detectionId: string | null; tsSec: number } | null;
  paypal: { clientId: string; env: "sandbox" | "live" } | null;
  demoMode: boolean;
}

/** Buy button on the product page: same PayPal checkout drawer as the live page. */
export function ProductBuy({ product, inStock, from, paypal, demoMode }: Props) {
  const [open, setOpen] = useState<{ attributionId: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function buy() {
    setBusy(true);
    let attributionId: string | null = null;
    if (from) {
      try {
        const res = await fetch("/api/attributions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            streamId: from.streamId,
            detectionId: from.detectionId ?? undefined,
            partnerProductId: product.id,
            tsSec: from.tsSec,
          }),
        });
        if (res.ok) attributionId = ((await res.json()) as { attributionId: string }).attributionId;
      } catch {
        // Checkout still works; the creator just isn't credited for this one.
      }
    }
    setBusy(false);
    setOpen({ attributionId });
  }

  const canBuy = !!paypal && inStock;
  return (
    <>
      <div className="space-y-1">
        <Button onClick={buy} disabled={!canBuy || busy} className="h-11 w-full rounded-xl text-base font-semibold">
          {!inStock ? "Out of stock" : !paypal ? "Checkout unavailable" : busy ? "Opening…" : "Buy now"}
        </Button>
        {canBuy && <p className="text-center text-xs text-muted-foreground">Pay with PayPal or card</p>}
      </div>
      {paypal && (
        <CheckoutDrawer
          product={open ? product : null}
          attributionId={open?.attributionId ?? null}
          onClose={() => setOpen(null)}
          clientId={paypal.clientId}
          paypalEnv={paypal.env}
          demoMode={demoMode}
        />
      )}
    </>
  );
}
