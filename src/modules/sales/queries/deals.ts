import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { orderBy, pageArgs, type ListParams } from "@/lib/list";
import { salesSettings, discountRules } from "../services/shared";

export async function getQuote(ctx: ServiceContext, id: string) {
  const quote = await ctx.tx.quote.findUnique({
    where: { id },
    include: {
      lead: true,
      customer: true,
      site: true,
      salesperson: { select: { id: true, firstName: true, lastName: true } },
      vehicle: true,
      catalogueVersion: { include: { model: { include: { brand: true } } } },
      lines: { orderBy: { lineNo: "asc" } },
      tradeIn: { include: { vehicle: { select: { id: true, status: true } } } },
      financing: true,
      salesOrder: { select: { id: true, number: true, status: true } },
      reservations: { where: { status: "ACTIVE" } },
    },
  });
  if (!quote) throw new NotFoundError("Quote", id);
  ctx.require("sales.quote", "view", quote.siteId);
  const approvals = await ctx.tx.approvalRequest.findMany({
    where: { entityType: "Quote", entityId: id },
    include: {
      rule: { include: { approverRole: true } },
      requestedBy: { select: { firstName: true, lastName: true } },
      decidedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return { ...quote, approvals };
}

/** Everything the quote builder needs for a lead: stock, catalogue, add-ons, lenders, the customer's cars. */
export async function getQuoteFormData(ctx: ServiceContext, leadId: string) {
  const lead = await ctx.tx.lead.findUnique({ where: { id: leadId }, include: { customer: true, site: { include: { brands: { include: { brand: true } } } } } });
  if (!lead) throw new NotFoundError("Lead", leadId);
  ctx.require("sales.quote", "view", lead.siteId);
  const brandIds = lead.site.brands.map((b) => b.brandId);
  const [stock, models, addOns, ownCars, settings, rules] = await Promise.all([
    ctx.tx.vehicle.findMany({
      where: { siteId: lead.siteId, stockType: { in: ["VN", "VO"] }, status: { in: ["ORDERED", "IN_TRANSIT", "IN_STOCK", "RECONDITIONING", "FOR_SALE", "RESERVED"] }, listPriceCents: { not: null } },
      include: {
        reservations: { where: { status: "ACTIVE" }, include: { customer: { select: { displayName: true } } } },
        salesOrders: { where: { status: { in: ["CONFIRMED", "INVOICED"] } }, select: { number: true } },
        factoryOrder: { select: { catalogueVersion: { select: { oemIncentiveCents: true } } } },
      },
      orderBy: [{ stockType: "asc" }, { make: "asc" }, { model: "asc" }],
    }),
    ctx.tx.catalogueModel.findMany({
      where: { brandId: { in: brandIds }, active: true },
      include: { brand: true, versions: { where: { active: true }, include: { options: { orderBy: { code: "asc" } } }, orderBy: { listPriceExclVatCents: "asc" } } },
      orderBy: [{ brand: { name: "asc" } }, { name: "asc" }],
    }),
    ctx.tx.addOnProduct.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    ctx.tx.vehicle.findMany({ where: { ownerCustomerId: lead.customerId, status: "CUSTOMER" }, orderBy: { createdAt: "asc" } }),
    salesSettings(ctx.tx, lead.siteId),
    discountRules(ctx.tx),
  ]);
  // OEM incentive of a new stock vehicle: its factory order's version, else the catalogue entry of the same names.
  const incentiveOf = (v: (typeof stock)[number]) => {
    if (v.stockType !== "VN") return 0;
    if (v.factoryOrder) return v.factoryOrder.catalogueVersion.oemIncentiveCents;
    const model = models.find((m) => m.brandId === v.brandId && m.name === v.model);
    return model?.versions.find((x) => x.name === v.version)?.oemIncentiveCents ?? 0;
  };
  return {
    lead,
    stock: stock
      .filter((v) => v.salesOrders.length === 0)
      .map((v) => ({
        id: v.id,
        stockType: v.stockType as "VN" | "VO",
        label: `${v.make} ${v.model} ${v.version}`,
        vin: v.vin,
        registration: v.registration,
        status: v.status,
        colour: v.colour,
        mileage: v.mileage,
        listPriceCents: v.listPriceCents ?? 0,
        vatRegime: v.vatRegime,
        oemIncentiveCents: incentiveOf(v),
        reservedFor: v.reservations[0]?.customerId === lead.customerId ? null : v.reservations[0]?.customer.displayName ?? null,
      })),
    catalogue: models.map((m) => ({
      id: m.id,
      label: `${m.brand.name} ${m.name}`,
      versions: m.versions.map((v) => ({
        id: v.id,
        name: v.name,
        fuel: v.fuel,
        co2: v.co2,
        powerHp: v.powerHp,
        listPriceExclVatCents: v.listPriceExclVatCents,
        oemIncentiveCents: v.oemIncentiveCents,
        leadTimeDays: v.leadTimeDays,
        options: v.options.map((o) => ({ id: o.id, code: o.code, label: o.label, kind: o.kind, listPriceExclVatCents: o.listPriceExclVatCents })),
      })),
    })),
    addOns: addOns.map((a) => ({ id: a.id, name: a.name, kind: a.kind, months: a.months, priceExclVatCents: a.priceExclVatCents })),
    ownCars: ownCars.map((v) => ({
      id: v.id,
      vin: v.vin,
      registration: v.registration,
      make: v.make,
      model: v.model,
      version: v.version,
      firstRegistration: v.firstRegistration,
      mileage: v.mileage,
      fuel: v.fuel,
    })),
    financing: settings.financing,
    approvalThresholds: rules.map((r) => ({ thresholdBp: r.thresholdBp, role: r.roleName })).sort((a, b) => a.thresholdBp - b.thresholdBp),
  };
}

export const ORDER_SORTS = ["number", "orderDate", "status", "totalInclVatCents", "expectedDeliveryDate"] as const;

function orderWhere(ctx: ServiceContext, p: ListParams): Prisma.SalesOrderWhereInput {
  const and: Prisma.SalesOrderWhereInput[] = [];
  if (p.filters.site) and.push({ siteId: p.filters.site });
  else if (ctx.actor.siteIds !== "ALL") and.push({ siteId: { in: ctx.actor.siteIds } });
  if (p.q) {
    and.push({
      OR: [
        { number: { contains: p.q, mode: "insensitive" } },
        { customer: { displayName: { contains: p.q, mode: "insensitive" } } },
        { vehicle: { vin: { contains: p.q, mode: "insensitive" } } },
        { vehicle: { model: { contains: p.q, mode: "insensitive" } } },
      ],
    });
  }
  if (p.filters.status) and.push({ status: p.filters.status as Prisma.SalesOrderWhereInput["status"] });
  if (p.filters.stockType) and.push({ stockType: p.filters.stockType as Prisma.SalesOrderWhereInput["stockType"] });
  return and.length ? { AND: and } : {};
}

export async function listOrders(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("sales.order", "view");
  const where = orderWhere(ctx, p);
  const [rows, total] = await Promise.all([
    ctx.tx.salesOrder.findMany({
      where,
      orderBy: orderBy(p, ORDER_SORTS, "orderDate"),
      ...pageArgs(p, opts.all),
      include: {
        customer: { select: { id: true, displayName: true } },
        vehicle: { select: { id: true, make: true, model: true, version: true, vin: true } },
        salesperson: { select: { firstName: true, lastName: true } },
        site: { select: { code: true } },
        invoice: { select: { id: true, number: true, paidCents: true, totalInclVatCents: true } },
      },
    }),
    ctx.tx.salesOrder.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getOrder(ctx: ServiceContext, id: string) {
  const order = await ctx.tx.salesOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      site: true,
      lead: true,
      salesperson: { select: { id: true, firstName: true, lastName: true } },
      vehicle: { include: { factoryOrder: true, options: true } },
      quote: { include: { lines: { orderBy: { lineNo: "asc" } }, financing: true, tradeIn: true } },
      invoice: true,
      factoryOrder: true,
      voPurchases: { include: { vehicle: { select: { id: true, make: true, model: true, version: true, status: true, vin: true } } } },
      commission: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!order) throw new NotFoundError("SalesOrder", id);
  ctx.require("sales.order", "view", order.siteId);
  const payments = await ctx.tx.payment.findMany({ where: { sourceType: "SALES_ORDER", sourceId: order.id }, orderBy: { createdAt: "asc" } });
  const related = await ctx.tx.invoice.findMany({ where: { sourceType: "OEM_INCENTIVE", sourceId: order.id }, select: { id: true, number: true, totalInclVatCents: true } });
  return { ...order, payments, incentiveInvoices: related };
}
