/** Display helpers for parts screens (no "use client": server pages and client forms share them). */

/** A quantity without trailing zeros: "4", "2.5", "0.333". */
export function fmtQty(v: unknown): string {
  const n = Number(String(v ?? 0));
  return n.toLocaleString("en-GB", { maximumFractionDigits: 3 });
}

/** A unit cost held to 4 decimals of a cent, shown to the cent. */
export function pmpCents(v: unknown): number {
  return Math.round(Number(String(v ?? 0)));
}

export const centsToInput = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2));

export const bpToPercent = (bp: number) => `${(bp / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })} %`;

/** A quantity for an input box: no thousands separator (a comma reads as the decimal mark). */
export const qtyInput = (v: unknown) => String(Number(String(v ?? 0)));
