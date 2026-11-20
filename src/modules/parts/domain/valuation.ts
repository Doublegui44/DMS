/**
 * Parts stock valuation at weighted average cost (PMP), pure.
 *
 * A stock item carries its quantity and its value in cents; the PMP is always value ÷ quantity
 * (4 decimals). Every movement moves a whole number of cents, so the sum of the movements equals
 * the item's value and the parts stock account equals the sub-ledger to the cent.
 */
import Decimal from "decimal.js";
import { ValidationError } from "@/lib/errors";

export { Decimal };

export interface StockState {
  qty: Decimal;
  valueCents: number;
  pmpCents: Decimal;
}

export interface MovementResult {
  /** Signed: positive when value enters stock, negative when it leaves. */
  valueCents: number;
  /** Cost per unit of this movement (4 decimals). */
  unitCostCents: Decimal;
  after: StockState;
}

/** Decimal from a number, a string or a Prisma Decimal. */
export function dec(v: unknown): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  return new Decimal(typeof v === "number" ? v : String(v));
}

/** A movement quantity: positive, at most 3 decimals. */
export function quantity(v: unknown): Decimal {
  const q = dec(v);
  if (!q.isFinite() || q.lte(0) || q.decimalPlaces() > 3) throw new RangeError(`Invalid quantity ${String(v)}`);
  return q;
}

export function stockState(s: { qtyOnHand: unknown; valueCents: number; pmpCents: unknown }): StockState {
  return { qty: dec(s.qtyOnHand), valueCents: s.valueCents, pmpCents: dec(s.pmpCents) };
}

/** qty × unit cost, rounded half up to whole cents. */
export function valueOf(qty: Decimal.Value, unitCostCents: Decimal.Value): number {
  return new Decimal(qty).times(unitCostCents).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

function perUnit(valueCents: number, qty: Decimal): Decimal {
  return new Decimal(valueCents).dividedBy(qty).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** Units enter stock with a known total value (receipt at cost, transfer in, count surplus). */
export function addToStock(s: StockState, qty: Decimal, valueCents: number): MovementResult {
  if (qty.lte(0)) throw new RangeError("Quantity must be positive");
  if (!Number.isSafeInteger(valueCents) || valueCents < 0) throw new RangeError("Value must be whole, non-negative cents");
  const after = { qty: s.qty.plus(qty), valueCents: s.valueCents + valueCents };
  return { valueCents, unitCostCents: perUnit(valueCents, qty), after: { ...after, pmpCents: perUnit(after.valueCents, after.qty) } };
}

/**
 * Units leave stock at PMP. Taking the last units takes the remaining value, so no cent is left
 * behind; an empty item keeps its last PMP as the reference cost.
 */
export function takeFromStock(s: StockState, qty: Decimal): MovementResult {
  if (qty.lte(0)) throw new RangeError("Quantity must be positive");
  if (qty.gt(s.qty)) {
    throw new ValidationError(`Not enough stock: ${s.qty.toString()} on hand`, { qty: [`Only ${s.qty.toString()} on hand`] });
  }
  const out = qty.eq(s.qty) ? s.valueCents : Math.min(valueOf(qty, s.pmpCents), s.valueCents);
  const left = s.qty.minus(qty);
  const valueLeft = s.valueCents - out;
  return {
    valueCents: -out,
    unitCostCents: perUnit(out, qty),
    after: { qty: left, valueCents: valueLeft, pmpCents: left.gt(0) ? perUnit(valueLeft, left) : s.pmpCents },
  };
}

/**
 * A counted quantity replaces the book quantity: a shortfall leaves at PMP, a surplus enters at
 * PMP (or at the fallback cost when the item never had one). Null when nothing changes.
 */
export function adjustTo(s: StockState, counted: Decimal, fallbackCostCents: number): MovementResult | null {
  if (counted.lt(0) || counted.decimalPlaces() > 3) throw new RangeError("Invalid counted quantity");
  const diff = counted.minus(s.qty);
  if (diff.isZero()) return null;
  if (diff.lt(0)) return takeFromStock(s, diff.negated());
  const cost = s.pmpCents.gt(0) ? s.pmpCents : new Decimal(fallbackCostCents);
  return addToStock(s, diff, valueOf(diff, cost));
}
