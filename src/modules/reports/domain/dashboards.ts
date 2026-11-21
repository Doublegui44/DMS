/**
 * Role dashboards (pure): which widgets each role sees, and the KPI formulas they use.
 * Figures come from the same queries as the reports, so a dashboard always agrees with them.
 */
import type { Cents } from "@/lib/money";

export const WIDGETS = ["unitsSold", "grossMargin", "marginTrend", "stockAgeing", "workshopProductivity", "partsTurnover", "receivables", "payables", "vat"] as const;
export type Widget = (typeof WIDGETS)[number];

export const MARGIN_DEPARTMENTS = ["VN", "VO", "WORKSHOP", "PARTS"] as const;
export type MarginDepartment = (typeof MARGIN_DEPARTMENTS)[number];

type Grant = { widgets: Widget[]; departments?: MarginDepartment[]; mine?: Widget[] };

const ALL_DEPS = [...MARGIN_DEPARTMENTS];

/** Default dashboard per role. `mine` widgets show the user's own figures only. */
export const ROLE_DASHBOARDS: Record<string, Grant> = {
  ADMIN: { widgets: ["unitsSold", "grossMargin", "marginTrend", "stockAgeing", "workshopProductivity", "partsTurnover", "receivables"], departments: ALL_DEPS },
  DEALER_PRINCIPAL: { widgets: ["unitsSold", "grossMargin", "marginTrend", "stockAgeing", "workshopProductivity", "partsTurnover", "receivables"], departments: ALL_DEPS },
  SALES_MANAGER: { widgets: ["unitsSold", "grossMargin", "marginTrend", "stockAgeing"], departments: ["VN", "VO"] },
  SALESPERSON: { widgets: ["unitsSold", "stockAgeing"], mine: ["unitsSold"] },
  SERVICE_MANAGER: { widgets: ["workshopProductivity", "grossMargin", "marginTrend"], departments: ["WORKSHOP", "PARTS"] },
  SERVICE_ADVISOR: { widgets: ["workshopProductivity"] },
  TECHNICIAN: { widgets: ["workshopProductivity"], mine: ["workshopProductivity"] },
  PARTS_MANAGER: { widgets: ["partsTurnover", "grossMargin", "marginTrend"], departments: ["PARTS"] },
  PARTS_ADVISOR: { widgets: ["partsTurnover"] },
  ACCOUNTANT: { widgets: ["grossMargin", "marginTrend", "receivables", "payables", "vat"], departments: ALL_DEPS },
};

/** Permission each widget's data needs (resource, view). */
export const WIDGET_RESOURCE: Record<Widget, string> = {
  unitsSold: "sales.order",
  grossMargin: "accounting.report",
  marginTrend: "accounting.report",
  stockAgeing: "vehicle",
  workshopProductivity: "workshop.clocking",
  partsTurnover: "parts.stock",
  receivables: "accounting.report",
  payables: "accounting.report",
  vat: "accounting.report",
};

export type DashboardLayout = { widgets: Widget[]; departments: MarginDepartment[]; mine: Widget[] };

/**
 * The union of the user's roles, kept to what their permissions allow. A widget is "mine" only
 * if every role that grants it restricts it (a salesperson who is also sales manager sees the team).
 */
export function dashboardLayout(roleKeys: string[], canView: (resource: string) => boolean): DashboardLayout {
  const grants = roleKeys.map((k) => ROLE_DASHBOARDS[k]).filter(Boolean);
  const widgets = WIDGETS.filter((w) => grants.some((g) => g.widgets.includes(w)) && canView(WIDGET_RESOURCE[w]));
  const departments = MARGIN_DEPARTMENTS.filter((d) => grants.some((g) => g.departments?.includes(d)));
  const mine = widgets.filter((w) => grants.filter((g) => g.widgets.includes(w)).every((g) => g.mine?.includes(w)));
  return { widgets, departments, mine };
}

// ── KPI formulas ────────────────────────────────────────────

/**
 * Stock turnover, annualised: cost of what was used over `days`, scaled to a year, over the stock
 * held. Returned ×100 (450 = 4.5 turns a year), with days of stock cover. Null without stock or use.
 */
export function stockTurnover(a: { costOfUseCents: Cents; days: number; stockValueCents: Cents }): { turnsX100: number; daysOfStock: number } | null {
  if (a.stockValueCents <= 0 || a.costOfUseCents <= 0 || a.days <= 0) return null;
  const yearly = (a.costOfUseCents * 365) / a.days;
  return {
    turnsX100: Math.round((yearly * 100) / a.stockValueCents),
    daysOfStock: Math.round((a.stockValueCents * a.days) / a.costOfUseCents),
  };
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

export function monthStart(d: Date): Date {
  return utc(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function yearStart(d: Date): Date {
  return utc(d.getUTCFullYear(), 0, 1);
}

/** The `n` months ending with the month of `d`, oldest first, as YYYY-MM, with the first day of the oldest. */
export function lastMonths(d: Date, n: number): { months: string[]; from: Date } {
  const months: string[] = [];
  for (let i = n - 1; i >= 0; i--) months.push(utc(d.getUTCFullYear(), d.getUTCMonth() - i, 1).toISOString().slice(0, 7));
  return { months, from: utc(d.getUTCFullYear(), d.getUTCMonth() - (n - 1), 1) };
}
