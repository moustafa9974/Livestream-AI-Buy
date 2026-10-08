"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Earnings } from "@/lib/commerce/earnings";
import { formatMoney } from "@/lib/money";

const STATUS_STYLE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  PAID: "default",
  ELIGIBLE: "secondary",
  PENDING: "outline",
  PAYOUT_SENT: "secondary",
  UNCLAIMED: "outline",
  FAILED: "destructive",
  RETURNED: "destructive",
  REVERSED: "outline",
};

function moment(sec: number | null) {
  if (sec === null) return "—";
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

export function EarningsTable({ rows, canRefund }: { rows: Earnings["rows"]; canRefund: boolean }) {
  const router = useRouter();
  const [refunding, setRefunding] = useState<string | null>(null);

  async function refund(orderId: string) {
    if (!confirm("Refund this order in full? The creator's commission will be reversed.")) return;
    setRefunding(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error);
      toast.success("Refunded; commission reversed");
    } catch (err) {
      toast.error(`Refund failed${err instanceof Error && err.message ? `: ${err.message}` : ""}`);
    } finally {
      setRefunding(null);
      router.refresh();
    }
  }

  if (rows.length === 0) return <p className="text-muted-foreground">No sales yet.</p>;

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Moment</TableHead>
            <TableHead className="text-end">Order</TableHead>
            <TableHead className="text-end">Commission</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">
                {r.product}
                {r.streamTitle && <span className="block text-xs text-muted-foreground">{r.streamTitle}</span>}
              </TableCell>
              <TableCell className="tabular-nums">{moment(r.momentSec)}</TableCell>
              <TableCell className="text-end tabular-nums">
                {formatMoney(r.orderTotalMinor, r.currency)}
                {r.refundedMinor > 0 && (
                  <span className="block text-xs text-muted-foreground">−{formatMoney(r.refundedMinor, r.currency)} refunded</span>
                )}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {formatMoney(r.amountMinor - r.reversedMinor, r.currency)}
                {r.reversedMinor > 0 && (
                  <span className="block text-xs text-muted-foreground">of {formatMoney(r.amountMinor, r.currency)}</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_STYLE[r.status] ?? "outline"}>{r.status.replace("_", " ").toLowerCase()}</Badge>
              </TableCell>
              <TableCell>
                {canRefund && r.refundable && (
                  <Button variant="ghost" size="sm" disabled={refunding === r.orderId} onClick={() => refund(r.orderId)}>
                    {refunding === r.orderId ? "Refunding…" : "Refund"}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
