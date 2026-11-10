"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface Props {
  products: Array<{ id: string; title: string }>;
  holdHours: number;
  holdOverridden: boolean;
  kernelRunning: number;
}

export function DemoPanel({ products, holdHours, holdOverridden, kernelRunning }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [productId, setProductId] = useState(products.find((p) => p.title.includes("Hoodie: Black"))?.id ?? products[0]?.id ?? "");

  async function run(action: string, extra: Record<string, unknown> = {}, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(action);
    try {
      let key = "";
      try {
        key = localStorage.getItem("seen-demo-key") ?? "";
      } catch {
        // storage blocked: ask each time
      }
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { "x-demo-key": key } : {}) },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = (await res.json()) as Record<string, unknown> & { error?: string; code?: string };
      if (data.code === "DEMO_KEY") {
        // Public deployment: ask for the presenter's key once, then retry.
        const entered = window.prompt("Demo panel key (DEMO_PANEL_KEY):")?.trim();
        if (entered) {
          try {
            localStorage.setItem("seen-demo-key", entered);
          } catch {
            // ignore
          }
          setBusy(null);
          return run(action, extra);
        }
        throw new Error("Demo key required");
      }
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
    <div className="space-y-4">
      <section className="surface space-y-2 border-destructive/20 p-5">
        <h2 className="font-semibold">Reset</h2>
        <p className="text-sm text-muted-foreground">Restore the demo creator, products and past sales.</p>
        {btn("reset", "Reset demo data", {}, "Wipe all orders, detections and payouts and restore the demo?", "destructive")}
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="font-semibold">Detections</h2>
        <div className="flex flex-wrap gap-2">{btn("inject_frame", "Inject a known frame (mugs)")}</div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            aria-label="Product"
            className="h-8 rounded-lg border bg-card px-2 text-sm shadow-sm"
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
        <p className="text-xs text-muted-foreground">Force detection shows a product to viewers instantly. A simulated sale records a sale without a payment.</p>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="font-semibold">Payout timing</h2>
        <p className="text-sm">
          Commission hold: <b>{holdHours} h</b> {holdOverridden && <span className="text-muted-foreground">(overridden)</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          {btn("settings", "Hold 0 h (instant payouts)", { commissionHoldHours: 0 })}
          {btn("settings", "Hold 72 h (realistic)", { commissionHoldHours: 72 })}
        </div>
      </section>

      <section className="surface space-y-2 p-5">
        <h2 className="font-semibold">KERNEL</h2>
        <p className="text-sm">Cloud browsers running: {kernelRunning}</p>
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
