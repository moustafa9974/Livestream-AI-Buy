"use client";

import { useRef, useState } from "react";
import { AllCommunityModule, ModuleRegistry, colorSchemeDark, themeQuartz, type ColDef, type GridOptions } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// AG Grid Community (MIT). Registered once per page load.
ModuleRegistry.registerModules([AllCommunityModule]);

// Colours come from the app's CSS tokens (app/globals.css) so the grid matches the studio.
// colorSchemeDark covers the parts our tokens don't (checkboxes, menus, scrollbars).
const theme = themeQuartz.withPart(colorSchemeDark).withParams({
  fontFamily: "inherit",
  fontSize: 13,
  headerFontWeight: 600,
  borderRadius: 8,
  wrapperBorderRadius: 14,
  accentColor: "var(--primary)",
  foregroundColor: "var(--foreground)",
  backgroundColor: "var(--card)",
  borderColor: "var(--border)",
  headerBackgroundColor: "var(--muted)",
  headerTextColor: "var(--muted-foreground)",
  rowHoverColor: "color-mix(in oklch, var(--accent), transparent 55%)",
  oddRowBackgroundColor: "color-mix(in oklch, var(--muted), transparent 60%)",
});

interface Props<T> {
  rows: T[];
  columns: ColDef<T>[];
  /** CSV file name; omit to hide the export button. */
  csvName?: string;
  getRowId?: (row: T) => string;
  height?: number;
  label: string;
  gridOptions?: GridOptions<T>;
}

/** AG Grid with a quick filter box and CSV export, styled to match the app. */
export function DataGrid<T>({ rows, columns, csvName, getRowId, height = 420, label, gridOptions }: Props<T>) {
  const gridRef = useRef<AgGridReact<T>>(null);
  const [filter, setFilter] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Quick filter…"
          aria-label={`Filter ${label}`}
          className="max-w-xs bg-card"
        />
        {csvName && (
          <Button variant="outline" size="sm" onClick={() => gridRef.current?.api.exportDataAsCsv({ fileName: csvName })}>
            Export CSV
          </Button>
        )}
      </div>
      <div style={{ height }} role="region" aria-label={label} className="rounded-[14px] shadow-card">
        <AgGridReact<T>
          ref={gridRef}
          theme={theme}
          rowData={rows}
          columnDefs={columns}
          quickFilterText={filter}
          getRowId={getRowId ? (p) => getRowId(p.data) : undefined}
          defaultColDef={{ sortable: true, resizable: true, filter: true, minWidth: 90, flex: 1 }}
          animateRows
          {...gridOptions}
        />
      </div>
    </div>
  );
}
