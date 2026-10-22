"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

interface Props {
  payableMinor: number;
  currency: string;
  openBatchId: string | null;
  unavailableReason: string | null;
}

const POLL_MS = 3000;
const MAX_POLLS = 40; // ~2 minutes; webhooks keep updating after that

export function PayMeNow({ payableMinor, currency, openBatchId, unavailableReason }: Props) {
  const router = useRouter();
  const [batchId, setBatchId] = useState<string | null>(openBatchId);
  const [busy, setBusy] = useState(false);

  // Poll the batch until PayPal reports a final status, refreshing the page each time
  // so the ledger and timeline update live.
  useEffect(() => {
    if (!batchId) return;
    let polls = 0;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      polls++;
      try {
        const res = await fetch(`/api/payouts/${batchId}/sync`, { method: "POST" });
        const data = (await res.json()) as { status?: string; final?: boolean };
        router.refresh();
        if (data.final || polls >= MAX_POLLS || !res.ok) {
          if (data.status === "SUCCESS") toast.success("Payout sent to your PayPal account 🎉");
          else if (data.final) toast.error(`Payout ended with status ${data.status}`);
          setBatchId(null);
          return;
        }
      } catch {
        // transient network issue; try again next tick
      }
      setTimeout(tick, POLL_MS);
    };
    const t = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }, [batchId, router]);

  async function pay() {
    setBusy(true);
    try {
      const res = await fetch("/api/payouts", { method: "POST" });
      const data = (await res.json()) as { status?: string; batchIds?: string[]; error?: string; code?: string };
      if (!res.ok) throw new Error(data.code ?? data.error ?? "Payout failed");
      if (data.status === "nothing_to_pay") {
        toast("Nothing to pay out yet");
      } else if (data.batchIds?.[0]) {
        toast.info("Payout submitted to PayPal…");
        setBatchId(data.batchIds[0]);
      }
      router.refresh();
    } catch (err) {
      toast.error(`Payout failed: ${err instanceof Error ? err.message : "unknown error"}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (unavailableReason) {
    return <p className="text-sm text-muted-foreground">Payouts unavailable ({unavailableReason})</p>;
  }
  return (
    <div className="flex items-center gap-3">
      {batchId && <span className="text-sm text-muted-foreground" role="status">Payout processing…</span>}
      <Button
        size="lg"
        className="brand-bg h-10 border-0 px-4 text-white shadow-sm hover:brightness-110"
        onClick={pay}
        disabled={busy || !!batchId || payableMinor <= 0}
      >
        {busy ? "Sending…" : `Pay me now · ${formatMoney(payableMinor, currency)}`}
      </Button>
    </div>
  );
}
