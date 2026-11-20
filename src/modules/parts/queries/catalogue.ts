/** Catalogue reads: parts list and card, form data, the discount matrix. */
import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { pageArgs, type ListParams } from "@/lib/list";
import { resolveReplacement } from "../domain/catalogue";
import { PRICE_CLASSES } from "../domain/pricing";
import { dec, Decimal } from "../domain/valuation";
import { PART_UNITS } from "../schemas/parts";
import { allowedSites } from "./scope";

export const PART_SORTS = ["partNumber", "description", "family", "retailPriceCents", "listCostCents"] as const;

function partWhere(p: ListParams): Prisma.PartWhereInput {
  const and: Prisma.PartWhereInput[] = [];
  if (p.q) {
    const compact = p.q.replace(/\s+/g, "");
    and.push({ OR: [{ partNumber: { contains: compact, mode: "insensitive" } }, { description: { contains: p.q, mode: "insensitive" } }] });
  }
  if (p.filters.family) and.push({ family: p.filters.family });
  if (p.filters.brand === "AFTERMARKET") and.push({ brandId: null });
  else if (p.filters.brand) and.push({ brandId: p.filters.brand });
  if (p.filters.supplier) and.push({ supplierId: p.filters.supplier });
  if (p.filters.active === "0") and.push({ active: false });
  else if (p.filters.active !== "all") and.push({ active: true });
  if (p.filters.superseded === "1") and.push({ replacedBy: { isNot: null } });
  return { AND: and };
}

export async function listParts(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("parts.part", "view");
  const where = partWhere(p);
  const sort = (PART_SORTS as readonly string[]).includes(p.sort ?? "") ? (p.sort as string) : "partNumber";
  const sites = allowedSites(ctx);
  const [rows, total] = await Promise.all([
    ctx.tx.part.findMany({
      where,
      orderBy: { [sort]: p.sort ? p.dir : "asc" },
      ...pageArgs(p, opts.all),
      include: {
        brand: { select: { name: true } },
        supplier: { select: { name: true } },
        discountCode: { select: { code: true } },
        replacedBy: { include: { newPart: { select: { id: true, partNumber: true } } } },
        stock: { where: sites ? { siteId: { in: sites } } : {}, select: { siteId: true, qtyOnHand: true, qtyReserved: true } },
      },
    }),
    ctx.tx.part.count({ where }),
  ]);
  return {
    rows: rows.map((r) => {
      const here = r.stock.find((s) => s.siteId === ctx.siteId);
      return {
        ...r,
        onHandHere: here ? dec(here.qtyOnHand) : new Decimal(0),
        availableHere: here ? dec(here.qtyOnHand).minus(dec(here.qtyReserved)) : new Decimal(0),
        onHandGroup: r.stock.reduce((s, x) => s.plus(dec(x.qtyOnHand)), new Decimal(0)),
      };
    }),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}

export async function getPart(ctx: ServiceContext, id: string) {
  ctx.require("parts.part", "view");
  const part = await ctx.tx.part.findUnique({
    where: { id },
    include: {
      brand: true,
      supplier: true,
      discountCode: { include: { rates: true } },
      replacedBy: { include: { newPart: { select: { id: true, partNumber: true, description: true } } } },
      replaces: { include: { oldPart: { select: { id: true, partNumber: true, description: true } } } },
    },
  });
  if (!part) throw new NotFoundError("Part", id);
  const sites = allowedSites(ctx);
  const [stock, onOrder, links, siteRows] = await Promise.all([
    ctx.tx.stockItem.findMany({
      where: { partId: id, ...(sites ? { siteId: { in: sites } } : {}) },
      include: { site: { select: { id: true, code: true, name: true } } },
      orderBy: { site: { code: "asc" } },
    }),
    ctx.tx.purchaseOrderLine.findMany({
      where: { partId: id, purchaseOrder: { status: { in: ["DRAFT", "SENT", "PARTIAL"] }, ...(sites ? { siteId: { in: sites } } : {}) } },
      include: { purchaseOrder: { select: { id: true, number: true, status: true, expectedOn: true, site: { select: { code: true } } } } },
    }),
    ctx.tx.partSupersession.findMany({ select: { oldPartId: true, newPartId: true, effectiveOn: true } }),
    ctx.tx.site.findMany({ where: sites ? { id: { in: sites } } : {}, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  const byOld = new Map(links.map((l) => [l.oldPartId, l]));
  const current = resolveReplacement(id, (pid) => byOld.get(pid), ctx.businessDate);
  const currentPart = current.partId === id ? null : await ctx.tx.part.findUnique({ where: { id: current.partId }, select: { id: true, partNumber: true } });
  const rates = Object.fromEntries(PRICE_CLASSES.map((c) => [c, part.discountCode.rates.find((r) => r.priceClass === c)?.discountBp ?? 0])) as Record<(typeof PRICE_CLASSES)[number], number>;
  return {
    part,
    stock,
    onOrder,
    rates,
    currentPart,
    canEdit: ctx.can("parts.part", "edit"),
    /** Sites where the actor sets bins and levels, with the site's stock item when it has one. */
    levelSites: siteRows.filter((s) => ctx.can("parts.stock", "edit", s.id)).map((s) => ({ ...s, item: stock.find((i) => i.siteId === s.id) ?? null })),
  };
}

export async function getPartFormData(ctx: ServiceContext) {
  ctx.require("parts.part", "view");
  const [brands, suppliers, codes, families] = await Promise.all([
    ctx.tx.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.tx.supplier.findMany({ where: { OR: [{ isOem: true }, { parts: { some: {} } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.tx.discountCode.findMany({ select: { id: true, code: true, label: true }, orderBy: { code: "asc" } }),
    ctx.tx.part.findMany({ distinct: ["family"], select: { family: true }, orderBy: { family: "asc" } }),
  ]);
  return {
    brands: brands.map((b) => ({ value: b.id, label: b.name })),
    suppliers: suppliers.map((s) => ({ value: s.id, label: s.name })),
    discountCodes: codes.map((c) => ({ value: c.id, label: `${c.code} — ${c.label}` })),
    families: families.map((f) => f.family),
    units: [...PART_UNITS],
  };
}

export async function getDiscountMatrix(ctx: ServiceContext) {
  ctx.require("parts.part", "view");
  const codes = await ctx.tx.discountCode.findMany({ include: { rates: true, _count: { select: { parts: true } } }, orderBy: { code: "asc" } });
  return {
    priceClasses: PRICE_CLASSES,
    rows: codes.map((c) => ({
      id: c.id,
      code: c.code,
      label: c.label,
      parts: c._count.parts,
      rates: Object.fromEntries(PRICE_CLASSES.map((k) => [k, c.rates.find((r) => r.priceClass === k)?.discountBp ?? 0])) as Record<(typeof PRICE_CLASSES)[number], number>,
    })),
    canEdit: ctx.can("parts.part", "edit"),
  };
}
