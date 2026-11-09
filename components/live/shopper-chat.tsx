"use client";

import { useRef, useState } from "react";
import { Check, ScanSearch, Send, ShoppingBag, Sparkles, TrendingDown, X } from "lucide-react";
import { Formatted } from "@/components/app/formatted-text";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

interface Offer {
  detectionId: string;
  productId: string;
  title: string;
  price: string;
}

interface Msg {
  role: "user" | "assistant";
  text: string;
  actions?: Array<{ tool: string; ok: boolean }>;
  checkout?: Offer | null;
}

const SUGGESTIONS = [
  { text: "What's on screen right now?", icon: ScanSearch },
  { text: "Is the mug cheaper anywhere else?", icon: TrendingDown },
  { text: "Tell me about the hoodie", icon: Sparkles },
  { text: "Buy the mug", icon: ShoppingBag },
];

// What each tool did, in the viewer's words (chips under a reply).
const TOOL_LABELS: Record<string, string> = {
  products_on_screen: "Checked what's on screen",
  product_details: "Read product details",
  compare_prices: "Compared prices",
  prepare_checkout: "Prepared checkout",
};

/**
 * Viewer shopping agent: ask about what's on screen, compare prices, and ask it to buy.
 * It never pays by itself: a purchase shows a Buy card, and the viewer approves in PayPal.
 */
export function ShopperChat({
  creatorSlug,
  creatorName,
  streamId,
  canBuy,
  onBuy,
}: {
  creatorSlug: string;
  creatorName: string;
  streamId: string;
  canBuy: boolean;
  /** Opens the PayPal checkout for a product on the rail. */
  onBuy: (detectionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: "user", text: t }];
    setMsgs(next);
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch(`/api/live/${encodeURIComponent(creatorSlug)}/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId, messages: next.slice(-12).map(({ role, text }) => ({ role, text })) }),
      });
      const data = (await res.json()) as { reply?: string; error?: string; actions?: Msg["actions"]; checkout?: Offer | null };
      setMsgs([...next, { role: "assistant", text: data.reply ?? data.error ?? "Something went wrong.", actions: data.actions, checkout: data.checkout }]);
    } catch {
      setMsgs([...next, { role: "assistant", text: "I couldn't reach Seen. Check your connection and try again." }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="brand-bg fixed bottom-5 right-5 z-40 h-12 gap-2 rounded-full border-0 px-5 text-white shadow-lift hover:brightness-110"
      >
        <Sparkles aria-hidden />
        Ask about these products
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden /> Shopping assistant
            </SheetTitle>
            <SheetDescription>
              Ask about anything on {creatorName}&apos;s stream. It can find products, compare prices and get them ready to buy. You always
              approve the payment in PayPal.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {msgs.length === 0 && (
              <div className="grid gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => void send(s.text)}
                    className="surface flex items-center gap-2.5 p-3 text-start text-sm transition hover:border-primary/40 hover:bg-accent/50"
                  >
                    <s.icon className="size-4 shrink-0 text-primary" aria-hidden />
                    {s.text}
                  </button>
                ))}
              </div>
            )}

            {msgs.map((m, i) =>
              m.role === "user" ? (
                <p key={i} className="ms-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                  {m.text}
                </p>
              ) : (
                <div key={i} className="max-w-[92%] space-y-2">
                  <div className="rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm">
                    <Formatted text={m.text} />
                  </div>
                  {m.actions && m.actions.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {m.actions.map((a, j) => (
                        <span key={j} className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
                          {a.ok ? <Check className="size-3 text-success" aria-hidden /> : <X className="size-3" aria-hidden />}
                          {TOOL_LABELS[a.tool] ?? a.tool}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.checkout && (
                    <div className="surface flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{m.checkout.title}</p>
                        <p className="text-sm font-semibold tabular-nums">{m.checkout.price}</p>
                      </div>
                      <Button
                        disabled={!canBuy}
                        onClick={() => {
                          setOpen(false);
                          onBuy(m.checkout!.detectionId);
                        }}
                      >
                        {canBuy ? "Buy now" : "Checkout unavailable"}
                      </Button>
                    </div>
                  )}
                </div>
              ),
            )}
            {busy && <p className="text-sm text-muted-foreground">Looking…</p>}
            <div ref={end} />
          </div>

          <form
            className="flex items-end gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              placeholder="e.g. Is the hoodie cheaper anywhere else?"
              aria-label="Message"
              rows={1}
              className="min-h-10 resize-none"
              maxLength={1000}
            />
            <Button type="submit" size="icon" disabled={busy || !draft.trim()} aria-label="Send">
              <Send aria-hidden />
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
