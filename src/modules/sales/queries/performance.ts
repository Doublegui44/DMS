/** Sales performance for dashboards: units sold, deal margins, stock ageing. */
import type { Prisma } from "@prisma/client";
import { siteScopeWhere, type ServiceContext } from "@/lib/context";
import { daysBetween } from "@/lib/dates";
import { ageingLevel, STOCK_LEDGER_STATUSES } from "@/modules/core";
import { salesSettings } from "../services/shared";

/**
 * Units sold = orders invoiced in the range (the sale is recognised on the invoice), per stock type,
 * with their front- and back-end margins. `mine` keeps the salesperson's own orders.
 * `byMonth` counts units per invoicing month (YYYY-MM).
 */
export async function getUnitsSold(ctx: ServiceContext, a: { from: Date; to: Date; mine?: boolean }) {
  ctx.require("sales.order", "view");
  const where: Prisma.SalesOrderWhereInput = { ...siteScopeWhere(ctx.actor), invoicedOn: { gte: a.from, lte: a.to }, status: { not: "CANCELLED" } };
  if (a.mine) where.salespersonId = ctx.actor.userId;
  const orders = await ctx.tx.salesOrder.findMany({ where, select: { stockType: true, invoicedOn: true, frontEndMarginCents: true, backEndMarginCents: true } });
  const empty = () => ({ units: 0, frontEndCents: 0, backEndCents: 0 });
  const byType = { VN: empty(), VO: empty() };
  const byMonth = new Map<string, { VN: number; VO: number }>();
  for (const o of orders) {
    const type = o.stockType === "VO" ? "VO" : "VN";
    byType[type].units += 1;
    byType[type].frontEndCents += o.frontEndMarginCents;
    byType[type].backEndCents += o.backEndMarginCents;
    const month = o.invoicedOn!.toISOString().slice(0, 7);
    const m = byMonth.get(month) ?? { VN: 0, VO: 0 };
    m[type] += 1;
    byMonth.set(month, m);
  }
  return {
    ...byType,
    units: byType.VN.units + byType.VO.units,
    byMonth: [...byMonth.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([month, u]) => ({ month, ...u })),
  };
}

/** Vehicles in stock by ageing band (settings thresholds), count and value, per stock type. */
export async function getStockAgeing(ctx: ServiceContext) {
  ctx.require("vehicle", "view");
  const vehicles = await ctx.tx.vehicle.findMany({
    where: { ...siteScopeWhere(ctx.actor), stockType: { in: ["VN", "VO"] }, status: { in: STOCK_LEDGER_STATUSES }, stockInDate: { not: null } },
    select: { stockType: true, stockInDate: true, stockValueCents: true, siteId: true },
  });
  const { ageingThresholdsDays } = await salesSettings(ctx.tx, null);
  const bands = ["ok", "watch", "warning", "critical"] as const;
  const blank = () => Object.fromEntries(bands.map((b) => [b, { count: 0, valueCents: 0 }])) as Record<(typeof bands)[number], { count: number; valueCents: number }>;
  const out = { VN: blank(), VO: blank() };
  for (const v of vehicles) {
    const band = ageingLevel(daysBetween(v.stockInDate!, ctx.businessDate), ageingThresholdsDays);
    const cell = out[v.stockType === "VO" ? "VO" : "VN"][band];
    cell.count += 1;
    cell.valueCents += v.stockValueCents;
  }
  return { thresholds: ageingThresholdsDays, ...out };
}
