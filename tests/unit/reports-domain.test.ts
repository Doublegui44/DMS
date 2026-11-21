import { describe, expect, it } from "vitest";
import {
  ageItems,
  ageingBucket,
  fecAmount,
  fecDate,
  fecFile,
  fecFileName,
  fecRow,
  fifoOpenItems,
  pnlSection,
  profitAndLoss,
  ratioBp,
  vatReturn,
  type FecLine,
} from "@/modules/accounting/domain/reports";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("P&L by department", () => {
  it("classifies income-statement accounts", () => {
    expect(pnlSection("707100")).toBe("REVENUE");
    expect(pnlSection("709000")).toBe("REVENUE");
    expect(pnlSection("607300")).toBe("COST_OF_SALES");
    expect(pnlSection("603730")).toBe("COST_OF_SALES");
    expect(pnlSection("641000")).toBe("EXPENSES");
    expect(pnlSection("758000")).toBe("OTHER_INCOME");
    expect(pnlSection("411000")).toBeNull();
  });

  it("computes revenue, cost of sales, gross margin and result per department", () => {
    const pnl = profitAndLoss([
      { accountCode: "707100", label: "VN sales", departmentCode: "VN", debitCents: 0, creditCents: 100_000 },
      { accountCode: "709000", label: "Rebates", departmentCode: "VN", debitCents: 5_000, creditCents: 0 },
      { accountCode: "607100", label: "VN purchases", departmentCode: "VN", debitCents: 80_000, creditCents: 0 },
      { accountCode: "603710", label: "Stock variation", departmentCode: "VN", debitCents: 0, creditCents: 2_000 },
      { accountCode: "706100", label: "Labour", departmentCode: "WORKSHOP", debitCents: 0, creditCents: 30_000 },
      { accountCode: "641000", label: "Salaries", departmentCode: "WORKSHOP", debitCents: 20_000, creditCents: 0 },
      { accountCode: "613200", label: "Rent", departmentCode: null, debitCents: 4_000, creditCents: 0 },
      { accountCode: "411000", label: "Customers", departmentCode: null, debitCents: 120_000, creditCents: 0 },
    ]);
    expect(pnl.columns).toEqual(["VN", "WORKSHOP", "UNALLOCATED"]);
    expect(pnl.byDepartment.VN).toMatchObject({ revenueCents: 95_000, costOfSalesCents: 78_000, grossMarginCents: 17_000, grossMarginBp: 1789, resultCents: 17_000 });
    expect(pnl.byDepartment.WORKSHOP).toMatchObject({ revenueCents: 30_000, grossMarginCents: 30_000, expensesCents: 20_000, resultCents: 10_000 });
    expect(pnl.byDepartment.UNALLOCATED.resultCents).toBe(-4_000);
    expect(pnl.total.resultCents).toBe(23_000);
    expect(pnl.lines.map((l) => l.accountCode)).toEqual(["603710", "607100", "613200", "641000", "706100", "707100", "709000"]);
  });

  it("matches the trial-balance result (class 7 − class 6)", () => {
    const moves = [
      { accountCode: "707300", label: "", departmentCode: "PARTS", debitCents: 300, creditCents: 10_000 },
      { accountCode: "607300", label: "", departmentCode: "PARTS", debitCents: 6_000, creditCents: 100 },
      { accountCode: "625100", label: "", departmentCode: "OVERHEAD", debitCents: 700, creditCents: 0 },
    ];
    const result = moves.reduce((s, m) => s + (m.creditCents - m.debitCents), 0);
    expect(profitAndLoss(moves).total.resultCents).toBe(result);
  });

  it("rounds ratios half away from zero", () => {
    expect(ratioBp(1, 3)).toBe(3333);
    expect(ratioBp(-1, 8)).toBe(-1250);
    expect(ratioBp(5, 0)).toBe(0);
  });
});

describe("ageing", () => {
  it("buckets by days past due", () => {
    const asOf = d("2026-11-21");
    expect(ageingBucket(d("2026-11-21"), asOf)).toBe("current");
    expect(ageingBucket(d("2026-12-01"), asOf)).toBe("current");
    expect(ageingBucket(d("2026-11-20"), asOf)).toBe("d1_30");
    expect(ageingBucket(d("2026-10-22"), asOf)).toBe("d1_30");
    expect(ageingBucket(d("2026-10-21"), asOf)).toBe("d31_60");
    expect(ageingBucket(d("2026-08-23"), asOf)).toBe("d61_90");
    expect(ageingBucket(d("2026-08-22"), asOf)).toBe("d90plus");
  });

  it("sums open items", () => {
    const t = ageItems(
      [
        { dueDate: d("2026-12-01"), openCents: 100 },
        { dueDate: d("2026-11-01"), openCents: 250 },
        { dueDate: d("2026-01-01"), openCents: 50 },
        { dueDate: d("2026-01-01"), openCents: 0 },
      ],
      d("2026-11-21"),
    );
    expect(t).toEqual({ current: 100, d1_30: 250, d31_60: 0, d61_90: 0, d90plus: 50, totalCents: 400 });
  });

  it("FIFO: the balance is made of the newest documents", () => {
    const lines = [
      { date: d("2026-01-10"), debitCents: 0, creditCents: 1_000 },
      { date: d("2026-02-10"), debitCents: 0, creditCents: 2_000 },
      { date: d("2026-03-10"), debitCents: 0, creditCents: 3_000 },
      { date: d("2026-03-15"), debitCents: 4_000, creditCents: 0 },
    ];
    const open = fifoOpenItems(lines, -1);
    expect(open.map((o) => [o.line.date.toISOString().slice(0, 10), o.openCents])).toEqual([
      ["2026-03-10", 2_000],
    ]);
    expect(fifoOpenItems([{ date: d("2026-01-01"), debitCents: 0, creditCents: 500 }, { date: d("2026-01-02"), debitCents: 0, creditCents: 700 }], -1).map((o) => o.openCents)).toEqual([700, 500]);
    expect(fifoOpenItems(lines.slice(0, 1), 1)).toEqual([]);
  });
});

describe("VAT return", () => {
  it("nets collected against deductible VAT", () => {
    const r = vatReturn([
      { accountCode: "445710", label: "Collected 20 %", debitCents: 1_000, creditCents: 21_000 },
      { accountCode: "445715", label: "Collected on margin", debitCents: 0, creditCents: 5_000 },
      { accountCode: "445660", label: "Deductible", debitCents: 12_000, creditCents: 500 },
      { accountCode: "445711", label: "Collected 10 %", debitCents: 0, creditCents: 0 },
      { accountCode: "411000", label: "Customers", debitCents: 99, creditCents: 0 },
    ]);
    expect(r.collected.map((c) => [c.accountCode, c.amountCents])).toEqual([
      ["445710", 20_000],
      ["445715", 5_000],
    ]);
    expect(r.deductibleCents).toBe(11_500);
    expect(r.netDueCents).toBe(13_500);
  });
});

describe("FEC", () => {
  const line: FecLine = {
    journalCode: "VE",
    journalLabel: "Ventes",
    entryNumber: "VE-2026-000001",
    entryDate: d("2026-03-05"),
    accountCode: "411000",
    accountLabel: "Clients",
    auxAccount: "411C000012",
    auxLabel: "DUPONT | Jean",
    pieceRef: "NTE-FA-2026-000001",
    pieceDate: d("2026-03-05"),
    label: "Invoice\nNTE-FA-2026-000001",
    debitCents: 123_456,
    creditCents: 0,
    lettering: "AA",
    letteringDate: d("2026-03-20"),
    validDate: d("2026-03-05"),
  };

  it("formats dates and amounts", () => {
    expect(fecDate(d("2026-03-05"))).toBe("20260305");
    expect(fecDate(null)).toBe("");
    expect(fecAmount(123_456)).toBe("1234,56");
    expect(fecAmount(5)).toBe("0,05");
    expect(fecAmount(0)).toBe("0,00");
    expect(fecAmount(-1_000)).toBe("-10,00");
  });

  it("writes 18 pipe-separated fields with no separator inside them", () => {
    const row = fecRow(line);
    expect(row.split("|")).toHaveLength(18);
    expect(row).toBe("VE|Ventes|VE-2026-000001|20260305|411000|Clients|411C000012|DUPONT Jean|NTE-FA-2026-000001|20260305|Invoice NTE-FA-2026-000001|1234,56|0,00|AA|20260320|20260305||");
  });

  it("starts with the header and ends lines with CRLF", () => {
    const file = fecFile([line, line]);
    const rows = file.split("\r\n");
    expect(rows[0].startsWith("JournalCode|JournalLib|EcritureNum")).toBe(true);
    expect(rows).toHaveLength(4);
    expect(rows[3]).toBe("");
    expect(fecFileName("552 100 554", d("2026-12-31"))).toBe("552100554FEC20261231.txt");
  });
});
