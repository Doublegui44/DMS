/**
 * Printable documents (D-069). One neutral shape that every PDF renders from, so the
 * template stays dumb and the money rules live here, tested. Labels are message keys
 * (`pdf.<key>`), never text: the template translates them.
 */

export const DOCUMENT_KINDS = ["invoice", "order", "repair-order", "warranty-claim"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type PrintTitle = "invoice" | "creditNote" | "orderForm" | "repairOrder" | "warrantyClaim";

export type PrintParty = { name: string; lines: string[]; ids?: { key: string; value: string }[] };
export type PrintField = { key: string; text?: string; date?: Date | null; cents?: number };
export type PrintLine = {
  label: string;
  detail?: string;
  qty?: string;
  unitCents?: number;
  discountBp?: number;
  /** null = no VAT shown on the line (VAT on the margin, or outside the scope of VAT). */
  vatRateBp?: number | null;
  amountCents: number;
};
/** `badge` is a message key (`pdf.badges.<badge>`), e.g. the payer of a repair-order job. */
export type PrintSection = { title?: string; badge?: string; note?: string; lines: PrintLine[]; subtotalCents?: number };
export type PrintTotal = { key: string; cents: number; strong?: boolean };
export type VatRow = { vatRateBp: number; baseCents: number; vatCents: number };

export type PrintDoc = {
  kind: DocumentKind;
  title: PrintTitle;
  number: string;
  date: Date | null;
  issuer: PrintParty;
  recipient: PrintParty;
  fields: PrintField[];
  /** Whether line amounts are shown excl. or incl. VAT. */
  amounts: "excl" | "incl";
  sections: PrintSection[];
  totals: PrintTotal[];
  vat: VatRow[];
  notes: string[];
  /** Signature boxes; `name` pre-fills the signatory when already known (signed at check-in). */
  signatures: { key: string; name?: string | null }[];
  mentions: string[];
};

/** Legal mentions per document, from the `documents.legalMentions` setting. */
export type LegalMentions = Record<"invoice" | "orderForm" | "repairOrder" | "warrantyClaim", string[]>;
export const NO_MENTIONS: LegalMentions = { invoice: [], orderForm: [], repairOrder: [], warrantyClaim: [] };

/** VAT summary per rate, in rate order. Lines without a rate (margin, out of scope) are left out. */
export function vatBreakdown(lines: { vatRateBp: number | null; baseCents: number; vatCents: number }[]): VatRow[] {
  const by = new Map<number, VatRow>();
  for (const l of lines) {
    if (l.vatRateBp === null) continue;
    const r = by.get(l.vatRateBp) ?? { vatRateBp: l.vatRateBp, baseCents: 0, vatCents: 0 };
    r.baseCents += l.baseCents;
    r.vatCents += l.vatCents;
    by.set(l.vatRateBp, r);
  }
  return [...by.values()].sort((a, b) => a.vatRateBp - b.vatRateBp);
}

type InvoiceLineIn = {
  label: string;
  quantity: { toString(): string } | number;
  unitPriceExclVatCents: number;
  discountBp: number;
  lineExclVatCents: number;
  vatRateBp: number;
  vatCents: number;
  vatRegime: string;
};

/**
 * Invoice lines and totals. A line under the margin scheme must not show its VAT: it is
 * printed incl. VAT, left out of the VAT summary, and the margin mention is required.
 */
export function invoiceBody(lines: InvoiceLineIn[], totalInclVatCents: number, paidCents: number) {
  const printLines: PrintLine[] = lines.map((l) => {
    const margin = l.vatRegime === "MARGIN";
    return {
      label: l.label,
      qty: qtyText(l.quantity),
      unitCents: margin ? undefined : l.unitPriceExclVatCents,
      discountBp: l.discountBp || undefined,
      vatRateBp: margin ? null : l.vatRateBp,
      amountCents: margin ? l.lineExclVatCents + l.vatCents : l.lineExclVatCents,
    };
  });
  const standard = lines.filter((l) => l.vatRegime !== "MARGIN");
  const marginInclCents = lines.filter((l) => l.vatRegime === "MARGIN").reduce((s, l) => s + l.lineExclVatCents + l.vatCents, 0);
  const vat = vatBreakdown(standard.map((l) => ({ vatRateBp: l.vatRateBp, baseCents: l.lineExclVatCents, vatCents: l.vatCents })));
  const totals: PrintTotal[] = [];
  if (marginInclCents) totals.push({ key: "marginGoods", cents: marginInclCents });
  totals.push({ key: "totalExclVat", cents: standard.reduce((s, l) => s + l.lineExclVatCents, 0) });
  totals.push({ key: "vat", cents: standard.reduce((s, l) => s + l.vatCents, 0) });
  totals.push({ key: "totalInclVat", cents: totalInclVatCents, strong: true });
  if (paidCents) {
    totals.push({ key: "paid", cents: paidCents });
    totals.push({ key: "balanceDue", cents: totalInclVatCents - paidCents, strong: true });
  }
  return { lines: printLines, totals, vat, hasMargin: marginInclCents !== 0 };
}

export function qtyText(q: { toString(): string } | number): string {
  const n = Number(q.toString());
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** Centi-hours as a quantity ("1.5"). */
export const hoursQty = (centiHours: number) => qtyText(centiHours / 100);

export function addressLines(p: { address?: string | null; postalCode?: string | null; city?: string | null }): string[] {
  return [p.address, [p.postalCode, p.city].filter(Boolean).join(" ")].filter((x): x is string => !!x && x.trim() !== "");
}

/** Download name: `<kind>-<number>.pdf`, safe for a header. */
export function documentFileName(kind: DocumentKind, number: string): string {
  return `${kind}-${number.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf`;
}
