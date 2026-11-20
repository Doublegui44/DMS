/** Counter sales reads. */
import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { pageArgs, type ListParams } from "@/lib/list";
import { partsMargin, PRICE_CLASSES } from "../domain/pricing";
import { availableQty } from "../domain/purchasing";
import { dec, Decimal } from "../domain/valuation";
import { dateRange, siteWhere } from "./scope";

export const COUNTER_SORTS = ["number", "createdOn", "totalExclVatCents", "status"] as const;

export async function listCounterSales(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("parts.counter_sale", "view");
  const w: Prisma.CounterSaleWhereInput = { ...(siteWhere(ctx, p) as Prisma.CounterSaleWhereInput) };
  if (p.filters.status) w.status = p.filters.status as Prisma.CounterSaleWhereInput["status"];
  if (p.filters.customer) w.customerId = p.filters.customer;
  if (p.filters.priceClass) w.priceClass = p.filters.priceClass as Prisma.CounterSaleWhereInput["priceClass"];
  if (p.q) w.OR = [{ number: { contains: p.q, mode: "insensitive" } }, { customer: { displayName: { contains: p.q, mode: "insensitive" } } }, { reference: { contains: p.q, mode: "insensitive" } }];
  const range = dateRange(p);
  if (range) w.createdOn = range;
  const sort = (COUNTER_SORTS as readonly string[]).includes(p.sort ?? "") ? p.sort! : "createdOn";
  const [rows, total] = await Promise.all([
    ctx.tx.counterSale.findMany({
      where: w,
      orderBy: [{ [sort]: p.dir }, { number: "desc" }],
      ...pageArgs(p, opts.all),
      include: {
        customer: { select: { id: true, displayName: true } },
        site: { select: { code: true } },
        invoice: { select: { id: true, number: true, status: true } },
        _count: { select: { lines: true } },
      },
    }),
    ctx.tx.counterSale.count({ where: w }),
  ]);
  return {
    rows: rows.map((s) => ({ ...s, margin: s.status === "INVOICED" ? partsMargin(s.totalExclVatCents, s.costCents) : null })),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}

export async function getCounterSale(ctx: ServiceContext, id: string) {
  const sale = await ctx.tx.counterSale.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, number: true, displayName: true, kind: true, priceClass: true, paymentTermsDays: true } },
      site: { select: { id: true, code: true, name: true } },
      invoice: { select: { id: true, number: true, status: true, totalInclVatCents: true, vatCents: true, paidCents: true, journalEntryId: true } },
      lines: { orderBy: { lineNo: "asc" }, include: { part: { select: { id: true, partNumber: true, description: true, unit: true, vatRateCode: true } } } },
    },
  });
  if (!sale) throw new NotFoundError("CounterSale", id);
  ctx.require("parts.counter_sale", "view", sale.siteId);
  const items = await ctx.tx.stockItem.findMany({
    where: { siteId: sale.siteId, partId: { in: sale.lines.map((l) => l.partId) } },
    select: { id: true, partId: true, bin: true, qtyOnHand: true, qtyReserved: true },
  });
  const byPart = new Map(items.map((i) => [i.partId, i]));
  const entries = await ctx.tx.journalEntry.findMany({ where: { sourceType: "COUNTER_SALE", sourceId: id }, select: { id: true, number: true } });
  return {
    sale,
    lines: sale.lines.map((l) => {
      const item = byPart.get(l.partId);
      const available = item ? availableQty({ onHand: item.qtyOnHand, reserved: item.qtyReserved }) : new Decimal(0);
      // A confirmed sale holds its own units: they count as available to it.
      const forThisSale = sale.status === "CONFIRMED" ? available.plus(dec(l.qty)) : available;
      return { ...l, stockItemId: item?.id ?? null, bin: item?.bin ?? null, available, short: sale.status === "QUOTE" || sale.status === "CONFIRMED" ? dec(l.qty).gt(forThisSale) : false };
    }),
    margin: sale.status === "INVOICED" ? partsMargin(sale.totalExclVatCents, sale.costCents) : null,
    entries,
    canEdit: ctx.can("parts.counter_sale", "edit", sale.siteId),
    canTakePayment: ctx.can("accounting.payment", "create", sale.siteId),
  };
}

export async function getCounterFormData(ctx: ServiceContext) {
  ctx.require("parts.counter_sale", "create");
  const [customers, sites] = await Promise.all([
    ctx.tx.customer.findMany({
      where: { kind: { in: ["INDIVIDUAL", "COMPANY"] } },
      select: { id: true, number: true, displayName: true, city: true, priceClass: true },
      orderBy: { displayName: "asc" },
    }),
    ctx.tx.site.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  return {
    customers: customers.map((c) => ({ value: c.id, label: `${c.displayName}${c.city ? ` — ${c.city}` : ""} (${c.number})${c.priceClass !== "RETAIL" ? ` · ${c.priceClass}` : ""}` })),
    sites: sites.filter((s) => ctx.can("parts.counter_sale", "create", s.id)).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
    priceClasses: PRICE_CLASSES,
  };
}
