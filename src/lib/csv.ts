/** Minimal RFC 4180 CSV writer. Uses ";" by default (French Excel friendly). */
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; header: string }[], sep = ";"): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.header)).join(sep)];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c.key])).join(sep));
  return "﻿" + lines.join("\r\n"); // BOM so Excel detects UTF-8
}

/** Cents → "1234,56" for spreadsheets. */
export function centsToCsv(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}
