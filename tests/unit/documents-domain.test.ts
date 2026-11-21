import { describe, expect, it } from "vitest";
import { addressLines, documentFileName, hoursQty, invoiceBody, qtyText, vatBreakdown } from "@/modules/reports";

const line = (o: Partial<Parameters<typeof invoiceBody>[0][number]>) => ({
  label: "x",
  quantity: 1,
  unitPriceExclVatCents: 10_000,
  discountBp: 0,
  lineExclVatCents: 10_000,
  vatRateBp: 2000,
  vatCents: 2_000,
  vatRegime: "STANDARD",
  ...o,
});

describe("printable documents", () => {
  it("sums VAT per rate and leaves out lines without a rate", () => {
    expect(
      vatBreakdown([
        { vatRateBp: 2000, baseCents: 100, vatCents: 20 },
        { vatRateBp: 550, baseCents: 200, vatCents: 11 },
        { vatRateBp: 2000, baseCents: 50, vatCents: 10 },
        { vatRateBp: null, baseCents: 999, vatCents: 0 },
      ]),
    ).toEqual([
      { vatRateBp: 550, baseCents: 200, vatCents: 11 },
      { vatRateBp: 2000, baseCents: 150, vatCents: 30 },
    ]);
  });

  it("prints standard invoices excl. VAT with a VAT summary and the balance due", () => {
    const b = invoiceBody([line({}), line({ lineExclVatCents: 4_500, unitPriceExclVatCents: 5_000, discountBp: 1000, vatCents: 900, quantity: "1.500" })], 17_400, 4_000);
    expect(b.hasMargin).toBe(false);
    expect(b.lines[1]).toMatchObject({ qty: "1.5", unitCents: 5_000, discountBp: 1000, vatRateBp: 2000, amountCents: 4_500 });
    expect(b.vat).toEqual([{ vatRateBp: 2000, baseCents: 14_500, vatCents: 2_900 }]);
    expect(b.totals.map((t) => [t.key, t.cents])).toEqual([
      ["totalExclVat", 14_500],
      ["vat", 2_900],
      ["totalInclVat", 17_400],
      ["paid", 4_000],
      ["balanceDue", 13_400],
    ]);
  });

  it("never shows the VAT of a used car sold on the margin", () => {
    // Car sold 12,000 incl. VAT, bought 10,000: VAT on the margin 333.33, base 11,666.67.
    const car = line({ vatRegime: "MARGIN", lineExclVatCents: 1_166_667, unitPriceExclVatCents: 1_166_667, vatCents: 33_333 });
    const mats = line({ lineExclVatCents: 5_000, unitPriceExclVatCents: 5_000, vatCents: 1_000 });
    const b = invoiceBody([car, mats], 1_206_000, 0);
    expect(b.hasMargin).toBe(true);
    expect(b.lines[0]).toMatchObject({ vatRateBp: null, amountCents: 1_200_000, unitCents: undefined });
    expect(b.vat).toEqual([{ vatRateBp: 2000, baseCents: 5_000, vatCents: 1_000 }]);
    expect(b.totals.map((t) => t.key)).toEqual(["marginGoods", "totalExclVat", "vat", "totalInclVat"]);
    expect(b.totals[0].cents + b.totals[1].cents + b.totals[2].cents).toBe(b.totals[3].cents);
  });

  it("formats quantities, addresses and file names", () => {
    expect(qtyText("2.000")).toBe("2");
    expect(qtyText("0.250")).toBe("0.25");
    expect(hoursQty(150)).toBe("1.5");
    expect(addressLines({ address: "1 rue X", postalCode: "44000", city: "Nantes" })).toEqual(["1 rue X", "44000 Nantes"]);
    expect(addressLines({ address: null, postalCode: null, city: null })).toEqual([]);
    expect(documentFileName("invoice", "NTE-FA-2026/000001")).toBe("invoice-NTE-FA-2026_000001.pdf");
  });
});
