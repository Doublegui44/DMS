import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { addDays, daysBetween } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { orderBy, pageArgs, type ListParams } from "@/lib/list";
import { ageingLevel } from "@/modules/core";
import { expectedVoMargin } from "../domain/pricing";
import { salesSettings, standardRateBp } from "../services/shared";

export const STOCK_SORTS = ["make", "model", "status", "stockInDate", "listPriceCents", "stockValueCents", "mileage", "createdAt"] as const;

function siteFilter(ctx: ServiceContext, p: ListParams): Prisma.VehicleWhereInput {
  if (p.filters.site) return { siteId: p.filters.site };
  return ctx.actor.siteIds === "ALL" ? {} : { siteId: { in: ctx.actor.siteIds } };
}

function search(q: string): Prisma.VehicleWhereInput {
  return {
    OR: [
      { vin: { contains: q, mode: "insensitive" } },
      { registration: { contains: q, mode: "insensitive" } },
      { make: { contains: q, mode: "insensitive" } },
      { model: { contains: q, mode: "insensitive" } },
      { version: { contains: q, mode: "insensitive" } },
    ],
  };
}

const VN_STATUSES = ["ORDERED", "IN_TRANSIT", "IN_STOCK", "RESERVED", "SOLD"] as const;

/** New-vehicle stock and pipeline: on order, in transit, in stock, reserved/sold awaiting delivery. */
export async function listVnStock(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("sales.vn_stock", "view");
  const and: Prisma.VehicleWhereInput[] = [siteFilter(ctx, p), { stockType: "VN", status: { in: [...VN_STATUSES] } }];
  if (p.q) and.push(search(p.q));
  if (p.filters.status) and.push({ status: p.filters.status as Prisma.VehicleWhereInput["status"] });
  if (p.filters.brand) and.push({ brandId: p.filters.brand });
  if (p.filters.arrived === "1") and.push({ stockInDate: { not: null } });
  const where: Prisma.VehicleWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    ctx.tx.vehicle.findMany({
      where,
      orderBy: orderBy(p, STOCK_SORTS, "stockInDate"),
      ...pageArgs(p, opts.all),
      include: {
        site: { select: { code: true } },
        factoryOrder: { select: { id: true, number: true, status: true, expectedOn: true, oemReference: true } },
        reservations: { where: { status: "ACTIVE" }, include: { customer: { select: { id: true, displayName: true } } } },
        salesOrders: { where: { status: { in: ["CONFIRMED", "INVOICED"] } }, include: { customer: { select: { id: true, displayName: true } } } },
      },
    }),
    ctx.tx.vehicle.count({ where }),
  ]);
  const thresholds = (await salesSettings(ctx.tx, null)).ageingThresholdsDays;
  return {
    rows: rows.map((v) => {
      const days = v.stockInDate ? daysBetween(v.stockInDate, ctx.businessDate) : null;
      return { ...v, daysInStock: days, ageing: days === null ? null : ageingLevel(days, thresholds) };
    }),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}

const VO_STATUSES = ["INTAKE", "RECONDITIONING", "FOR_SALE", "RESERVED", "SOLD"] as const;

/** Used-vehicle stock with ageing (60/90/120 days by default) and the expected margin at the advertised price. */
export async function listVoStock(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("sales.vo_stock", "view");
  const and: Prisma.VehicleWhereInput[] = [siteFilter(ctx, p), { stockType: "VO", status: { in: [...VO_STATUSES] } }];
  if (p.q) and.push(search(p.q));
  if (p.filters.status) and.push({ status: p.filters.status as Prisma.VehicleWhereInput["status"] });
  if (p.filters.regime) and.push({ vatRegime: p.filters.regime as Prisma.VehicleWhereInput["vatRegime"] });
  const thresholds = (await salesSettings(ctx.tx, null)).ageingThresholdsDays;
  if (p.filters.ageing) {
    const min = { watch: thresholds[0], warning: thresholds[1], critical: thresholds[2] }[p.filters.ageing];
    if (min !== undefined) and.push({ stockInDate: { lte: addDays(ctx.businessDate, -min) } });
  }
  const where: Prisma.VehicleWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    ctx.tx.vehicle.findMany({
      where,
      orderBy: orderBy(p, STOCK_SORTS, "stockInDate"),
      ...pageArgs(p, opts.all),
      include: {
        site: { select: { id: true, code: true } },
        voPurchases: { where: { cancelledOn: null }, orderBy: { createdAt: "desc" }, take: 1 },
        reservations: { where: { status: "ACTIVE" }, include: { customer: { select: { id: true, displayName: true } } } },
        salesOrders: { where: { status: { in: ["CONFIRMED", "INVOICED"] } }, include: { customer: { select: { id: true, displayName: true } } } },
      },
    }),
    ctx.tx.vehicle.count({ where }),
  ]);
  const rates = new Map<string, number>();
  const out = [];
  for (const v of rows) {
    const siteId = v.site?.id ?? "";
    if (!rates.has(siteId) && siteId) rates.set(siteId, await standardRateBp(ctx.tx, siteId, ctx.businessDate));
    const days = v.stockInDate ? daysBetween(v.stockInDate, ctx.businessDate) : 0;
    const purchase = v.voPurchases[0]?.priceCents ?? v.stockValueCents;
    out.push({
      ...v,
      daysInStock: days,
      ageing: ageingLevel(days, thresholds),
      purchasePriceCents: purchase,
      expectedMarginCents:
        v.listPriceCents && v.status !== "SOLD"
          ? expectedVoMargin({ listPriceInclCents: v.listPriceCents, stockValueCents: v.stockValueCents, purchasePriceCents: purchase, vatRegime: v.vatRegime, rateBp: rates.get(siteId) ?? 2000 })
          : null,
    });
  }
  return { rows: out, total, page: p.page, pageSize: p.pageSize, thresholds };
}

export async function getVoVehicle(ctx: ServiceContext, id: string) {
  const v = await ctx.tx.vehicle.findUnique({
    where: { id },
    include: {
      site: true,
      brand: true,
      costLines: { orderBy: { createdAt: "asc" }, include: { supplier: { select: { name: true } } } },
      priceChanges: { orderBy: { createdAt: "desc" } },
      voPurchases: { orderBy: { createdAt: "desc" }, include: { customer: { select: { id: true, displayName: true } }, supplier: { select: { id: true, name: true } }, policeEntry: true, salesOrder: { select: { id: true, number: true } } } },
      reservations: { where: { status: "ACTIVE" }, include: { customer: { select: { id: true, displayName: true } } } },
      salesOrders: { orderBy: { createdAt: "desc" }, include: { customer: { select: { id: true, displayName: true } } } },
      statusHistory: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!v) throw new NotFoundError("Vehicle", id);
  if (v.siteId) ctx.require("sales.vo_stock", "view", v.siteId);
  else ctx.require("sales.vo_stock", "view");
  const { ageingThresholdsDays } = await salesSettings(ctx.tx, v.siteId);
  const days = v.stockInDate ? daysBetween(v.stockInDate, ctx.businessDate) : null;
  const purchase = v.voPurchases.find((p) => !p.cancelledOn)?.priceCents ?? v.stockValueCents;
  const rate = v.siteId ? await standardRateBp(ctx.tx, v.siteId, ctx.businessDate) : 2000;
  return {
    ...v,
    daysInStock: days,
    ageing: days === null ? null : ageingLevel(days, ageingThresholdsDays),
    purchasePriceCents: purchase,
    expectedMarginCents: v.listPriceCents && v.stockType === "VO" ? expectedVoMargin({ listPriceInclCents: v.listPriceCents, stockValueCents: v.stockValueCents, purchasePriceCents: purchase, vatRegime: v.vatRegime, rateBp: rate }) : null,
  };
}

export const POLICE_SORTS = ["number", "inDate", "outDate"] as const;

export async function listPoliceRegister(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("sales.vo_stock", "view");
  const and: Prisma.PoliceRegisterEntryWhereInput[] = [];
  if (p.filters.site) and.push({ siteId: p.filters.site });
  else if (ctx.actor.siteIds !== "ALL") and.push({ siteId: { in: ctx.actor.siteIds } });
  if (p.q) {
    and.push({
      OR: [
        { number: { contains: p.q, mode: "insensitive" } },
        { vin: { contains: p.q, mode: "insensitive" } },
        { registration: { contains: p.q, mode: "insensitive" } },
        { description: { contains: p.q, mode: "insensitive" } },
        { sellerName: { contains: p.q, mode: "insensitive" } },
        { buyerName: { contains: p.q, mode: "insensitive" } },
      ],
    });
  }
  if (p.filters.open === "1") and.push({ outDate: null });
  const where: Prisma.PoliceRegisterEntryWhereInput = and.length ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    ctx.tx.policeRegisterEntry.findMany({
      where,
      orderBy: orderBy(p, POLICE_SORTS, "number"),
      ...pageArgs(p, opts.all),
      include: { site: { select: { code: true } }, voPurchase: { select: { number: true, source: true } } },
    }),
    ctx.tx.policeRegisterEntry.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

/** OEM catalogue (models, versions, options) and add-on products. */
export async function getCatalogue(ctx: ServiceContext) {
  ctx.require("sales.catalogue", "view");
  const [models, addOns] = await Promise.all([
    ctx.tx.catalogueModel.findMany({
      include: { brand: true, versions: { include: { options: { orderBy: { code: "asc" } } }, orderBy: { listPriceExclVatCents: "asc" } } },
      orderBy: [{ brand: { name: "asc" } }, { name: "asc" }],
    }),
    ctx.tx.addOnProduct.findMany({ orderBy: { code: "asc" } }),
  ]);
  // Prices incl. VAT are shown at the standard rate of the active site (or the first site).
  const siteId = ctx.siteId ?? (await ctx.tx.site.findFirst({ orderBy: { code: "asc" }, select: { id: true } }))?.id;
  const rateBp = siteId ? await standardRateBp(ctx.tx, siteId, ctx.businessDate) : 0;
  return { models, addOns, rateBp };
}

/** Sales KPIs for the dashboard (month to date, on the business clock). */
export async function getSalesDashboard(ctx: ServiceContext) {
  ctx.require("sales.order", "view");
  const site = ctx.actor.siteIds === "ALL" ? {} : { siteId: { in: ctx.actor.siteIds } };
  const monthStart = new Date(Date.UTC(ctx.businessDate.getUTCFullYear(), ctx.businessDate.getUTCMonth(), 1));
  const [openLeads, sentQuotes, ordersMtd, deliveredMtd, backlog, pendingApprovals] = await Promise.all([
    ctx.tx.lead.count({ where: { ...site, stage: { in: ["NEW", "CONTACTED", "QUOTED"] } } }),
    ctx.tx.quote.count({ where: { ...site, status: "SENT" } }),
    ctx.tx.salesOrder.aggregate({ where: { ...site, orderDate: { gte: monthStart }, status: { not: "CANCELLED" } }, _count: true, _sum: { totalInclVatCents: true, frontEndMarginCents: true, backEndMarginCents: true } }),
    ctx.tx.salesOrder.count({ where: { ...site, deliveredOn: { gte: monthStart } } }),
    ctx.tx.salesOrder.count({ where: { ...site, status: { in: ["CONFIRMED", "INVOICED"] } } }),
    ctx.tx.quote.count({ where: { ...site, status: "PENDING_APPROVAL" } }),
  ]);
  return {
    openLeads,
    sentQuotes,
    ordersMtd: ordersMtd._count,
    ordersMtdCents: ordersMtd._sum.totalInclVatCents ?? 0,
    frontEndMtdCents: ordersMtd._sum.frontEndMarginCents ?? 0,
    backEndMtdCents: ordersMtd._sum.backEndMarginCents ?? 0,
    deliveredMtd,
    backlog,
    pendingApprovals,
  };
}

/** A new vehicle with its factory order, options, reservation and orders. */
export async function getVnVehicle(ctx: ServiceContext, id: string) {
  const v = await ctx.tx.vehicle.findUnique({
    where: { id },
    include: {
      site: true,
      brand: true,
      options: { orderBy: { code: "asc" } },
      factoryOrder: { include: { catalogueVersion: { include: { model: true } }, salesOrder: { select: { id: true, number: true } } } },
      reservations: { where: { status: "ACTIVE" }, include: { customer: { select: { id: true, displayName: true } } } },
      salesOrders: { orderBy: { createdAt: "desc" }, include: { customer: { select: { id: true, displayName: true } } } },
      statusHistory: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!v || v.stockType !== "VN") throw new NotFoundError("Vehicle", id);
  if (v.siteId) ctx.require("sales.vn_stock", "view", v.siteId);
  else ctx.require("sales.vn_stock", "view");
  const { ageingThresholdsDays } = await salesSettings(ctx.tx, v.siteId);
  const days = v.stockInDate && v.siteId ? daysBetween(v.stockInDate, ctx.businessDate) : null;
  return { ...v, daysInStock: days, ageing: days === null ? null : ageingLevel(days, ageingThresholdsDays) };
}

/** Versions a site can order for stock, with their options, and which brand each site sells. */
export async function getStockOrderFormData(ctx: ServiceContext) {
  ctx.require("sales.vn_stock", "create");
  const [models, siteBrands] = await Promise.all([
    ctx.tx.catalogueModel.findMany({
      where: { active: true },
      include: { brand: true, versions: { where: { active: true }, include: { options: { orderBy: { code: "asc" } } }, orderBy: { listPriceExclVatCents: "asc" } } },
      orderBy: [{ brand: { name: "asc" } }, { name: "asc" }],
    }),
    ctx.tx.siteBrand.findMany({ select: { siteId: true, brandId: true } }),
  ]);
  return {
    versions: models.flatMap((m) =>
      m.versions.map((v) => ({
        id: v.id,
        brandId: m.brandId,
        label: `${m.brand.name} ${m.name} ${v.name}`,
        listPriceExclVatCents: v.listPriceExclVatCents,
        dealerCostCents: v.dealerCostCents,
        leadTimeDays: v.leadTimeDays,
        options: v.options.map((o) => ({ id: o.id, label: o.label, kind: o.kind, listPriceExclVatCents: o.listPriceExclVatCents })),
      })),
    ),
    siteBrands,
  };
}

/** Choices for buying a used car and recording its costs: private sellers, suppliers, brands. */
export async function getVoFormData(ctx: ServiceContext) {
  ctx.require("sales.vo_stock", "view");
  const [individuals, suppliers, brands] = await Promise.all([
    ctx.tx.customer.findMany({ where: { kind: "INDIVIDUAL" }, select: { id: true, number: true, displayName: true, city: true }, orderBy: { displayName: "asc" } }),
    ctx.tx.supplier.findMany({ where: { isOem: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.tx.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    sellers: individuals.map((c) => ({ value: c.id, label: `${c.displayName}${c.city ? ` — ${c.city}` : ""} (${c.number})` })),
    suppliers: suppliers.map((s) => ({ value: s.id, label: s.name })),
    brands: brands.map((b) => ({ value: b.id, label: b.name })),
  };
}
