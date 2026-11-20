/** Replenishment, purchase orders and supplier-invoice matching, pure. */
import Decimal from "decimal.js";
import { applyRate, sumCents, type Cents } from "@/lib/money";
import { dec, valueOf } from "./valuation";

// ── Replenishment ───────────────────────────────────────────

export interface StockLevels {
  onHand: unknown;
  reserved: unknown;
  onOrder: unknown;
  min: unknown;
  max: unknown;
}

/** Stock that can still be sold: on hand minus what confirmed sales have reserved. */
export function availableQty(s: Pick<StockLevels, "onHand" | "reserved">): Decimal {
  return dec(s.onHand).minus(dec(s.reserved));
}

/** True when available stock is under the minimum (a minimum of 0 never triggers). */
export function isBelowMin(s: Pick<StockLevels, "onHand" | "reserved" | "min">): boolean {
  const min = dec(s.min);
  return min.gt(0) && availableQty(s).lt(min);
}

/**
 * Quantity to order: when available stock plus what is already on order is under the minimum,
 * enough whole units to get back to the maximum (or to the minimum when the maximum is lower).
 */
export function suggestedQty(s: StockLevels): Decimal {
  const min = dec(s.min);
  if (min.lte(0)) return new Decimal(0);
  const position = availableQty(s).plus(dec(s.onOrder));
  if (position.gte(min)) return new Decimal(0);
  return Decimal.max(dec(s.max), min).minus(position).ceil();
}

/** Status of a sent purchase order from its lines. */
export function purchaseOrderStatus(lines: readonly { ordered: unknown; received: unknown }[]): "SENT" | "PARTIAL" | "RECEIVED" {
  const received = lines.filter((l) => dec(l.received).gt(0));
  if (received.length === 0) return "SENT";
  return lines.every((l) => dec(l.received).gte(dec(l.ordered))) ? "RECEIVED" : "PARTIAL";
}

/** Units still expected on a line: ordered − received (zero once the order is closed). */
export function backorderQty(line: { ordered: unknown; received: unknown }): Decimal {
  return Decimal.max(dec(line.ordered).minus(dec(line.received)), 0);
}

// ── Supplier-invoice matching ───────────────────────────────

/** A price variance within max(amount, rate × receipt value) is accepted without approval. */
export interface InvoiceTolerance {
  amountCents: Cents;
  rateBp: number;
}

export const DEFAULT_TOLERANCE: InvoiceTolerance = { amountCents: 500, rateBp: 100 };

/**
 * One supplier-invoice line against the receipt line it bills. The receipt value it clears is
 * qty × receipt cost; billing the last units clears whatever value is left, so the
 * goods-received-not-invoiced account empties to the cent.
 */
export function matchLine(a: {
  qty: Decimal.Value;
  unitCostCents: Cents;
  receiptUnitCostCents: Cents;
  remainingQty: Decimal.Value;
  remainingValueCents: Cents;
}): { amountCents: Cents; receiptValueCents: Cents; varianceCents: Cents } {
  const qty = new Decimal(a.qty);
  const remaining = new Decimal(a.remainingQty);
  if (qty.lte(0)) throw new RangeError("Invoiced quantity must be positive");
  if (qty.gt(remaining)) throw new RangeError(`Only ${remaining.toString()} left to invoice on this receipt line`);
  if (!Number.isSafeInteger(a.unitCostCents) || a.unitCostCents < 0) throw new RangeError("Invalid unit price");
  const amountCents = valueOf(qty, a.unitCostCents);
  const receiptValueCents = qty.eq(remaining) ? a.remainingValueCents : Math.min(valueOf(qty, a.receiptUnitCostCents), a.remainingValueCents);
  return { amountCents, receiptValueCents, varianceCents: amountCents - receiptValueCents };
}

export function withinTolerance(varianceCents: Cents, receiptValueCents: Cents, tolerance: InvoiceTolerance): boolean {
  return Math.abs(varianceCents) <= Math.max(tolerance.amountCents, applyRate(Math.abs(receiptValueCents), tolerance.rateBp));
}

/** Supplier invoice totals: VAT on the total excl. VAT, as suppliers invoice it. */
export function supplierInvoiceTotals(lines: readonly { amountCents: Cents }[], vatRateBp: number) {
  const totalExclVatCents = sumCents(lines.map((l) => l.amountCents));
  const vatCents = applyRate(totalExclVatCents, vatRateBp);
  return { totalExclVatCents, vatCents, totalInclVatCents: totalExclVatCents + vatCents };
}
