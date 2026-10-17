"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { DataGrid } from "@/components/grid/data-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface DetectionRow {
  id: string;
  label: string;
  category: string;
  confidence: number;
  hits: number;
  state: "candidate" | "visible" | "pinned" | "hidden";
  match: string;
  firstSeenSec: number;
  clicks: number;
  sales: number;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

async function patch(id: string, body: Record<string, string>) {
  const res = await fetch(`/api/detections/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Update failed");
}

export function DetectionsGrid({ rows: initial }: { rows: DetectionRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);

  async function setState(id: string, state: DetectionRow["state"]) {
    try {
      await patch(id, { state });
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, state } : r)));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  const columns: ColDef<DetectionRow>[] = [
    {
      field: "label",
      headerName: "Label",
      editable: true,
      minWidth: 200,
      onCellValueChanged: async (e) => {
        const label = String(e.newValue ?? "").trim();
        if (!label || label === e.oldValue) return;
        try {
          await patch(e.data.id, { label });
          toast.success("Corrected. Re-matching products…");
          setTimeout(() => router.refresh(), 2500);
        } catch (err) {
          e.node?.setDataValue("label", e.oldValue);
          toast.error(err instanceof Error ? err.message : "Rename failed");
        }
      },
    },
    { field: "category", headerName: "Category" },
    { field: "confidence", headerName: "Confidence", valueFormatter: (p) => `${p.value}%`, maxWidth: 130 },
    { field: "hits", headerName: "Hits", maxWidth: 100 },
    { field: "firstSeenSec", headerName: "First seen", valueFormatter: (p) => mmss(p.value as number), maxWidth: 130 },
    {
      field: "state",
      headerName: "State",
      maxWidth: 130,
      cellRenderer: (p: ICellRendererParams<DetectionRow>) => (
        <Badge variant={p.value === "hidden" ? "secondary" : p.value === "candidate" ? "outline" : "default"}>{p.value}</Badge>
      ),
    },
    { field: "match", headerName: "Match", minWidth: 220 },
    { field: "clicks", headerName: "Clicks", maxWidth: 110 },
    { field: "sales", headerName: "Sales", maxWidth: 110 },
    {
      headerName: "Actions",
      sortable: false,
      filter: false,
      minWidth: 170,
      cellRenderer: (p: ICellRendererParams<DetectionRow>) =>
        p.data ? (
          <div className="flex h-full items-center gap-1">
            {p.data.state !== "pinned" && p.data.state !== "hidden" && (
              <Button size="sm" variant="ghost" onClick={() => setState(p.data!.id, "pinned")}>Pin</Button>
            )}
            {p.data.state !== "hidden" ? (
              <Button size="sm" variant="ghost" onClick={() => setState(p.data!.id, "hidden")}>Hide</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setState(p.data!.id, "visible")}>Show</Button>
            )}
          </div>
        ) : null,
    },
  ];

  return <DataGrid label="Detections" rows={rows} columns={columns} getRowId={(r) => r.id} csvName="seen-detections.csv" height={520} />;
}
