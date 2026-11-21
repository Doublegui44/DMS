import { describe, expect, it } from "vitest";
import { dashboardLayout, lastMonths, monthStart, stockTurnover, yearStart } from "@/modules/reports/domain/dashboards";

const all = () => true;

describe("dashboard layout", () => {
  it("gives each role its own widgets and departments", () => {
    expect(dashboardLayout(["SALES_MANAGER"], all)).toEqual({ widgets: ["unitsSold", "grossMargin", "marginTrend", "stockAgeing"], departments: ["VN", "VO"], mine: [] });
    expect(dashboardLayout(["TECHNICIAN"], all)).toEqual({ widgets: ["workshopProductivity"], departments: [], mine: ["workshopProductivity"] });
    expect(dashboardLayout(["ACCOUNTANT"], all).widgets).toEqual(["grossMargin", "marginTrend", "receivables", "payables", "vat"]);
    expect(dashboardLayout(["DEALER_PRINCIPAL"], all).departments).toEqual(["VN", "VO", "WORKSHOP", "PARTS"]);
  });

  it("merges roles; own figures only when every granting role restricts them", () => {
    expect(dashboardLayout(["SALESPERSON"], all).mine).toEqual(["unitsSold"]);
    expect(dashboardLayout(["SALESPERSON", "SALES_MANAGER"], all).mine).toEqual([]);
    expect(dashboardLayout(["SERVICE_MANAGER", "PARTS_MANAGER"], all).departments).toEqual(["WORKSHOP", "PARTS"]);
  });

  it("drops widgets the permissions do not cover", () => {
    const layout = dashboardLayout(["SALES_MANAGER"], (r) => r !== "accounting.report");
    expect(layout.widgets).toEqual(["unitsSold", "stockAgeing"]);
    expect(dashboardLayout(["UNKNOWN"], all).widgets).toEqual([]);
  });
});

describe("KPI formulas", () => {
  it("annualises stock turnover and days of cover", () => {
    // €30,000 used in 90 days, €40,000 on the shelf: 121,667/yr ÷ 40,000 = 3.04 turns, 120 days of cover.
    expect(stockTurnover({ costOfUseCents: 3_000_000, days: 90, stockValueCents: 4_000_000 })).toEqual({ turnsX100: 304, daysOfStock: 120 });
    expect(stockTurnover({ costOfUseCents: 0, days: 90, stockValueCents: 100 })).toBeNull();
    expect(stockTurnover({ costOfUseCents: 100, days: 90, stockValueCents: 0 })).toBeNull();
  });

  it("works out periods from the business date", () => {
    const d = new Date("2026-02-14T00:00:00Z");
    expect(monthStart(d).toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(yearStart(d).toISOString().slice(0, 10)).toBe("2026-01-01");
    const six = lastMonths(d, 6);
    expect(six.months).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(six.from.toISOString().slice(0, 10)).toBe("2025-09-01");
  });
});
