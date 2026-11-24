import { describe, expect, it } from "vitest";
import { sumCents } from "@/lib/money";
import { computeLine, computeMarginLine, dueDate, invoiceTotals, marginVat } from "@/modules/accounting/domain/vat";
import {
  buildInvoiceEntry,
  buildOpeningEntry,
  buildPartsStockEntry,
  buildPaymentEntry,
  buildReversal,
  buildSupplierInvoiceEntry,
  canLetter,
  compactLines,
  letteringCode,
  letteringIndex,
  validateEntry,
  type AccountInfo,
  type DraftLine,
  type EntryDraft,
  type InvoiceForPosting,
  type ResolvedLine,
} from "@/modules/accounting/domain/entry";
import { canLock, closeChecklist, periodBounds, periodOf } from "@/modules/accounting/domain/periods";
import { netResult, trialBalance } from "@/modules/accounting/domain/trial-balance";
import { accountClass, DEFAULT_ACCOUNTS, DEFAULT_MAPPINGS } from "@/modules/accounting/domain/default-chart";
import { dueSupplierItems } from "@/modules/accounting/domain/payment-run";

const total = (lines: { debitCents: number; creditCents: number }[]) => ({
  d: sumCents(lines.map((l) => l.debitCents)),
  c: sumCents(lines.map((l) => l.creditCents)),
});
const expectBalanced = (e: EntryDraft) => {
  const { d, c } = total(e.lines);
  expect(d).toBe(c);
  expect(d).toBeGreaterThan(0);
  for (const l of e.lines) {
    expect(l.debitCents >= 0 && l.creditCents >= 0).toBe(true);
    expect((l.debitCents === 0) !== (l.creditCents === 0)).toBe(true);
  }
};

function rng(seed = 9) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

describe("invoice lines and VAT", () => {
  it("computes a line with quantity, discount and VAT", () => {
    expect(computeLine({ quantity: 2, unitPriceExclVatCents: 4_550, vatRateBp: 2000 })).toEqual({ lineExclVatCents: 9_100, vatCents: 1_820 });
    expect(computeLine({ quantity: 1.5, unitPriceExclVatCents: 9_500, discountBp: 1000, vatRateBp: 2000 })).toEqual({
      lineExclVatCents: 12_825,
      vatCents: 2_565,
    });
    expect(computeLine({ quantity: 4.25, unitPriceExclVatCents: 1_299, vatRateBp: 2000 }).lineExclVatCents).toBe(5_521);
  });

  it("rejects zero quantities", () => {
    expect(() => computeLine({ quantity: 0, unitPriceExclVatCents: 100, vatRateBp: 2000 })).toThrow();
  });

  it("totals per rate and overall", () => {
    const t = invoiceTotals([
      { lineExclVatCents: 10_000, vatCents: 2_000, vatRateCode: "STANDARD", vatRateBp: 2000 },
      { lineExclVatCents: 5_000, vatCents: 1_000, vatRateCode: "STANDARD", vatRateBp: 2000 },
      { lineExclVatCents: 1_000, vatCents: 55, vatRateCode: "REDUCED", vatRateBp: 550 },
      { lineExclVatCents: 27_600, vatCents: 0, vatRateCode: "ZERO", vatRateBp: 0 },
    ]);
    expect(t).toMatchObject({ totalExclVatCents: 43_600, vatCents: 3_055, totalInclVatCents: 46_655 });
    expect(t.vatByRate.find((r) => r.vatRateCode === "STANDARD")).toMatchObject({ baseCents: 15_000, vatCents: 3_000 });
  });

  it("computes VAT on margin for a used car bought from a private seller", () => {
    // Bought 10 000 €, sold 13 600 € incl. → margin 3 600 incl. → VAT 600, margin excl. 3 000.
    expect(marginVat({ salePriceInclCents: 1_360_000, purchasePriceCents: 1_000_000, rateBp: 2000 })).toEqual({
      marginInclCents: 360_000,
      marginExclCents: 300_000,
      vatCents: 60_000,
    });
  });

  it("charges no VAT on a negative or zero margin", () => {
    expect(marginVat({ salePriceInclCents: 900_000, purchasePriceCents: 1_000_000, rateBp: 2000 }).vatCents).toBe(0);
    expect(marginVat({ salePriceInclCents: 1_000_000, purchasePriceCents: 1_000_000, rateBp: 2000 }).vatCents).toBe(0);
  });

  it("builds a margin-regime line whose excl. + VAT equals the price", () => {
    const l = computeMarginLine({ salePriceInclCents: 1_360_000, purchasePriceCents: 1_000_000, rateBp: 2000 });
    expect(l).toEqual({ lineExclVatCents: 1_300_000, vatCents: 60_000 });
  });

  it("computes due dates", () => {
    expect(dueDate(new Date("2026-01-31"), 30).toISOString().slice(0, 10)).toBe("2026-03-02");
  });
});

const invoice = (over: Partial<InvoiceForPosting> = {}): InvoiceForPosting => ({
  id: "inv1",
  number: "NTE-FA-2026-000001",
  kind: "INVOICE",
  siteId: "s1",
  issueDate: new Date("2026-03-10"),
  customerId: "c1",
  customerName: "Jeanne MARTIN",
  receivableKey: "RECEIVABLE_CUSTOMER",
  vatRegime: "STANDARD",
  totalInclVatCents: 30_000,
  lines: [
    { label: "Labour", lineExclVatCents: 15_000, vatCents: 3_000, vatRateCode: "STANDARD", departmentCode: "WORKSHOP", revenueKey: "REVENUE_LABOUR" },
    { label: "Parts", lineExclVatCents: 10_000, vatCents: 2_000, vatRateCode: "STANDARD", departmentCode: "PARTS", revenueKey: "REVENUE_PARTS" },
  ],
  ...over,
});

describe("entry builders always balance", () => {
  it("sales invoice: Dr 411 / Cr revenue by department / Cr VAT", () => {
    const e = buildInvoiceEntry(invoice());
    expectBalanced(e);
    expect(e.journalCode).toBe("VE");
    const receivable = e.lines.find((l) => "key" in l.account && l.account.key === "RECEIVABLE_CUSTOMER")!;
    expect(receivable).toMatchObject({ debitCents: 30_000, partyType: "CUSTOMER", partyId: "c1" });
    const vat = e.lines.filter((l) => "key" in l.account && l.account.key === "VAT_COLLECTED_STANDARD");
    expect(vat).toHaveLength(1); // merged
    expect(vat[0].creditCents).toBe(5_000);
    expect(e.lines.find((l) => "key" in l.account && l.account.key === "REVENUE_LABOUR")?.departmentCode).toBe("WORKSHOP");
  });

  it("credit note mirrors the invoice", () => {
    const e = buildInvoiceEntry(invoice({ kind: "CREDIT_NOTE" }));
    expectBalanced(e);
    expect(e.lines.find((l) => "key" in l.account && l.account.key === "RECEIVABLE_CUSTOMER")!.creditCents).toBe(30_000);
  });

  it("margin-regime invoice posts VAT to the margin VAT account", () => {
    const e = buildInvoiceEntry(
      invoice({
        vatRegime: "MARGIN",
        totalInclVatCents: 1_360_000,
        lines: [{ label: "Used car", lineExclVatCents: 1_300_000, vatCents: 60_000, vatRateCode: "STANDARD", departmentCode: "VO", revenueKey: "REVENUE_VO" }],
      }),
    );
    expectBalanced(e);
    expect(e.lines.some((l) => "key" in l.account && l.account.key === "VAT_COLLECTED_MARGIN")).toBe(true);
  });

  it("handles negative (discount) lines", () => {
    const e = buildInvoiceEntry(
      invoice({
        totalInclVatCents: 24_000,
        lines: [
          { label: "Car", lineExclVatCents: 25_000, vatCents: 5_000, vatRateCode: "STANDARD", departmentCode: "VN", revenueKey: "REVENUE_VN" },
          { label: "Discount", lineExclVatCents: -5_000, vatCents: -1_000, vatRateCode: "STANDARD", departmentCode: "VN", revenueKey: "DISCOUNTS_GRANTED" },
        ],
      }),
    );
    expectBalanced(e);
    expect(e.lines.find((l) => "key" in l.account && l.account.key === "DISCOUNTS_GRANTED")!.debitCents).toBe(5_000);
  });

  it("random invoices always balance (200 cases)", () => {
    const r = rng(42);
    for (let i = 0; i < 200; i++) {
      const lines = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, k) => {
        const rateBp = [2000, 1000, 550, 0][Math.floor(r() * 4)];
        const code = { 2000: "STANDARD", 1000: "INTERMEDIATE", 550: "REDUCED", 0: "ZERO" }[rateBp]!;
        const c = computeLine({ quantity: Math.round(r() * 5000) / 1000 + 0.001, unitPriceExclVatCents: Math.floor(r() * 500_000), discountBp: Math.floor(r() * 3000), vatRateBp: rateBp });
        return { label: `L${k}`, ...c, vatRateCode: code, departmentCode: "PARTS" as const, revenueKey: "REVENUE_PARTS" };
      });
      const t = invoiceTotals(lines.map((l) => ({ ...l, vatRateBp: 0 })));
      if (t.totalInclVatCents === 0) continue;
      const kind = r() > 0.8 ? "CREDIT_NOTE" : "INVOICE";
      expectBalanced(buildInvoiceEntry(invoice({ kind, totalInclVatCents: t.totalInclVatCents, lines })));
    }
  });

  it("payments in and out", () => {
    const base = {
      id: "p1",
      number: "P1",
      siteId: "s1",
      date: new Date("2026-03-11"),
      journalCode: "BQ",
      treasury: { key: "TREASURY_TRANSFER" },
      amountCents: 12_345,
    };
    const inbound = buildPaymentEntry({ ...base, direction: "IN", party: { type: "CUSTOMER", id: "c1", name: "X", accountKey: "RECEIVABLE_CUSTOMER" } });
    expectBalanced(inbound);
    expect(inbound.lines[0]).toMatchObject({ debitCents: 12_345 });
    const outbound = buildPaymentEntry({ ...base, direction: "OUT", party: { type: "SUPPLIER", id: "f1", name: "Y", accountKey: "PAYABLE_SUPPLIER" } });
    expectBalanced(outbound);
    expect(outbound.lines[0]).toMatchObject({ debitCents: 12_345, partyType: "SUPPLIER" });
    expect(() => buildPaymentEntry({ ...base, amountCents: 0, direction: "IN", party: { type: "CUSTOMER", id: "c", name: "", accountKey: "R" } })).toThrow();
  });

  it("a trade-in settles the customer's car account against their receivable", () => {
    const e = buildPaymentEntry({
      id: "p2",
      number: "P2",
      siteId: "s1",
      date: new Date("2026-03-11"),
      journalCode: "OD",
      amountCents: 12_345,
      direction: "IN",
      treasury: { key: "TREASURY_TRADE_IN" },
      treasuryParty: { type: "CUSTOMER", id: "c1" },
      party: { type: "CUSTOMER", id: "c1", name: "X", accountKey: "RECEIVABLE_CUSTOMER" },
    });
    expectBalanced(e);
    expect(e.lines[0]).toMatchObject({ account: { key: "TREASURY_TRADE_IN" }, debitCents: 12_345, partyType: "CUSTOMER", partyId: "c1" });
    expect(e.lines[1]).toMatchObject({ creditCents: 12_345, partyId: "c1" });
  });

  it("reversal mirrors every line", () => {
    const lines: ResolvedLine[] = [
      { accountCode: "411000", debitCents: 1_000, creditCents: 0, label: "x", partyType: "CUSTOMER", partyId: "c1" },
      { accountCode: "706100", debitCents: 0, creditCents: 1_000, label: "x", departmentCode: "WORKSHOP" },
    ];
    const r = buildReversal({ id: "e1", number: "OD-2026-000001", journalCode: "OD", siteId: "s1", lines }, new Date("2026-04-01"), "typo");
    expectBalanced(r);
    expect(r.lines[0]).toMatchObject({ creditCents: 1_000, partyId: "c1" });
    expect(r.lines[1]).toMatchObject({ debitCents: 1_000, departmentCode: "WORKSHOP" });
    expect(r.sourceType).toBe("REVERSAL");
  });

  it("opening entry balances through the balancing account", () => {
    const e = buildOpeningEntry({
      siteId: "s1",
      date: new Date("2026-01-01"),
      balances: [
        { account: { key: "STOCK_VN" }, amountCents: 1_000_000, label: "VN" },
        { account: { key: "BANK" }, amountCents: 250_000, label: "Bank" },
        { account: { key: "CAPITAL" }, amountCents: -500_000, label: "Capital" },
      ],
      balancingAccount: { key: "OPENING_BALANCE" },
    });
    expectBalanced(e);
    expect(e.lines.at(-1)).toMatchObject({ creditCents: 750_000 });
  });
});

describe("parts postings", () => {
  const base = { siteId: "s1", date: new Date("2026-03-15"), label: "NTE-BR-2026-00001", sourceType: "GOODS_RECEIPT", sourceId: "r1" };

  it("a receipt puts value into parts stock against stock variation", () => {
    const e = buildPartsStockEntry({ ...base, valueCents: 12_345, counterpart: "VARIATION" });
    expectBalanced(e);
    expect(e.journalCode).toBe("OD");
    expect(e.lines[0]).toMatchObject({ account: { key: "STOCK_PARTS" }, debitCents: 12_345 });
    expect(e.lines[1]).toMatchObject({ account: { key: "STOCK_VARIATION_PARTS" }, creditCents: 12_345, departmentCode: "PARTS" });
  });

  it("an issue takes value out; a transfer goes through the liaison account", () => {
    const out = buildPartsStockEntry({ ...base, valueCents: -500, counterpart: "VARIATION" });
    expectBalanced(out);
    expect(out.lines[1]).toMatchObject({ account: { key: "STOCK_PARTS" }, creditCents: 500 });
    expect(out.lines[0]).toMatchObject({ account: { key: "STOCK_VARIATION_PARTS" }, debitCents: 500, departmentCode: "PARTS" });
    const t = buildPartsStockEntry({ ...base, valueCents: -500, counterpart: "LIAISON" });
    expect(t.lines[0]).toMatchObject({ account: { key: "SITE_LIAISON" }, debitCents: 500 });
    expect(t.lines[0].departmentCode).toBeUndefined();
  });

  it("refuses zero or fractional amounts", () => {
    expect(() => buildPartsStockEntry({ ...base, valueCents: 0, counterpart: "VARIATION" })).toThrow(RangeError);
    expect(() => buildPartsStockEntry({ ...base, valueCents: 1.5, counterpart: "VARIATION" })).toThrow(RangeError);
  });

  const invoice = {
    ...base,
    sourceType: "SUPPLIER_INVOICE",
    supplierId: "sup1",
    payable: { key: "PAYABLE_OEM" },
    purchaseAccount: { key: "PURCHASE_PARTS" },
    departmentCode: "PARTS" as const,
  };

  it("a supplier invoice clears goods received not invoiced and books the price variance", () => {
    const e = buildSupplierInvoiceEntry({ ...invoice, receiptValueCents: 10_000, varianceCents: 150, vatCents: 2_030 });
    expectBalanced(e);
    expect(e.journalCode).toBe("AC");
    expect(e.lines).toHaveLength(4);
    expect(e.lines[0]).toMatchObject({ account: { key: "GOODS_RECEIVED_NOT_INVOICED" }, debitCents: 10_000, partyType: "SUPPLIER", partyId: "sup1" });
    expect(e.lines[1]).toMatchObject({ account: { key: "PURCHASE_PARTS" }, debitCents: 150, departmentCode: "PARTS" });
    expect(e.lines[2]).toMatchObject({ account: { key: "VAT_DEDUCTIBLE_GOODS" }, debitCents: 2_030 });
    expect(e.lines[3]).toMatchObject({ account: { key: "PAYABLE_OEM" }, creditCents: 12_180, partyType: "SUPPLIER", partyId: "sup1" });
  });

  it("a cheaper invoice credits purchases; an exact match has no variance line", () => {
    const cheaper = buildSupplierInvoiceEntry({ ...invoice, receiptValueCents: 10_000, varianceCents: -200, vatCents: 1_960 });
    expectBalanced(cheaper);
    expect(cheaper.lines[1]).toMatchObject({ account: { key: "PURCHASE_PARTS" }, creditCents: 200 });
    const exact = buildSupplierInvoiceEntry({ ...invoice, receiptValueCents: 10_000, varianceCents: 0, vatCents: 2_000 });
    expectBalanced(exact);
    expect(exact.lines.map((l) => ("key" in l.account ? l.account.key : l.account.code))).toEqual([
      "GOODS_RECEIVED_NOT_INVOICED",
      "VAT_DEDUCTIBLE_GOODS",
      "PAYABLE_OEM",
    ]);
  });
});

describe("compactLines", () => {
  it("merges identical lines and drops zero nets", () => {
    const l = (d: number, c: number, key = "A"): DraftLine => ({ account: { key }, debitCents: d, creditCents: c, label: "x" });
    expect(compactLines([l(100, 0), l(0, 30), l(50, 0, "B"), l(0, 50, "B")])).toEqual([{ account: { key: "A" }, debitCents: 70, creditCents: 0, label: "x" }]);
  });
});

describe("validateEntry", () => {
  const accounts = new Map<string, AccountInfo>(
    [
      { code: "411000", postable: true, active: true, requiresAnalytic: false, isReceivable: true, isPayable: false },
      { code: "401000", postable: true, active: true, requiresAnalytic: false, isReceivable: false, isPayable: true },
      { code: "706100", postable: true, active: true, requiresAnalytic: true, isReceivable: false, isPayable: false },
      { code: "512100", postable: true, active: true, requiresAnalytic: false, isReceivable: false, isPayable: false },
      { code: "700000", postable: false, active: true, requiresAnalytic: false, isReceivable: false, isPayable: false },
    ].map((a) => [a.code, a]),
  );
  const ok: ResolvedLine[] = [
    { accountCode: "411000", debitCents: 1_200, creditCents: 0, label: "x", partyType: "CUSTOMER", partyId: "c1" },
    { accountCode: "706100", debitCents: 0, creditCents: 1_200, label: "x", departmentCode: "WORKSHOP" },
  ];
  const codes = (lines: ResolvedLine[]) => validateEntry(lines, accounts).map((e) => e.code);

  it("accepts a valid entry", () => expect(validateEntry(ok, accounts)).toEqual([]));
  it("rejects an unbalanced entry", () => expect(codes([ok[0], { ...ok[1], creditCents: 1_100 }])).toContain("UNBALANCED"));
  it("rejects a single line", () => expect(codes([ok[0]])).toContain("TOO_FEW_LINES"));
  it("rejects two-sided or negative lines", () => {
    expect(codes([{ ...ok[0], creditCents: 5 }, { ...ok[1], debitCents: 5 }])).toContain("INVALID_AMOUNT");
    expect(codes([{ ...ok[0], debitCents: -1_200 }, { ...ok[1], creditCents: -1_200 }])).toContain("INVALID_AMOUNT");
  });
  it("requires a department on class 6/7 accounts", () => expect(codes([ok[0], { ...ok[1], departmentCode: null }])).toContain("ANALYTIC_REQUIRED"));
  it("requires a party on receivable/payable accounts", () => {
    expect(codes([{ ...ok[0], partyId: null }, ok[1]])).toContain("PARTY_REQUIRED");
    expect(codes([{ accountCode: "401000", debitCents: 1_200, creditCents: 0, label: "x", partyType: "CUSTOMER", partyId: "c" }, ok[1]])).toContain("PARTY_REQUIRED");
  });
  it("rejects unknown and non-postable accounts", () => {
    expect(codes([{ ...ok[0], accountCode: "999999" }, ok[1]])).toContain("UNKNOWN_ACCOUNT");
    expect(codes([{ ...ok[0], accountCode: "700000", partyType: null }, ok[1]])).toContain("NOT_POSTABLE");
  });
  it("rejects all-zero entries", () => {
    expect(codes([{ ...ok[0], debitCents: 0 }, { ...ok[1], creditCents: 0 }])).toContain("EMPTY_ENTRY");
  });
});

describe("lettering", () => {
  it("letters only lines that net to zero", () => {
    expect(canLetter([{ debitCents: 300, creditCents: 0 }, { debitCents: 0, creditCents: 100 }, { debitCents: 0, creditCents: 200 }])).toBe(true);
    expect(canLetter([{ debitCents: 300, creditCents: 0 }, { debitCents: 0, creditCents: 100 }])).toBe(false);
  });
  it("generates spreadsheet-style codes", () => {
    expect([0, 1, 25, 26, 27, 701, 702].map(letteringCode)).toEqual(["A", "B", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
  it("decodes codes back to their index", () => {
    for (const i of [0, 1, 25, 26, 27, 701, 702, 5000]) expect(letteringIndex(letteringCode(i))).toBe(i);
  });
});

describe("periods and close", () => {
  it("derives calendar months", () => {
    expect(periodOf(new Date("2026-02-28"))).toEqual({ year: 2026, month: 2 });
    const b = periodBounds({ year: 2028, month: 2 });
    expect(b.endDate.toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  const base = {
    period: { year: 2026, month: 3, status: "OPEN" as const },
    previousOpen: [],
    draftInvoices: 0,
    trialBalance: { debitCents: 100, creditCents: 100 },
    businessDate: new Date("2026-04-02"),
  };
  it("allows locking a finished, balanced month", () => expect(canLock(closeChecklist(base))).toBe(true));
  it("blocks when an earlier month is open", () => expect(canLock(closeChecklist({ ...base, previousOpen: [{ year: 2026, month: 2 }] }))).toBe(false));
  it("blocks while the month is still running", () => expect(canLock(closeChecklist({ ...base, businessDate: new Date("2026-03-31") }))).toBe(false));
  it("blocks when already locked", () => expect(canLock(closeChecklist({ ...base, period: { ...base.period, status: "LOCKED" } }))).toBe(false));
  it("only warns about draft invoices", () => {
    const checks = closeChecklist({ ...base, draftInvoices: 2 });
    expect(checks.find((c) => c.key === "draft_invoices")!.ok).toBe(false);
    expect(canLock(checks)).toBe(true);
  });
});

describe("trial balance", () => {
  it("aggregates, balances and computes the result", () => {
    const tb = trialBalance([
      { accountCode: "706100", label: "MO", class: 7, debitCents: 0, creditCents: 15_000 },
      { accountCode: "411000", label: "Clients", class: 4, debitCents: 18_000, creditCents: 0 },
      { accountCode: "445710", label: "TVA", class: 4, debitCents: 0, creditCents: 3_000 },
      { accountCode: "641000", label: "Salaires", class: 6, debitCents: 4_000, creditCents: 0 },
      { accountCode: "512100", label: "Banque", class: 5, debitCents: 0, creditCents: 4_000 },
      { accountCode: "101000", label: "Capital", class: 1, debitCents: 0, creditCents: 0 },
    ]);
    expect(tb.balanced).toBe(true);
    expect(tb.rows).toHaveLength(5);
    expect(netResult(tb.rows)).toBe(11_000);
  });
});

describe("default chart", () => {
  it("maps every key to an existing account", () => {
    const codes = new Set(DEFAULT_ACCOUNTS.map((a) => a.code));
    for (const [key, code] of Object.entries(DEFAULT_MAPPINGS)) expect(codes.has(code), key).toBe(true);
  });
  it("uses 6-digit codes and derives the class", () => {
    for (const a of DEFAULT_ACCOUNTS) expect(a.code).toMatch(/^[1-8]\d{5}$/);
    expect(accountClass("706100")).toBe(7);
  });
});

describe("supplier payment run (D-078)", () => {
  const l = (date: string, creditCents: number, debitCents = 0) => ({ date: new Date(date), creditCents, debitCents });
  const asOf = new Date("2026-03-31");

  it("pays the fully open items whose due date has come, oldest first", () => {
    const lines = [l("2026-01-10", 1_000), l("2026-02-20", 2_000), l("2026-03-20", 3_000)];
    expect(dueSupplierItems(lines, 30, asOf)).toEqual([lines[0], lines[1]]);
    expect(dueSupplierItems(lines, 0, asOf)).toEqual(lines);
    expect(dueSupplierItems(lines, 60, asOf)).toEqual([lines[0]]);
    expect(dueSupplierItems(lines, 90, asOf)).toEqual([]);
  });

  it("leaves items already paid (FIFO) and the partly paid one", () => {
    // A 1,500 payment settles the oldest item and half of the second.
    const lines = [l("2026-01-10", 1_000), l("2026-02-20", 1_000), l("2026-02-25", 500), l("2026-03-01", 0, 1_500)];
    expect(dueSupplierItems(lines, 0, asOf)).toEqual([lines[2]]);
  });

  it("pays nothing when the supplier is owed nothing", () => {
    expect(dueSupplierItems([l("2026-01-10", 1_000), l("2026-01-11", 0, 1_000)], 0, asOf)).toEqual([]);
    expect(dueSupplierItems([], 0, asOf)).toEqual([]);
  });
});
