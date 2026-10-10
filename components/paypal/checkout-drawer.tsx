"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatMoney } from "@/lib/money";
import type { PayPalPaymentSession } from "./sdk-types";
import { usePayPalSdk } from "./use-paypal-sdk";

export interface CheckoutProduct {
  id: string;
  title: string;
  merchantName: string;
  priceMinor: number;
  currency: string;
}

interface Props {
  product: CheckoutProduct | null;
  onClose: () => void;
  clientId: string;
  paypalEnv: "sandbox" | "live";
  /** From /api/attributions: the card click that credits the creator. */
  attributionId: string | null;
}

type CaptureResult =
  | { status: "captured"; creatorEarnedMinor: number; creatorName?: string; currency: string }
  | { status: "pending" }
  | { status: "declined" };

/**
 * Checkout as a non-modal drawer so the video behind it keeps playing. The browser
 * only says which product; the server prices it and creates the PayPal order.
 */
export function CheckoutDrawer({ product, onClose, clientId, paypalEnv, attributionId }: Props) {
  const sdk = usePayPalSdk(clientId, paypalEnv, product?.currency ?? "USD");
  const sessions = useRef<{ paypal?: PayPalPaymentSession; card?: PayPalPaymentSession }>({});
  const [busy, setBusy] = useState(false);
  // Latest product/attribution for callbacks created once per SDK instance.
  const current = useRef({ product, attributionId, onClose });
  useEffect(() => {
    current.current = { product, attributionId, onClose };
  });

  useEffect(() => {
    if (sdk.status !== "ready") return;
    let cancelled = false;

    const callbacks = {
      onApprove: async ({ orderId }: { orderId: string }) => {
        setBusy(true);
        try {
          const res = await fetch(`/api/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST" });
          const data = (await res.json()) as CaptureResult & { error?: string };
          if (!res.ok) throw new Error(data.error ?? "Capture failed");
          if (data.status === "captured") {
            const earned =
              data.creatorEarnedMinor > 0 && data.creatorName
                ? ` ${data.creatorName} earned ${formatMoney(data.creatorEarnedMinor, data.currency)} from your purchase.`
                : "";
            toast.success(`Paid ✅${earned ? " —" : ""}${earned}`);
            current.current.onClose();
          } else if (data.status === "pending") {
            toast.info("Payment is pending with PayPal. We'll confirm shortly.");
            current.current.onClose();
          } else {
            toast.error("That payment method was declined. Please try another.");
          }
        } catch {
          toast.error("We couldn't confirm your payment. You have not been charged twice. Please try again.");
        } finally {
          setBusy(false);
        }
      },
      onCancel: () => toast("Checkout cancelled"),
      onError: () => toast.error("PayPal ran into a problem. Please try again."),
    };

    (async () => {
      const s: typeof sessions.current = {};
      if (sdk.paypal) s.paypal = sdk.sdk.createPayPalOneTimePaymentSession(callbacks);
      if (sdk.card) {
        s.card = await sdk.sdk.createPayPalGuestOneTimePaymentSession({
          ...callbacks,
          onWarn: () => toast.warning("Card not accepted. Check the details or try another card."),
        });
      }
      if (!cancelled) sessions.current = s;
    })();
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  // Don't await before start(): PayPal needs the click's "transient activation" to open
  // its window, so we pass the pending order promise straight in.
  function createOrder(paymentMethod: "paypal" | "card"): Promise<{ orderId: string }> {
    const { product: p, attributionId: a } = current.current;
    return fetch("/api/checkout/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partnerProductId: p!.id, quantity: 1, paymentMethod, ...(a ? { attributionId: a } : {}) }),
    }).then(async (res) => {
      const data = (await res.json()) as { orderId?: string; error?: string };
      if (!res.ok || !data.orderId) {
        toast.error(data.error ?? "Couldn't start checkout");
        throw new Error(data.error ?? "create order failed");
      }
      return { orderId: data.orderId };
    });
  }

  function start(kind: "paypal" | "card") {
    const session = sessions.current[kind];
    if (!session) return;
    session.start({ presentationMode: "auto" }, createOrder(kind)).catch(() => {
      // Errors are surfaced through onError / toasts above.
    });
  }

  return (
    <Sheet open={product !== null} onOpenChange={(open) => !open && onClose()} modal={false} disablePointerDismissal>
      <SheetContent side="right" className="w-full sm:max-w-md">
        {product && (
          <>
            <SheetHeader>
              <SheetTitle>{product.title}</SheetTitle>
              <SheetDescription>
                Sold by {product.merchantName} via Seen Partner Stores
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-6">
              <p className="text-3xl font-bold tabular-nums">{formatMoney(product.priceMinor, product.currency)}</p>

              {sdk.status === "loading" && <p className="text-sm text-muted-foreground">Loading PayPal…</p>}
              {sdk.status === "error" && (
                <p role="alert" className="text-sm text-destructive">
                  PayPal checkout is unavailable right now. Please try again in a moment.
                </p>
              )}
              {sdk.status === "ready" && (
                <div className="flex flex-col gap-3" aria-busy={busy}>
                  {sdk.paypal && <paypal-button type="pay" className="paypal-gold" onClick={() => start("paypal")} />}
                  {sdk.card && (
                    <paypal-basic-card-container>
                      <paypal-basic-card-button onClick={() => start("card")} />
                    </paypal-basic-card-container>
                  )}
                  {!sdk.paypal && !sdk.card && (
                    <p className="text-sm text-muted-foreground">No PayPal payment methods are available here.</p>
                  )}
                </div>
              )}
              {busy && <p className="text-sm text-muted-foreground">Confirming your payment…</p>}
              <p className="text-xs text-muted-foreground">
                Sandbox demo: use a PayPal sandbox buyer account or a sandbox test card. No real money moves.
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
