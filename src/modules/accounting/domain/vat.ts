/** Invoice line and VAT calculations (pure). Amounts in cents, rates in basis points. */
import { applyRate, roundCents, sumCents, splitIncl, type Cents } from "@/lib/money";

export type VatRegime = "STANDARD" | "MARGIN";

export interface LineInput {
  quantity: number; // up to 3 decimals
  unitPriceExclVatCents: Cents;
  discountBp?: number;
  vatRateBp: number;
}

/** Line amount excl. VAT after discount, and its VAT (VAT computed per line on the excl. amount). */
export function computeLine(line: LineInput): { lineExclVatCents: Cents; vatCents: Cents } {
  if (line.quantity === 0) throw new RangeError("Quantity cannot be zero");
  const gross = roundCents(line.quantity * line.unitPriceExclVatCents);
  const discount = line.discountBp ? applyRate(gross, line.discountBp) : 0;
  const lineExclVatCents = gross - discount;
  return { lineExclVatCents, vatCents: applyRate(lineExclVatCents, line.vatRateBp) };
}

export interface ComputedLine {
  lineExclVatCents: Cents;
  vatCents: Cents;
  vatRateCode: string;
  vatRateBp: number;
}

export interface InvoiceTotals {
  totalExclVatCents: Cents;
  vatCents: Cents;
  totalInclVatCents: Cents;
  vatByRate: { vatRateCode: string; vatRateBp: number; baseCents: Cents; vatCents: Cents }[];
}

export function invoiceTotals(lines: ComputedLine[]): InvoiceTotals {
  const byRate = new Map<string, { vatRateCode: string; vatRateBp: number; baseCents: Cents; vatCents: Cents }>();
  for (const l of lines) {
    const k = `${l.vatRateCode}|${l.vatRateBp}`;
    const r = byRate.get(k) ?? { vatRateCode: l.vatRateCode, vatRateBp: l.vatRateBp, baseCents: 0, vatCents: 0 };
    r.baseCents += l.lineExclVatCents;
    r.vatCents += l.vatCents;
    byRate.set(k, r);
  }
  const totalExclVatCents = sumCents(lines.map((l) => l.lineExclVatCents));
  const vatCents = sumCents(lines.map((l) => l.vatCents));
  return { totalExclVatCents, vatCents, totalInclVatCents: totalExclVatCents + vatCents, vatByRate: [...byRate.values()] };
}

/**
 * VAT on margin (régime de la marge, used vehicles bought from private sellers).
 * Margin incl. VAT = selling price incl. VAT − purchase price (reconditioning is NOT deducted).
 * VAT = margin incl. VAT × rate / (1 + rate). A negative margin gives zero VAT (no refund).
 */
export function marginVat(args: { salePriceInclCents: Cents; purchasePriceCents: Cents; rateBp: number }): {
  marginInclCents: Cents;
  marginExclCents: Cents;
  vatCents: Cents;
} {
  const marginInclCents = args.salePriceInclCents - args.purchasePriceCents;
  if (marginInclCents <= 0) return { marginInclCents, marginExclCents: marginInclCents, vatCents: 0 };
  const { exclCents, vatCents } = splitIncl(marginInclCents, args.rateBp);
  return { marginInclCents, marginExclCents: exclCents, vatCents };
}

/** Due date from issue date and payment terms. */
export function dueDate(issueDate: Date, termsDays: number): Date {
  const d = new Date(issueDate.getTime());
  d.setUTCDate(d.getUTCDate() + termsDays);
  return d;
}

/**
 * Margin-regime line (one used vehicle): the price entered is incl. VAT; VAT is due on the margin only.
 * The line "excl. VAT" amount is the price minus that VAT, so that excl. + VAT = price.
 */
export function computeMarginLine(args: { salePriceInclCents: Cents; purchasePriceCents: Cents; rateBp: number }): {
  lineExclVatCents: Cents;
  vatCents: Cents;
} {
  const { vatCents } = marginVat(args);
  return { lineExclVatCents: args.salePriceInclCents - vatCents, vatCents };
}
