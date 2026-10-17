"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { DataGrid } from "@/components/grid/data-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Earnings } from "@/lib/commerce/earnings";
import { formatMoney } from "@/lib/money";

type Row = Earnings["rows"][number];
type ProductRow = Earnings["products"][number];

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

const mmss = (sec: number | null) =>
  sec === null ? "—" : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Per-product performance: clicks → sales → conversion → commission (AG Grid). */
export function ProductsGrid({ rows }: { rows: ProductRow[] }) {
  const columns: ColDef<ProductRow>[] = [
    { field: "product", headerName: "Product", minWidth: 220 },
    {
      headerName: "Best moment",
      valueGetter: (p) => (p.data?.bestMoment ? `${p.data.bestMoment.stream} @ ${mmss(p.data.bestMoment.tsSec)}` : "—"),
      minWidth: 220,
    },
    { field: "clicks", headerName: "Clicks", maxWidth: 110 },
    { field: "sales", headerName: "Sales", maxWidth: 110 },
    { field: "conversionPct", headerName: "Conversion", valueFormatter: (p) => `${p.value}%`, maxWidth: 140 },
    {
      field: "commissionMinor",
      headerName: "Commission",
      valueFormatter: (p) => formatMoney(p.value as number, p.data?.currency ?? "USD"),
      maxWidth: 160,
    },
  ];
  return <DataGrid label="Products" rows={rows} columns={columns} getRowId={(r) => r.productId} csvName="seen-products.csv" height={300} />;
}

/** Every sale's commission with its payout status pill and a refund action (AG Grid). */
export function EarningsTable({ rows, canRefund }: { rows: Row[]; canRefund: boolean }) {
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

  const columns: ColDef<Row>[] = [
    { field: "createdAt", headerName: "Date", valueFormatter: (p) => new Date(p.value as string).toLocaleString(), minWidth: 170 },
    { field: "product", headerName: "Product", minWidth: 200 },
    { headerName: "Moment", valueGetter: (p) => (p.data ? `${p.data.streamTitle ?? "—"} @ ${mmss(p.data.momentSec)}` : ""), minWidth: 200 },
    {
      field: "orderTotalMinor",
      headerName: "Order",
      valueFormatter: (p) =>
        p.data ? `${formatMoney(p.data.orderTotalMinor, p.data.currency)}${p.data.refundedMinor ? ` (−${formatMoney(p.data.refundedMinor, p.data.currency)})` : ""}` : "",
      maxWidth: 170,
    },
    {
      headerName: "Commission",
      valueGetter: (p) => (p.data ? p.data.amountMinor - p.data.reversedMinor : 0),
      valueFormatter: (p) => formatMoney(p.value as number, p.data?.currency ?? "USD"),
      maxWidth: 150,
    },
    {
      field: "status",
      headerName: "Payout",
      maxWidth: 150,
      cellRenderer: (p: ICellRendererParams<Row>) => (
        <Badge variant={STATUS_STYLE[p.value as string] ?? "outline"}>{String(p.value).replace("_", " ").toLowerCase()}</Badge>
      ),
    },
    {
      headerName: "",
      sortable: false,
      filter: false,
      maxWidth: 120,
      cellRenderer: (p: ICellRendererParams<Row>) =>
        canRefund && p.data?.refundable ? (
          <Button variant="ghost" size="sm" disabled={refunding === p.data.orderId} onClick={() => refund(p.data!.orderId)}>
            {refunding === p.data.orderId ? "Refunding…" : "Refund"}
          </Button>
        ) : null,
    },
  ];

  if (rows.length === 0) return <p className="text-muted-foreground">No sales yet.</p>;
  return <DataGrid label="Sales ledger" rows={rows} columns={columns} getRowId={(r) => r.id} csvName="seen-earnings.csv" />;
}
