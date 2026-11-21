/** Role dashboards: the widgets of the user's roles, computed through each module's public queries. */
import type { ServiceContext } from "@/lib/context";
import { addDays } from "@/lib/dates";
import { parseListParams } from "@/lib/list";
import { getMonthlyGrossMargin, getPayablesAgeing, getProfitAndLoss, getReceivablesAgeing, getVatReport } from "@/modules/accounting";
import { getStockAgeing, getUnitsSold } from "@/modules/sales";
import { getProductivity } from "@/modules/workshop";
import { getPartsConsumption } from "@/modules/parts";
import { dashboardLayout, lastMonths, monthStart, stockTurnover, yearStart, type MarginDepartment } from "../domain/dashboards";

/** Window over which parts consumption is measured for the turnover. */
export const TURNOVER_DAYS = 90;

async function visibleSites(ctx: ServiceContext) {
  return ctx.tx.site.findMany({
    where: ctx.actor.siteIds === "ALL" ? {} : { id: { in: ctx.actor.siteIds } },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
}

function marginRows(pnl: Awaited<ReturnType<typeof getProfitAndLoss>>, deps: MarginDepartment[]) {
  return deps.map((d) => ({
    department: d,
    revenueCents: pnl.byDepartment[d].revenueCents,
    grossMarginCents: pnl.byDepartment[d].grossMarginCents,
    grossMarginBp: pnl.byDepartment[d].grossMarginBp,
  }));
}

export async function getRoleDashboard(ctx: ServiceContext, roleKeys: string[] = ctx.actor.roleKeys) {
  const layout = dashboardLayout(roleKeys, (resource) => ctx.can(resource, "view"));
  const has = (w: (typeof layout.widgets)[number]) => layout.widgets.includes(w);
  const mine = (w: (typeof layout.widgets)[number]) => layout.mine.includes(w);
  const today = ctx.businessDate;
  const mtd = { from: monthStart(today), to: today };
  const ytd = { from: yearStart(today), to: today };
  const trend = lastMonths(today, 6);

  const unitsSold = has("unitsSold")
    ? await (async () => {
        const [month, year, months] = await Promise.all([
          getUnitsSold(ctx, { ...mtd, mine: mine("unitsSold") }),
          getUnitsSold(ctx, { ...ytd, mine: mine("unitsSold") }),
          getUnitsSold(ctx, { from: trend.from, to: today, mine: mine("unitsSold") }),
        ]);
        const byMonth = trend.months.map((m) => ({ month: m, VN: 0, VO: 0, ...months.byMonth.find((x) => x.month === m) }));
        return { mine: mine("unitsSold"), month, year, byMonth };
      })()
    : null;

  const grossMargin = has("grossMargin")
    ? await (async () => {
        const [month, year] = await Promise.all([getProfitAndLoss(ctx, mtd), getProfitAndLoss(ctx, ytd)]);
        return { month: marginRows(month, layout.departments), year: marginRows(year, layout.departments) };
      })()
    : null;

  const marginTrend = has("marginTrend")
    ? await (async () => {
        const rows = await getMonthlyGrossMargin(ctx, { from: trend.from, to: today });
        return trend.months.map((m) => {
          const found = rows.find((r) => r.month === m)?.byDepartment ?? {};
          return { month: m, ...Object.fromEntries(layout.departments.map((d) => [d, found[d] ?? 0])) } as { month: string } & Partial<Record<MarginDepartment, number>>;
        });
      })()
    : null;

  const stockAgeing = has("stockAgeing") ? await getStockAgeing(ctx) : null;

  const workshopProductivity = has("workshopProductivity")
    ? await (async () => {
        const sites = await visibleSites(ctx);
        const perSite: { site: (typeof sites)[number]; rows: Awaited<ReturnType<typeof getProductivity>>["rows"] }[] = [];
        for (const s of sites) {
          const p = await getProductivity(ctx, { siteId: s.id, from: mtd.from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) });
          const rows = mine("workshopProductivity") ? p.rows.filter((r) => r.id === ctx.actor.userId) : p.rows;
          if (rows.length) perSite.push({ site: s, rows });
        }
        const sum = (k: "availableCentiHours" | "clockedCentiHours" | "billedCentiHours") => perSite.flatMap((s) => s.rows).reduce((t, r) => t + r[k], 0);
        const available = sum("availableCentiHours");
        const clocked = sum("clockedCentiHours");
        const billed = sum("billedCentiHours");
        const bp = (a: number, b: number) => (b ? Math.round((a * 10000) / b) : 0);
        return {
          mine: mine("workshopProductivity"),
          availableCentiHours: available,
          clockedCentiHours: clocked,
          billedCentiHours: billed,
          productivityBp: bp(clocked, available),
          efficiencyBp: bp(billed, clocked),
          technicians: perSite.flatMap((s) => s.rows.map((r) => ({ ...r, siteCode: s.site.code }))),
        };
      })()
    : null;

  const partsTurnover = has("partsTurnover")
    ? await (async () => {
        const [sites, rows] = await Promise.all([visibleSites(ctx), getPartsConsumption(ctx, { from: addDays(today, -(TURNOVER_DAYS - 1)), to: today })]);
        const total = rows.reduce((t, r) => ({ costOfUseCents: t.costOfUseCents + r.costOfUseCents, stockValueCents: t.stockValueCents + r.stockValueCents }), { costOfUseCents: 0, stockValueCents: 0 });
        return {
          days: TURNOVER_DAYS,
          ...total,
          turnover: stockTurnover({ ...total, days: TURNOVER_DAYS }),
          bySite: rows
            .map((r) => ({ ...r, site: sites.find((s) => s.id === r.siteId), turnover: stockTurnover({ ...r, days: TURNOVER_DAYS }) }))
            .filter((r) => r.site)
            .sort((a, b) => a.site!.code.localeCompare(b.site!.code)),
        };
      })()
    : null;

  const all = parseListParams({});
  const receivables = has("receivables") ? (await getReceivablesAgeing(ctx, all, { all: true })).totals : null;
  const payables = has("payables") ? (await getPayablesAgeing(ctx, all, { all: true })).totals : null;
  const vat = has("vat")
    ? await (async () => {
        const prev = addDays(mtd.from, -1);
        const [current, previous] = await Promise.all([
          getVatReport(ctx, { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 }),
          getVatReport(ctx, { year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 }),
        ]);
        return [previous, current].map((v) => ({ year: v.year, month: v.month, collectedCents: v.collectedCents, deductibleCents: v.deductibleCents, netDueCents: v.netDueCents, periodStatus: v.periodStatus }));
      })()
    : null;

  return { layout, asOf: today, unitsSold, grossMargin, marginTrend, stockAgeing, workshopProductivity, partsTurnover, receivables, payables, vat };
}

export type RoleDashboard = Awaited<ReturnType<typeof getRoleDashboard>>;
