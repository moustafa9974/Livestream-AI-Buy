"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

const SUGGESTIONS = ["How much did I earn this week?", "What are my top products?", "List my last 3 orders", "Hide all sunglasses"];

/** Slide-over chat with the creator assistant (Gemini + our tools + PayPal Agent Toolkit). */
export function AssistantSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next = [...messages, { role: "user" as const, text: t }].slice(-20);
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/studio/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      setMessages((m) => [...m, { role: "assistant", text: data.reply ?? data.error ?? "Something went wrong." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "I couldn't reach the server. Try again." }]);
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Ask Seen</SheetTitle>
          <SheetDescription>Your earnings, orders and stream, in plain words. Payouts and refunds only when you ask explicitly.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">
                  {s}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                m.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-muted"
              }`}
            >
              {m.text}
            </div>
          ))}
          {busy && <div className="self-start rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">Thinking…</div>}
          <div ref={endRef} />
        </div>
        <form
          className="flex gap-2 p-4"
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
            placeholder="e.g. pay me now"
            rows={2}
            aria-label="Message"
            className="resize-none"
          />
          <Button type="submit" disabled={busy || !input.trim()}>
            Send
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
