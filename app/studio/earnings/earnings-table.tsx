"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { DataGrid } from "@/components/grid/data-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Earnings } from "@/lib/commerce/earnings";
import { formatMoney, sumMinor } from "@/lib/money";

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
    // Live page: these flash when a new click or sale changes them.
    { field: "clicks", headerName: "Clicks", maxWidth: 110, enableCellChangeFlash: true },
    { field: "sales", headerName: "Sales", maxWidth: 110, enableCellChangeFlash: true },
    { field: "conversionPct", headerName: "Conversion", valueFormatter: (p) => `${p.value}%`, maxWidth: 140, enableCellChangeFlash: true },
    {
      field: "commissionMinor",
      headerName: "Commission",
      valueFormatter: (p) => formatMoney(p.value as number, p.data?.currency ?? "USD"),
      maxWidth: 160,
      enableCellChangeFlash: true,
    },
  ];
  return <DataGrid label="Products" rows={rows} columns={columns} getRowId={(r) => r.productId} csvName="seen-products.csv" height={300} />;
}

/** Every sale's commission with its payout status pill and a refund action (AG Grid). */
export function EarningsTable({ rows, canRefund }: { rows: Row[]; canRefund: boolean }) {
  const router = useRouter();
  const [refunding, setRefunding] = useState<string | null>(null);

  // Sales that arrived while the page was open: glow for a few seconds and announce them.
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (known.current === null) {
      known.current = new Set(rows.map((r) => r.id)); // first render: nothing is "new"
      return;
    }
    const added = rows.filter((r) => !known.current!.has(r.id));
    if (added.length === 0) return;
    added.forEach((r) => known.current!.add(r.id));
    setFresh(new Set(added.map((r) => r.id)));
    for (const r of added.slice(0, 3)) {
      toast.success(`New sale: ${r.product}`, { description: `You earned ${formatMoney(r.amountMinor - r.reversedMinor, r.currency)}` });
    }
    const t = setTimeout(() => setFresh(new Set()), 6500);
    return () => clearTimeout(t);
  }, [rows]);

  // Pinned totals row (AG Grid PinnedRowModule). Only when all sales share one currency:
  // adding minor units across currencies would be meaningless.
  const totals = useMemo<Row[]>(() => {
    if (rows.length === 0 || rows.some((r) => r.currency !== rows[0].currency)) return [];
    return [
      {
        ...rows[0],
        id: "__totals",
        orderId: "",
        product: `${rows.length} sale${rows.length === 1 ? "" : "s"}`,
        streamTitle: null,
        momentSec: null,
        orderTotalMinor: sumMinor(rows.map((r) => r.orderTotalMinor)),
        refundedMinor: sumMinor(rows.map((r) => r.refundedMinor)),
        amountMinor: sumMinor(rows.map((r) => r.amountMinor)),
        reversedMinor: sumMinor(rows.map((r) => r.reversedMinor)),
        refundable: false,
      },
    ];
  }, [rows]);

  async function refund(row: Row) {
    const { orderId } = row;
    const amount = formatMoney(row.orderTotalMinor - row.refundedMinor, row.currency);
    if (!confirm(`Refund ${amount} to the buyer through PayPal? Your commission on this sale is reversed.`)) return;
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
    {
      field: "createdAt",
      headerName: "Date",
      valueFormatter: (p) => (p.node?.rowPinned ? "Total" : new Date(p.value as string).toLocaleString()),
      minWidth: 170,
    },
    { field: "product", headerName: "Product", minWidth: 200 },
    {
      headerName: "Moment",
      valueGetter: (p) => (p.data && !p.node?.rowPinned ? `${p.data.streamTitle ?? "—"} @ ${mmss(p.data.momentSec)}` : ""),
      minWidth: 200,
    },
    {
      field: "orderTotalMinor",
      headerName: "Order",
      valueFormatter: (p) =>
        p.data ? `${formatMoney(p.data.orderTotalMinor, p.data.currency)}${p.data.refundedMinor ? ` (−${formatMoney(p.data.refundedMinor, p.data.currency)})` : ""}` : "",
      maxWidth: 170,
      enableCellChangeFlash: true, // flashes when a refund lands
    },
    {
      headerName: "Commission",
      valueGetter: (p) => (p.data ? p.data.amountMinor - p.data.reversedMinor : 0),
      valueFormatter: (p) => formatMoney(p.value as number, p.data?.currency ?? "USD"),
      maxWidth: 150,
      enableCellChangeFlash: true,
    },
    {
      field: "status",
      headerName: "Payout",
      maxWidth: 150,
      enableCellChangeFlash: true, // eligible → payout sent → paid, live
      cellRenderer: (p: ICellRendererParams<Row>) =>
        p.node.rowPinned ? null : (
          <Badge variant={STATUS_STYLE[p.value as string] ?? "outline"}>{String(p.value).replace("_", " ").toLowerCase()}</Badge>
        ),
    },
    {
      headerName: "",
      sortable: false,
      filter: false,
      maxWidth: 120,
      cellRenderer: (p: ICellRendererParams<Row>) =>
        canRefund && p.data?.refundable && !p.node.rowPinned ? (
          <Button variant="ghost" size="sm" disabled={refunding === p.data.orderId} onClick={() => refund(p.data!)}>
            {refunding === p.data.orderId ? "Refunding…" : "Refund"}
          </Button>
        ) : null,
    },
  ];

  if (rows.length === 0) return <p className="text-muted-foreground">No sales yet.</p>;
  return (
    <DataGrid
      label="Sales ledger"
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      csvName="seen-earnings.csv"
      gridOptions={{
        pinnedBottomRowData: totals,
        rowClassRules: { "seen-new-row": (p) => !!p.data && fresh.has(p.data.id) },
      }}
    />
  );
}
