/** Cycle count reads and the parts dashboard. */
import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { pageArgs, type ListParams } from "@/lib/list";
import { obsoleteBefore } from "../domain/catalogue";
import { partsMargin } from "../domain/pricing";
import { dec } from "../domain/valuation";
import { allowedSites, siteWhere } from "./scope";

export const COUNT_SORTS = ["number", "createdOn", "postedOn", "varianceValueCents"] as const;

export async function listCycleCounts(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("parts.inventory", "view");
  const w: Prisma.CycleCountWhereInput = { ...(siteWhere(ctx, p) as Prisma.CycleCountWhereInput) };
  if (p.filters.status) w.status = p.filters.status as Prisma.CycleCountWhereInput["status"];
  if (p.q) w.OR = [{ number: { contains: p.q, mode: "insensitive" } }, { label: { contains: p.q, mode: "insensitive" } }];
  const sort = (COUNT_SORTS as readonly string[]).includes(p.sort ?? "") ? p.sort! : "createdOn";
  const [rows, total] = await Promise.all([
    ctx.tx.cycleCount.findMany({
      where: w,
      orderBy: [{ [sort]: p.dir }, { number: "desc" }],
      ...pageArgs(p, opts.all),
      include: { site: { select: { code: true } }, _count: { select: { lines: true } } },
    }),
    ctx.tx.cycleCount.count({ where: w }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getCycleCount(ctx: ServiceContext, id: string) {
  const count = await ctx.tx.cycleCount.findUnique({
    where: { id },
    include: {
      site: { select: { id: true, code: true, name: true } },
      lines: {
        include: { stockItem: { include: { part: { select: { id: true, partNumber: true, description: true, unit: true } } } } },
      },
    },
  });
  if (!count) throw new NotFoundError("CycleCount", id);
  ctx.require("parts.inventory", "view", count.siteId);
  const lines = [...count.lines].sort(
    (a, b) => (a.stockItem.bin ?? "~").localeCompare(b.stockItem.bin ?? "~") || a.stockItem.part.partNumber.localeCompare(b.stockItem.part.partNumber),
  );
  const entry = count.status === "POSTED" ? await ctx.tx.journalEntry.findFirst({ where: { sourceType: "CYCLE_COUNT", sourceId: id }, select: { id: true, number: true } }) : null;
  return {
    count,
    lines: lines.map((l) => ({ ...l, onHandNow: dec(l.stockItem.qtyOnHand) })),
    counted: lines.filter((l) => l.countedQty !== null).length,
    entry,
    canEdit: ctx.can("parts.inventory", "edit", count.siteId),
    canPost: ctx.can("parts.inventory", "validate", count.siteId),
  };
}

export async function getCycleCountFormData(ctx: ServiceContext) {
  ctx.require("parts.inventory", "create");
  const [families, sites] = await Promise.all([
    ctx.tx.part.findMany({ distinct: ["family"], select: { family: true }, orderBy: { family: "asc" } }),
    ctx.tx.site.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  return {
    families: families.map((f) => f.family),
    sites: sites.filter((s) => ctx.can("parts.inventory", "create", s.id)).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
  };
}

/** Parts KPIs for the dashboard, over the sites the actor sees. */
export async function getPartsDashboard(ctx: ServiceContext) {
  ctx.require("parts.stock", "view");
  const sites = allowedSites(ctx);
  const scope = sites ? { siteId: { in: sites } } : {};
  const monthStart = new Date(Date.UTC(ctx.businessDate.getUTCFullYear(), ctx.businessDate.getUTCMonth(), 1));
  const [stock, belowMin, openOrders, variance, toPay, counter, obsolete] = await Promise.all([
    ctx.tx.stockItem.aggregate({ where: scope, _sum: { valueCents: true } }),
    ctx.tx.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM stock_item WHERE "minQty" > 0 AND "qtyOnHand" - "qtyReserved" < "minQty"${sites ? ` AND "siteId" = ANY($1)` : ""}`,
      ...(sites ? [sites] : []),
    ),
    ctx.tx.purchaseOrder.count({ where: { ...scope, status: { in: ["SENT", "PARTIAL"] } } }),
    ctx.tx.supplierInvoice.count({ where: { ...scope, status: "VARIANCE" } }),
    ctx.tx.supplierInvoice.aggregate({ where: { ...scope, status: "MATCHED", dueDate: { lte: ctx.businessDate } }, _sum: { totalInclVatCents: true }, _count: true }),
    ctx.tx.counterSale.aggregate({ where: { ...scope, status: "INVOICED", invoicedOn: { gte: monthStart } }, _sum: { totalExclVatCents: true, costCents: true }, _count: true }),
    ctx.tx.stockItem.aggregate({ where: { ...scope, qtyOnHand: { gt: 0 }, lastMovementOn: { lte: obsoleteBefore(ctx.businessDate) } }, _sum: { valueCents: true }, _count: true }),
  ]);
  const revenue = counter._sum.totalExclVatCents ?? 0;
  return {
    stockValueCents: stock._sum.valueCents ?? 0,
    belowMin: Number(belowMin[0]?.n ?? 0),
    openOrders,
    invoicesInVariance: variance,
    dueInvoices: toPay._count,
    dueInvoicesCents: toPay._sum.totalInclVatCents ?? 0,
    counterSalesMtd: counter._count,
    counterRevenueMtdCents: revenue,
    counterMarginMtd: partsMargin(revenue, counter._sum.costCents ?? 0),
    obsoleteItems: obsolete._count,
    obsoleteValueCents: obsolete._sum.valueCents ?? 0,
  };
}
