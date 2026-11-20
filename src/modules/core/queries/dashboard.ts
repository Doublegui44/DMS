import type { ServiceContext } from "@/lib/context";
import { addDays } from "@/lib/dates";

/** Phase 1 KPIs: customers and vehicle stock per site. Role dashboards come in Phase 6. */
export async function getCoreDashboard(ctx: ServiceContext) {
  ctx.require("dashboard", "view");
  const siteFilter = ctx.actor.siteIds === "ALL" ? {} : { siteId: { in: ctx.actor.siteIds } };
  // A new car is in stock (and in account 371) from its arrival only: a reserved car still on order is not.
  const inStockVn = { stockType: "VN" as const, status: { in: ["IN_STOCK" as const, "RESERVED" as const] }, stockInDate: { not: null } };
  const inStockVo = { stockType: "VO" as const, status: { in: ["INTAKE" as const, "RECONDITIONING" as const, "FOR_SALE" as const, "RESERVED" as const] } };
  const aged = addDays(ctx.businessDate, -90);

  const [customers, vn, vo, pipelineVn, agedVo, bySite, sites] = await Promise.all([
    ctx.tx.customer.count({ where: { kind: { not: "OEM" } } }),
    ctx.tx.vehicle.aggregate({ where: { ...siteFilter, ...inStockVn }, _count: true, _sum: { stockValueCents: true } }),
    ctx.tx.vehicle.aggregate({ where: { ...siteFilter, ...inStockVo }, _count: true, _sum: { stockValueCents: true } }),
    ctx.tx.vehicle.count({ where: { ...siteFilter, stockType: "VN", stockInDate: null, status: { in: ["ORDERED", "IN_TRANSIT", "RESERVED"] } } }),
    ctx.tx.vehicle.count({ where: { ...siteFilter, ...inStockVo, stockInDate: { lte: aged } } }),
    ctx.tx.vehicle.groupBy({
      by: ["siteId", "stockType"],
      where: { ...siteFilter, OR: [inStockVn, inStockVo] },
      _count: true,
      _sum: { stockValueCents: true },
    }),
    ctx.tx.site.findMany({ where: ctx.actor.siteIds === "ALL" ? {} : { id: { in: ctx.actor.siteIds } }, orderBy: { name: "asc" } }),
  ]);

  return {
    customers,
    vnCount: vn._count,
    vnValueCents: vn._sum.stockValueCents ?? 0,
    voCount: vo._count,
    voValueCents: vo._sum.stockValueCents ?? 0,
    pipelineVn,
    agedVo,
    bySite: sites.map((s) => {
      const row = (type: "VN" | "VO") => bySite.find((b) => b.siteId === s.id && b.stockType === type);
      return {
        site: s.name,
        code: s.code,
        vn: row("VN")?._count ?? 0,
        vnValueCents: row("VN")?._sum.stockValueCents ?? 0,
        vo: row("VO")?._count ?? 0,
        voValueCents: row("VO")?._sum.stockValueCents ?? 0,
      };
    }),
  };
}
