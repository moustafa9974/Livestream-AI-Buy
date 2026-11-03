"use client";

import { Fragment, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Check, CircleDollarSign, Radio, RotateCcw, Send, Sparkles, Trophy, Wallet, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

interface Msg {
  role: "user" | "assistant";
  text: string;
  actions?: Array<{ tool: string; ok: boolean }>;
  mode?: "ai" | "quick";
}

const SUGGESTIONS = [
  { text: "How much did I earn this week?", icon: CircleDollarSign },
  { text: "What are my top products?", icon: Trophy },
  { text: "What's on screen right now?", icon: Radio },
  { text: "How are my payouts doing?", icon: Wallet },
  { text: "When is my next stream?", icon: CalendarDays },
  { text: "Hide all sunglasses", icon: X },
];

// What each tool did, in the creator's words (shown as chips under a reply).
const TOOL_LABELS: Record<string, string> = {
  earnings_summary: "Checked earnings",
  top_products: "Ranked products",
  recent_orders: "Looked up orders",
  stream_status: "Checked live stream",
  payout_status: "Checked payouts",
  upcoming_streams: "Checked schedule",
  hide_detections: "Hid products",
  pay_me_now: "Sent payout",
  refund_order: "Refunded order",
  paypal_order_details: "PayPal order lookup",
  paypal_recent_transactions: "PayPal transactions",
};

/** **bold** spans inside one line of text. */
function inline(line: string): ReactNode {
  return line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

/** Tiny formatter for the assistant's replies: paragraphs, "- " bullet lists, **bold**. No HTML is ever injected. */
function Formatted({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`ul${blocks.length}`} className="ms-4 list-disc space-y-0.5 marker:text-muted-foreground">
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) bullets.push(bullet[1]);
    else {
      flush();
      if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="space-y-1.5">{blocks}</div>;
}

/** Slide-over chat with the creator assistant (Gemini + our tools + PayPal Agent Toolkit). */
export function AssistantSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const scroll = () => setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next = [...messages, { role: "user" as const, text: t }].slice(-20);
    setMessages(next);
    setInput("");
    setBusy(true);
    scroll();
    try {
      const res = await fetch("/api/studio/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only role + text go back to the server.
        body: JSON.stringify({ messages: next.map(({ role, text: body }) => ({ role, text: body })) }),
      });
      const data = (await res.json()) as { reply?: string; error?: string; actions?: Msg["actions"]; mode?: Msg["mode"] };
      setMessages((m) => [...m, { role: "assistant", text: data.reply ?? data.error ?? "Something went wrong.", actions: data.actions, mode: data.mode }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "I couldn't reach the server. Try again." }]);
    } finally {
      setBusy(false);
      scroll();
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 shadow-lift sm:max-w-md">
        <SheetHeader className="border-b">
          <div className="flex items-center gap-2.5">
            <span className="brand-bg grid size-8 place-items-center rounded-lg text-white" aria-hidden>
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0">
              <SheetTitle>Ask Seen</SheetTitle>
              <SheetDescription className="text-xs">Earnings, orders, payouts and your stream, in plain words.</SheetDescription>
            </div>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" className="absolute end-12 top-3" onClick={() => setMessages([])} disabled={busy}>
              <RotateCcw /> Clear
            </Button>
          )}
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Ask about your sales or stream. Payouts and refunds happen only when you ask for them explicitly.
              </p>
              <div className="grid gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => send(s.text)}
                    className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2 text-start text-sm shadow-sm transition hover:border-primary/40 hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <s.icon className="size-4 shrink-0 text-primary" aria-hidden />
                    {s.text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="brand-bg max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-ee-md px-3 py-2 text-sm text-white">
                {m.text}
              </div>
            ) : (
              <div key={i} className="flex max-w-[90%] flex-col gap-1.5 self-start">
                <div data-role="assistant" className="rounded-2xl rounded-es-md bg-muted px-3 py-2 text-sm">
                  <Formatted text={m.text} />
                </div>
                {(m.actions?.length || m.mode === "quick") && (
                  <div className="flex flex-wrap gap-1">
                    {m.actions?.map((a, j) => (
                      <span
                        key={j}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          a.ok ? "bg-accent text-accent-foreground" : "bg-destructive/10 text-destructive"
                        }`}
                      >
                        {a.ok ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
                        {TOOL_LABELS[a.tool] ?? a.tool}
                      </span>
                    ))}
                    {m.mode === "quick" && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
                        title="The AI was busy, so this came straight from your data"
                      >
                        <Zap className="size-3" aria-hidden /> Quick answer
                      </span>
                    )}
                  </div>
                )}
              </div>
            ),
          )}

          {busy && (
            <div className="flex items-center gap-1 self-start rounded-2xl rounded-es-md border bg-card px-3 py-2.5" role="status" aria-label="Thinking">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className="size-1.5 rounded-full bg-primary/70 motion-safe:animate-bounce"
                  style={{ animationDelay: `${d * 150}ms` }}
                  aria-hidden
                />
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="flex items-end gap-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Ask anything, e.g. pay me now"
            rows={1}
            aria-label="Message"
            className="max-h-32 min-h-10 resize-none bg-card"
          />
          <Button type="submit" size="icon-lg" className="brand-bg shrink-0 border-0 text-white" disabled={busy || !input.trim()} aria-label="Send">
            <Send />
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
