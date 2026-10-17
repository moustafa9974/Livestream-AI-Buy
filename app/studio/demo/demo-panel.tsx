"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface Props {
  products: Array<{ id: string; title: string }>;
  holdHours: number;
  holdOverridden: boolean;
  aiProvider: string;
  kernelRunning: number;
}

export function DemoPanel({ products, holdHours, holdOverridden, aiProvider, kernelRunning }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [productId, setProductId] = useState(products.find((p) => p.title.includes("Hoodie: Black"))?.id ?? products[0]?.id ?? "");

  async function run(action: string, extra: Record<string, unknown> = {}, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(action);
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = (await res.json()) as Record<string, unknown> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast.success(describe(action, data));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const btn = (action: string, label: string, extra?: Record<string, unknown>, confirmText?: string, variant: "default" | "outline" | "destructive" = "outline") => (
    <Button variant={variant} disabled={busy !== null} onClick={() => run(action, extra, confirmText)}>
      {busy === action ? "Working…" : label}
    </Button>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-2 rounded-xl border p-4">
        <h2 className="font-semibold">Reset</h2>
        <p className="text-sm text-muted-foreground">Restore the seeded demo (creator, catalog, past sales). Keeps AI caches and quota counters.</p>
        {btn("reset", "Reset demo data", {}, "Wipe all orders, detections and payouts and restore the demo?", "destructive")}
      </section>

      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="font-semibold">Detections</h2>
        <div className="flex flex-wrap gap-2">{btn("inject_frame", "Inject a known frame (mugs)")}</div>
        <p className="text-xs text-muted-foreground">Runs a stored screenshot through the real pipeline (uses 1 AI request unless cached).</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            aria-label="Product"
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          {btn("force_detection", "Force detection", { productId })}
          {btn("simulate_sale", "Simulate a sale (no money)", { productId })}
        </div>
        <p className="text-xs text-muted-foreground">Force detection puts the product on the viewers&apos; rail with zero AI quota. A simulated sale exercises commission, ticker and Zapier without PayPal.</p>
      </section>

      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="font-semibold">Runtime settings</h2>
        <p className="text-sm">
          Commission hold: <b>{holdHours} h</b> {holdOverridden && <span className="text-muted-foreground">(overridden)</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          {btn("settings", "Hold 0 h (instant payouts)", { commissionHoldHours: 0 })}
          {btn("settings", "Hold 72 h (realistic)", { commissionHoldHours: 72 })}
        </div>
        <p className="text-sm">
          AI provider: <b>{aiProvider}</b>
        </p>
        <div className="flex flex-wrap gap-2">
          {btn("settings", "Use Gemini", { aiProvider: "gemini" })}
          {btn("settings", "Use Ollama (local)", { aiProvider: "ollama" })}
        </div>
      </section>

      <section className="space-y-2 rounded-xl border p-4">
        <h2 className="font-semibold">KERNEL</h2>
        <p className="text-sm">Running cloud browsers: {kernelRunning}</p>
        {btn("kill_kernel", "Kill all KERNEL sessions", {}, undefined, "destructive")}
      </section>
    </div>
  );
}

function describe(action: string, d: Record<string, unknown>): string {
  switch (action) {
    case "reset":
      return "Demo data restored";
    case "inject_frame":
      return d.note ? String(d.note) : `Frame analysed (${d.source}): ${d.items} items`;
    case "force_detection":
      return "Detection added to the live rail";
    case "simulate_sale":
      return "Simulated sale recorded";
    case "kill_kernel":
      return `Stopped ${d.stopped} KERNEL session(s)`;
    default:
      return "Saved";
  }
}
