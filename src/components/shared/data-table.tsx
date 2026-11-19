"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { StatusBadge, type Tone } from "./status-badge";

/** Serializable cell values, so server pages can build rows without passing functions. */
export type CellValue =
  | string
  | number
  | null
  | boolean
  | { kind: "link"; href: string; label: string; sub?: string }
  | { kind: "badge"; status: string; label: string; tone?: Tone }
  | { kind: "badges"; items: { status: string; label: string; tone?: Tone }[] }
  | { kind: "money"; cents: number | null }
  | { kind: "date"; iso: string | null }
  | { kind: "mono"; value: string | null };

export interface ColumnSpec {
  key: string;
  header: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  className?: string;
}

export interface FilterSpec {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export type Row = { id: string } & Record<string, CellValue>;

function renderCell(v: CellValue) {
  if (v === null || v === undefined || v === "") return <span className="text-muted-foreground">—</span>;
  if (typeof v === "boolean") return v ? "✓" : "";
  if (typeof v === "string" || typeof v === "number") return v;
  switch (v.kind) {
    case "link":
      return (
        <Link href={v.href} className="font-medium text-primary hover:underline">
          {v.label}
          {v.sub && <span className="ml-1.5 font-normal text-muted-foreground">{v.sub}</span>}
        </Link>
      );
    case "badge":
      return <StatusBadge status={v.status} label={v.label} tone={v.tone} />;
    case "badges":
      return (
        <span className="flex flex-wrap gap-1">
          {v.items.map((b, i) => (
            <StatusBadge key={i} status={b.status} label={b.label} tone={b.tone} />
          ))}
        </span>
      );
    case "money":
      return <span className="tabular-nums">{formatMoney(v.cents)}</span>;
    case "date":
      return <span className="tabular-nums">{v.iso ? formatDate(v.iso) : "—"}</span>;
    case "mono":
      return <span className="font-mono text-xs">{v.value ?? "—"}</span>;
  }
}

export function DataTable({
  columns,
  rows,
  total,
  page,
  pageSize,
  filters = [],
  exportHref,
  toolbar,
}: {
  columns: ColumnSpec[];
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  filters?: FilterSpec[];
  exportHref?: string;
  toolbar?: React.ReactNode;
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const setParams = (updates: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Debounced search.
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const id = setTimeout(() => setParams({ q }), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const sort = params.get("sort");
  const dir = params.get("dir") ?? "desc";

  const tableColumns = useMemo<ColumnDef<Row>[]>(
    () =>
      columns.map((c) => ({
        id: c.key,
        accessorFn: (r) => r[c.key],
        header: c.header,
        cell: (info) => renderCell(info.getValue() as CellValue),
        meta: c,
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount: total,
  });

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const exportUrl = exportHref ? `${exportHref}${exportHref.includes("?") ? "&" : "?"}${params.toString()}` : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            className="h-8 pl-7 text-[13px]"
            aria-label={t("search")}
            data-testid="table-search"
          />
        </div>
        {filters.map((f) => (
          <select
            key={f.key}
            aria-label={f.label}
            className="h-8 rounded-md border bg-background px-2 text-[13px]"
            value={params.get(f.key) ?? ""}
            onChange={(e) => setParams({ [f.key]: e.target.value })}
          >
            <option value="">
              {f.label}: {t("all")}
            </option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
        <div className="flex-1" />
        {toolbar}
        {exportUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={exportUrl}>
              <Download /> {t("exportCsv")}
            </a>
          </Button>
        )}
      </div>

      <div className={cn("overflow-x-auto rounded-lg border bg-card transition-opacity", pending && "opacity-60")}>
        <Table className="text-[13px]">
          <TableHeader className="sticky top-0 bg-muted/50">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => {
                  const spec = h.column.columnDef.meta as ColumnSpec;
                  const active = sort === spec.key;
                  return (
                    <TableHead
                      key={h.id}
                      className={cn("h-8 whitespace-nowrap text-xs", spec.align === "right" && "text-right", spec.className)}
                    >
                      {spec.sortable ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() =>
                            setParams({ sort: spec.key, dir: active && dir === "asc" ? "desc" : "asc" }, false)
                          }
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {active ? (
                            dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-20 text-center text-muted-foreground">
                  {t("noResults")}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-testid="table-row">
                  {row.getVisibleCells().map((cell) => {
                    const spec = cell.column.columnDef.meta as ColumnSpec;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          "py-1.5",
                          spec.align === "right" && "text-right tabular-nums",
                          spec.align === "center" && "text-center",
                          spec.className,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span data-testid="table-total">{t("rowsTotal", { count: total })}</span>
        <div className="flex items-center gap-2">
          <span>{t("page", { page, pages })}</span>
          <Button
            variant="outline"
            size="xs"
            disabled={page <= 1}
            onClick={() => setParams({ page: String(page - 1) }, false)}
          >
            {t("previous")}
          </Button>
          <Button
            variant="outline"
            size="xs"
            disabled={page >= pages}
            onClick={() => setParams({ page: String(page + 1) }, false)}
          >
            {t("next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
