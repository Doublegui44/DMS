/** Parts selling prices: the discount matrix (discount code × customer price class), pure. */
import { applyRate, ratioBp, sumCents, type Cents } from "@/lib/money";
import { computeLine } from "@/modules/accounting";

export const PRICE_CLASSES = ["RETAIL", "TRADE", "INTERNAL", "WARRANTY"] as const;
export type PriceClass = (typeof PRICE_CLASSES)[number];

/** The discount a price class gets on a part, from its discount code's row of the matrix. */
export function discountFor(rates: readonly { priceClass: string; discountBp: number }[], priceClass: PriceClass): number {
  return rates.find((r) => r.priceClass === priceClass)?.discountBp ?? 0;
}

/** Net unit price excl. VAT after discount (display only: the invoice discounts the whole line). */
export function netUnitPrice(retailPriceCents: Cents, discountBp: number): Cents {
  return retailPriceCents - applyRate(retailPriceCents, discountBp);
}

/** A counter line, rounded exactly as the invoice will round it. */
export function counterLine(args: { qty: number; unitPriceCents: Cents; discountBp: number; vatRateBp: number }) {
  return computeLine({ quantity: args.qty, unitPriceExclVatCents: args.unitPriceCents, discountBp: args.discountBp, vatRateBp: args.vatRateBp });
}

export function counterTotals(lines: readonly { lineExclVatCents: Cents; vatCents: Cents }[]) {
  const totalExclVatCents = sumCents(lines.map((l) => l.lineExclVatCents));
  const vatCents = sumCents(lines.map((l) => l.vatCents));
  return { totalExclVatCents, vatCents, totalInclVatCents: totalExclVatCents + vatCents };
}

/** Gross margin on parts sold: revenue excl. VAT − cost at PMP. */
export function partsMargin(revenueCents: Cents, costCents: Cents) {
  const marginCents = revenueCents - costCents;
  return { marginCents, marginBp: revenueCents > 0 ? ratioBp(marginCents, revenueCents) : 0 };
}
