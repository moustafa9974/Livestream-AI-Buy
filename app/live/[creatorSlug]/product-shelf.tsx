"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckoutDrawer, type CheckoutProduct } from "@/components/paypal/checkout-drawer";
import { formatMoney } from "@/lib/money";

interface ShelfProduct extends CheckoutProduct {
  category: string;
  detectionId?: string;
  kind: "exact" | "similar";
}

interface Props {
  products: ShelfProduct[];
  streamId: string | null;
  clientId: string | null; // null = PayPal unavailable
  paypalEnv: "sandbox" | "live";
}

export function ProductShelf({ products, streamId, clientId, paypalEnv }: Props) {
  const [selected, setSelected] = useState<ShelfProduct | null>(null);

  if (products.length === 0) {
    return <p className="text-muted-foreground">No products spotted yet. Check back when the stream is live.</p>;
  }

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <li key={p.id} className="flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold leading-snug">{p.title}</h2>
              <Badge variant={p.kind === "exact" ? "default" : "outline"}>
                {p.kind === "exact" ? "Exact match" : "Similar"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{p.merchantName}</p>
            <p className="mt-auto text-xl font-bold tabular-nums">{formatMoney(p.priceMinor, p.currency)}</p>
            <Button disabled={!clientId} onClick={() => setSelected(p)}>
              {clientId ? "Buy with PayPal" : "Checkout unavailable"}
            </Button>
          </li>
        ))}
      </ul>
      {clientId && streamId && (
        <CheckoutDrawer
          product={selected}
          onClose={() => setSelected(null)}
          clientId={clientId}
          paypalEnv={paypalEnv}
          attribution={{ streamId, detectionId: selected?.detectionId, tsSec: 0 }}
        />
      )}
    </>
  );
}
