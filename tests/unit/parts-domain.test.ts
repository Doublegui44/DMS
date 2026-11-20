import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { computeLine } from "@/modules/accounting/domain/vat";
import { addToStock, adjustTo, Decimal, dec, quantity, stockState, takeFromStock, valueOf, type StockState } from "@/modules/parts/domain/valuation";
import { counterLine, counterTotals, discountFor, netUnitPrice, partsMargin } from "@/modules/parts/domain/pricing";
import {
  availableQty,
  backorderQty,
  DEFAULT_TOLERANCE,
  isBelowMin,
  matchLine,
  purchaseOrderStatus,
  suggestedQty,
  supplierInvoiceTotals,
  withinTolerance,
} from "@/modules/parts/domain/purchasing";
import { isObsolete, normalisePartNumber, obsoleteBefore, resolveReplacement } from "@/modules/parts/domain/catalogue";

const empty: StockState = { qty: new Decimal(0), valueCents: 0, pmpCents: new Decimal(0) };
const d = (v: string | number) => new Decimal(v);

function rng(seed = 11) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

describe("PMP valuation", () => {
  it("weights the average cost by value", () => {
    const a = addToStock(empty, d(3), 3_000); // 3 × 10.00
    expect(a.after).toMatchObject({ valueCents: 3_000 });
    expect(a.after.pmpCents.toString()).toBe("1000");
    const b = addToStock(a.after, d(2), 2_600); // 2 × 13.00
    expect(b.after.qty.toString()).toBe("5");
    expect(b.after.valueCents).toBe(5_600);
    expect(b.after.pmpCents.toString()).toBe("1120");
    expect(b.unitCostCents.toString()).toBe("1300");
  });

  it("issues at PMP and takes the remaining value with the last units", () => {
    const s = addToStock(empty, d(3), 1_000).after; // PMP 333.3333
    expect(s.pmpCents.toString()).toBe("333.3333");
    const one = takeFromStock(s, d(1));
    expect(one.valueCents).toBe(-333);
    expect(one.after).toMatchObject({ valueCents: 667 });
    expect(one.after.pmpCents.toString()).toBe("333.5");
    const rest = takeFromStock(one.after, d(2));
    expect(rest.valueCents).toBe(-667);
    expect(rest.after.valueCents).toBe(0);
    expect(rest.after.qty.isZero()).toBe(true);
    // An empty item keeps its last PMP as the reference cost.
    expect(rest.after.pmpCents.toString()).toBe("333.5");
  });

  it("refuses to go negative", () => {
    const s = addToStock(empty, d(2), 2_000).after;
    expect(() => takeFromStock(s, d(3))).toThrow(ValidationError);
    expect(() => takeFromStock(s, d("2.001"))).toThrow(ValidationError);
  });

  it("keeps value = sum of movements and PMP = value ÷ qty over random histories", () => {
    const r = rng();
    for (let run = 0; run < 50; run++) {
      let s = empty;
      let sum = 0;
      for (let i = 0; i < 60; i++) {
        const receipt = s.qty.lte(0) || r() < 0.45;
        const res = receipt
          ? addToStock(s, d(1 + Math.floor(r() * 20)), Math.floor(r() * 50_000))
          : takeFromStock(s, Decimal.min(s.qty, d(1 + Math.floor(r() * 6))));
        sum += res.valueCents;
        s = res.after;
        expect(s.valueCents).toBeGreaterThanOrEqual(0);
        expect(s.valueCents).toBe(sum);
        if (s.qty.gt(0)) expect(s.pmpCents.toString()).toBe(new Decimal(s.valueCents).div(s.qty).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString());
        else expect(s.valueCents).toBe(0);
      }
    }
  });

  it("supports fractional quantities (litres, metres) to 3 decimals", () => {
    const s = addToStock(empty, d("12.5"), 10_000).after; // 8.00 per unit
    const out = takeFromStock(s, d("0.333"));
    expect(out.valueCents).toBe(-266); // 0.333 × 800 = 266.4
    expect(quantity("0.001").toString()).toBe("0.001");
    expect(() => quantity("0.0001")).toThrow(RangeError);
    expect(() => quantity(0)).toThrow(RangeError);
    expect(() => quantity(-1)).toThrow(RangeError);
  });

  it("rounds values half up to the cent", () => {
    expect(valueOf(d(3), d("0.5"))).toBe(2); // 1.5 → 2
    expect(valueOf(d(1), d("333.3333"))).toBe(333);
    expect(valueOf(d("2.5"), 101)).toBe(253); // 252.5 → 253
  });

  it("reads Prisma decimals and empty values", () => {
    expect(dec(null).isZero()).toBe(true);
    expect(dec("1.250").toString()).toBe("1.25");
    expect(stockState({ qtyOnHand: "4", valueCents: 400, pmpCents: "100.0000" }).pmpCents.toNumber()).toBe(100);
  });
});

describe("cycle-count adjustments", () => {
  const s = addToStock(empty, d(10), 12_345).after; // PMP 1234.5
  it("does nothing when the count matches", () => expect(adjustTo(s, d(10), 999)).toBeNull());
  it("takes a shortfall out at PMP", () => {
    const r = adjustTo(s, d(8), 999)!;
    expect(r.valueCents).toBe(-2_469);
    expect(r.after.qty.toString()).toBe("8");
  });
  it("brings a surplus in at PMP", () => {
    const r = adjustTo(s, d(11), 999)!;
    expect(r.valueCents).toBe(1_235); // 1234.5 rounded half up
  });
  it("uses the fallback cost when the item never had a PMP", () => {
    const r = adjustTo(empty, d(2), 750)!;
    expect(r.valueCents).toBe(1_500);
    expect(r.after.pmpCents.toString()).toBe("750");
  });
  it("counting zero empties the item to the cent", () => {
    const r = adjustTo(s, d(0), 999)!;
    expect(r.valueCents).toBe(-12_345);
    expect(r.after.valueCents).toBe(0);
  });
  it("rejects a negative count", () => expect(() => adjustTo(s, d(-1), 0)).toThrow(RangeError));
});

describe("discount matrix", () => {
  const rates = [
    { priceClass: "TRADE", discountBp: 2_500 },
    { priceClass: "INTERNAL", discountBp: 4_000 },
  ];
  it("resolves the price class's rate and defaults to none", () => {
    expect(discountFor(rates, "TRADE")).toBe(2_500);
    expect(discountFor(rates, "RETAIL")).toBe(0);
  });
  it("computes the net unit price", () => {
    expect(netUnitPrice(4_990, 2_500)).toBe(3_742); // 49.90 − 12.475 → 12.48
    expect(netUnitPrice(4_990, 0)).toBe(4_990);
  });
  it("rounds a counter line exactly like the invoice", () => {
    const args = { qty: 3, unitPriceCents: 1_999, discountBp: 1_500, vatRateBp: 2_000 };
    const line = counterLine(args);
    expect(line).toEqual(computeLine({ quantity: 3, unitPriceExclVatCents: 1_999, discountBp: 1_500, vatRateBp: 2_000 }));
    expect(line.lineExclVatCents).toBe(5_097); // 59.97 − 15 % = 50.9745
    const totals = counterTotals([line, counterLine({ qty: 1, unitPriceCents: 1_000, discountBp: 0, vatRateBp: 2_000 })]);
    expect(totals.totalInclVatCents).toBe(totals.totalExclVatCents + totals.vatCents);
  });
  it("computes the parts margin", () => {
    expect(partsMargin(10_000, 6_500)).toEqual({ marginCents: 3_500, marginBp: 3_500 });
    expect(partsMargin(0, 100).marginBp).toBe(0);
  });
});

describe("replenishment", () => {
  const lv = (onHand: number | string, reserved = 0, onOrder = 0, min = 4, max = 10) => ({ onHand, reserved, onOrder, min, max });
  it("counts reserved units as unavailable", () => {
    expect(availableQty(lv(5, 2)).toNumber()).toBe(3);
    expect(isBelowMin(lv(5, 2))).toBe(true);
    expect(isBelowMin(lv(5, 1))).toBe(false);
  });
  it("orders back up to the maximum once under the minimum", () => {
    expect(suggestedQty(lv(3)).toNumber()).toBe(7);
    expect(suggestedQty(lv(4)).toNumber()).toBe(0);
  });
  it("counts what is already on order", () => {
    expect(suggestedQty(lv(1, 0, 3)).toNumber()).toBe(0);
    expect(suggestedQty(lv(1, 0, 2)).toNumber()).toBe(7);
  });
  it("never suggests without a minimum, rounds up and falls back to the minimum", () => {
    expect(suggestedQty(lv(0, 0, 0, 0, 10)).toNumber()).toBe(0);
    expect(suggestedQty(lv("1.5")).toNumber()).toBe(9);
    expect(suggestedQty(lv(1, 0, 0, 6, 2)).toNumber()).toBe(5);
  });
  it("derives the order status and backorders", () => {
    expect(purchaseOrderStatus([{ ordered: 5, received: 0 }])).toBe("SENT");
    expect(purchaseOrderStatus([{ ordered: 5, received: 2 }, { ordered: 1, received: 1 }])).toBe("PARTIAL");
    expect(purchaseOrderStatus([{ ordered: 5, received: 5 }, { ordered: 1, received: 1 }])).toBe("RECEIVED");
    expect(backorderQty({ ordered: 5, received: 2 }).toNumber()).toBe(3);
    expect(backorderQty({ ordered: 5, received: 5 }).toNumber()).toBe(0);
  });
});

describe("supplier invoice matching", () => {
  it("matches at receipt cost with no variance", () => {
    expect(matchLine({ qty: 4, unitCostCents: 1_250, receiptUnitCostCents: 1_250, remainingQty: 4, remainingValueCents: 5_000 })).toEqual({
      amountCents: 5_000,
      receiptValueCents: 5_000,
      varianceCents: 0,
    });
  });
  it("books a price difference as variance", () => {
    const m = matchLine({ qty: 2, unitCostCents: 1_300, receiptUnitCostCents: 1_250, remainingQty: 4, remainingValueCents: 5_000 });
    expect(m).toEqual({ amountCents: 2_600, receiptValueCents: 2_500, varianceCents: 100 });
  });
  it("clears what is left when billing the last units", () => {
    // 3 units received for 10.00 → 3.3333 each; the first unit cleared 3.33, the last two clear 6.67.
    const m = matchLine({ qty: 2, unitCostCents: 333, receiptUnitCostCents: 333, remainingQty: 2, remainingValueCents: 667 });
    expect(m.receiptValueCents).toBe(667);
    expect(m.varianceCents).toBe(-1);
  });
  it("refuses to bill more than was received", () => {
    expect(() => matchLine({ qty: 5, unitCostCents: 1, receiptUnitCostCents: 1, remainingQty: 4, remainingValueCents: 4 })).toThrow(RangeError);
    expect(() => matchLine({ qty: 0, unitCostCents: 1, receiptUnitCostCents: 1, remainingQty: 4, remainingValueCents: 4 })).toThrow(RangeError);
  });
  it("accepts a variance within max(€5, 1 %)", () => {
    expect(withinTolerance(500, 10_000, DEFAULT_TOLERANCE)).toBe(true);
    expect(withinTolerance(-501, 10_000, DEFAULT_TOLERANCE)).toBe(false);
    expect(withinTolerance(1_000, 100_000, DEFAULT_TOLERANCE)).toBe(true);
    expect(withinTolerance(1_001, 100_000, DEFAULT_TOLERANCE)).toBe(false);
  });
  it("computes VAT on the invoice total", () => {
    expect(supplierInvoiceTotals([{ amountCents: 333 }, { amountCents: 333 }], 2_000)).toEqual({
      totalExclVatCents: 666,
      vatCents: 133,
      totalInclVatCents: 799,
    });
  });
});

describe("catalogue rules", () => {
  it("normalises part numbers", () => expect(normalisePartNumber(" 1609 4381 80 ab")).toBe("1609438180AB"));

  const today = new Date("2026-06-15T00:00:00Z");
  const links: Record<string, { newPartId: string; effectiveOn: Date }> = {
    A: { newPartId: "B", effectiveOn: new Date("2025-01-01T00:00:00Z") },
    B: { newPartId: "C", effectiveOn: new Date("2026-03-01T00:00:00Z") },
    C: { newPartId: "D", effectiveOn: new Date("2026-09-01T00:00:00Z") }, // not yet
  };
  it("follows effective supersessions to the current number", () => {
    expect(resolveReplacement("A", (id) => links[id], today)).toEqual({ partId: "C", chain: ["A", "B", "C"] });
    expect(resolveReplacement("C", (id) => links[id], today)).toEqual({ partId: "C", chain: ["C"] });
    expect(resolveReplacement("Z", (id) => links[id], today).partId).toBe("Z");
  });
  it("detects a supersession loop", () => {
    const loop = { X: { newPartId: "Y", effectiveOn: today }, Y: { newPartId: "X", effectiveOn: today } } as const;
    expect(() => resolveReplacement("X", (id) => loop[id as "X" | "Y"], today)).toThrow(RangeError);
  });
  it("flags stock without movement for 12 months as obsolete", () => {
    expect(obsoleteBefore(today).toISOString().slice(0, 10)).toBe("2025-06-15");
    expect(isObsolete(new Date("2025-06-15T00:00:00Z"), today)).toBe(true);
    expect(isObsolete(new Date("2025-06-16T00:00:00Z"), today)).toBe(false);
    expect(isObsolete(null, today)).toBe(true);
    expect(isObsolete(new Date("2026-01-01T00:00:00Z"), today, 6)).toBe(false);
  });
  it("keeps month ends on UTC calendar months", () => {
    expect(obsoleteBefore(new Date("2026-03-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(obsoleteBefore(new Date("2024-02-29T00:00:00Z"), 12).toISOString().slice(0, 10)).toBe("2023-02-28");
  });
});
