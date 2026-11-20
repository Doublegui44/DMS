/** Stock reads: items per site/bin, an item's ledger, movements, transfers, obsolete stock. */
import { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { pageArgs, type ListParams } from "@/lib/list";
import { obsoleteBefore } from "../domain/catalogue";
import { availableQty, isBelowMin } from "../domain/purchasing";
import { dec } from "../domain/valuation";
import { onOrderByPart } from "../services/purchasing";
import { allowedSites, dateRange, siteWhere } from "./scope";

export const STOCK_ITEM_SORTS = ["partNumber", "bin", "qtyOnHand", "valueCents", "pmpCents", "lastMovementOn"] as const;

/** Ids of the items whose available stock is under their minimum (a column comparison Prisma cannot express). */
async function belowMinIds(ctx: ServiceContext, sites: string[] | null): Promise<string[]> {
  const rows = await ctx.tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM stock_item
    WHERE "minQty" > 0 AND "qtyOnHand" - "qtyReserved" < "minQty"
    ${sites ? Prisma.sql`AND "siteId" IN (${Prisma.join(sites.length ? sites : [""])})` : Prisma.empty}`;
  return rows.map((r) => r.id);
}

function itemOrder(p: ListParams): Prisma.StockItemOrderByWithRelationInput[] {
  const sort = (STOCK_ITEM_SORTS as readonly string[]).includes(p.sort ?? "") ? p.sort! : "partNumber";
  const dir = p.sort ? p.dir : "asc";
  if (sort === "partNumber") return [{ part: { partNumber: dir } }, { site: { code: "asc" } }];
  // Only nullable columns accept a nulls position.
  const order = sort === "bin" || sort === "lastMovementOn" ? { sort: dir, nulls: "last" } : dir;
  return [{ [sort]: order } as Prisma.StockItemOrderByWithRelationInput, { part: { partNumber: "asc" } }];
}

export async function listStockItems(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("parts.stock", "view");
  const and: Prisma.StockItemWhereInput[] = [siteWhere(ctx, p) as Prisma.StockItemWhereInput];
  if (p.filters.held !== "all") and.push({ OR: [{ qtyOnHand: { gt: 0 } }, { minQty: { gt: 0 } }, { qtyReserved: { gt: 0 } }] });
  if (p.q) {
    const compact = p.q.replace(/\s+/g, "");
    and.push({
      OR: [
        { part: { partNumber: { contains: compact, mode: "insensitive" } } },
        { part: { description: { contains: p.q, mode: "insensitive" } } },
        { bin: { startsWith: p.q.toUpperCase() } },
      ],
    });
  }
  if (p.filters.family) and.push({ part: { family: p.filters.family } });
  if (p.filters.belowMin === "1") {
    const sites = p.filters.site ? [p.filters.site] : allowedSites(ctx);
    and.push({ id: { in: await belowMinIds(ctx, sites) } });
  }
  if (p.filters.obsolete === "1") and.push({ qtyOnHand: { gt: 0 }, lastMovementOn: { lte: obsoleteBefore(ctx.businessDate) } });
  const where: Prisma.StockItemWhereInput = { AND: and };
  const [rows, total, sum] = await Promise.all([
    ctx.tx.stockItem.findMany({
      where,
      orderBy: itemOrder(p),
      ...pageArgs(p, opts.all),
      include: { part: { select: { id: true, partNumber: true, description: true, family: true, unit: true } }, site: { select: { code: true } } },
    }),
    ctx.tx.stockItem.count({ where }),
    ctx.tx.stockItem.aggregate({ where, _sum: { valueCents: true } }),
  ]);
  return {
    rows: rows.map((r) => ({
      ...r,
      available: availableQty({ onHand: r.qtyOnHand, reserved: r.qtyReserved }),
      belowMin: isBelowMin({ onHand: r.qtyOnHand, reserved: r.qtyReserved, min: r.minQty }),
    })),
    total,
    valueCents: sum._sum.valueCents ?? 0,
    page: p.page,
    pageSize: p.pageSize,
  };
}

export async function getStockItem(ctx: ServiceContext, id: string) {
  const item = await ctx.tx.stockItem.findUnique({
    where: { id },
    include: { part: { include: { supplier: { select: { id: true, name: true } } } }, site: { select: { id: true, code: true, name: true } } },
  });
  if (!item) throw new NotFoundError("StockItem", id);
  ctx.require("parts.stock", "view", item.siteId);
  const [movements, onOrder, reservations] = await Promise.all([
    ctx.tx.partMovement.findMany({ where: { stockItemId: id }, orderBy: [{ createdAt: "desc" }], take: 100 }),
    onOrderByPart(ctx.tx, item.siteId, [item.partId]),
    ctx.tx.counterSaleLine.findMany({
      where: { partId: item.partId, sale: { siteId: item.siteId, status: "CONFIRMED" } },
      include: { sale: { select: { id: true, number: true, customer: { select: { displayName: true } } } } },
    }),
  ]);
  return {
    item,
    movements,
    onOrder: onOrder.get(item.partId) ?? dec(0),
    reservations,
    available: availableQty({ onHand: item.qtyOnHand, reserved: item.qtyReserved }),
    belowMin: isBelowMin({ onHand: item.qtyOnHand, reserved: item.qtyReserved, min: item.minQty }),
    canEdit: ctx.can("parts.stock", "edit", item.siteId),
  };
}

export const MOVEMENT_SORTS = ["createdAt", "businessDate", "valueCents"] as const;

/** The stock ledger across items: every receipt, sale, transfer and adjustment. */
export async function listMovements(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("parts.stock", "view");
  const w: Prisma.PartMovementWhereInput = { ...(siteWhere(ctx, p) as Prisma.PartMovementWhereInput) };
  if (p.filters.kind) w.kind = p.filters.kind as Prisma.PartMovementWhereInput["kind"];
  if (p.q) w.OR = [{ reference: { contains: p.q, mode: "insensitive" } }, { stockItem: { part: { partNumber: { contains: p.q.replace(/\s+/g, ""), mode: "insensitive" } } } }];
  const range = dateRange(p);
  if (range) w.businessDate = range;
  const sort = (MOVEMENT_SORTS as readonly string[]).includes(p.sort ?? "") ? p.sort! : "createdAt";
  const [rows, total] = await Promise.all([
    ctx.tx.partMovement.findMany({
      where: w,
      orderBy: [{ [sort]: p.dir }, { createdAt: "desc" }],
      ...pageArgs(p, opts.all),
      include: { stockItem: { select: { id: true, bin: true, site: { select: { code: true } }, part: { select: { partNumber: true, description: true } } } } },
    }),
    ctx.tx.partMovement.count({ where: w }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

/** Stock without any movement for `months` (12 by default), with its value. */
export async function listObsoleteStock(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("parts.stock", "view");
  const months = [6, 12, 18, 24].includes(Number(p.filters.months)) ? Number(p.filters.months) : 12;
  const before = obsoleteBefore(ctx.businessDate, months);
  const where: Prisma.StockItemWhereInput = {
    ...(siteWhere(ctx, p) as Prisma.StockItemWhereInput),
    qtyOnHand: { gt: 0 },
    OR: [{ lastMovementOn: null }, { lastMovementOn: { lte: before } }],
    ...(p.filters.family ? { part: { family: p.filters.family } } : {}),
  };
  const [rows, total, sum] = await Promise.all([
    ctx.tx.stockItem.findMany({
      where,
      orderBy: [{ valueCents: "desc" }, { id: "asc" }],
      ...pageArgs(p, opts.all),
      include: { part: { select: { id: true, partNumber: true, description: true, family: true } }, site: { select: { code: true } } },
    }),
    ctx.tx.stockItem.count({ where }),
    ctx.tx.stockItem.aggregate({ where, _sum: { valueCents: true } }),
  ]);
  return { rows, total, months, before, today: ctx.businessDate, valueCents: sum._sum.valueCents ?? 0, page: p.page, pageSize: p.pageSize };
}

export const TRANSFER_SORTS = ["number", "transferredOn", "valueCents"] as const;

export async function listTransfers(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("parts.stock", "view");
  const sites = allowedSites(ctx);
  const w: Prisma.StockTransferWhereInput = sites ? { OR: [{ fromSiteId: { in: sites } }, { toSiteId: { in: sites } }] } : {};
  if (p.filters.site) w.AND = [{ OR: [{ fromSiteId: p.filters.site }, { toSiteId: p.filters.site }] }];
  if (p.q) w.number = { contains: p.q, mode: "insensitive" };
  const sort = (TRANSFER_SORTS as readonly string[]).includes(p.sort ?? "") ? p.sort! : "transferredOn";
  const [rows, total] = await Promise.all([
    ctx.tx.stockTransfer.findMany({
      where: w,
      orderBy: [{ [sort]: p.dir }, { number: "desc" }],
      ...pageArgs(p, opts.all),
      include: { fromSite: { select: { code: true } }, toSite: { select: { code: true } }, _count: { select: { lines: true } } },
    }),
    ctx.tx.stockTransfer.count({ where: w }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getTransfer(ctx: ServiceContext, id: string) {
  const t = await ctx.tx.stockTransfer.findUnique({
    where: { id },
    include: { fromSite: true, toSite: true, lines: { include: { part: { select: { id: true, partNumber: true, description: true } } } } },
  });
  if (!t) throw new NotFoundError("StockTransfer", id);
  if (!ctx.can("parts.stock", "view", t.fromSiteId) && !ctx.can("parts.stock", "view", t.toSiteId)) ctx.require("parts.stock", "view", t.fromSiteId);
  const entries = await ctx.tx.journalEntry.findMany({ where: { sourceType: "STOCK_TRANSFER", sourceId: id }, select: { id: true, number: true, siteId: true } });
  return { transfer: t, entries };
}

export async function getTransferFormData(ctx: ServiceContext) {
  const sites = await ctx.tx.site.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  return {
    from: sites.filter((s) => ctx.can("parts.stock", "edit", s.id)).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
    to: sites.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
  };
}
