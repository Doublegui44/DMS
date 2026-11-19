import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { orderBy, pageArgs, type ListParams } from "@/lib/list";

export const CUSTOMER_SORTS = ["displayName", "number", "city", "createdAt", "kind"] as const;

function where(p: ListParams): Prisma.CustomerWhereInput {
  const w: Prisma.CustomerWhereInput = {};
  if (p.q) {
    w.OR = [
      { displayName: { contains: p.q, mode: "insensitive" } },
      { number: { contains: p.q, mode: "insensitive" } },
      { email: { contains: p.q, mode: "insensitive" } },
      { phone: { contains: p.q } },
      { city: { contains: p.q, mode: "insensitive" } },
      { siren: { contains: p.q } },
    ];
  }
  if (p.filters.kind) w.kind = p.filters.kind as Prisma.CustomerWhereInput["kind"];
  if (p.filters.priceClass) w.priceClass = p.filters.priceClass as Prisma.CustomerWhereInput["priceClass"];
  if (p.filters.site) w.homeSiteId = p.filters.site;
  return w;
}

/** Customers are shared across the group (one CRM), so no site restriction on reads. */
export async function listCustomers(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("customer", "view");
  const w = where(p);
  const [rows, total] = await Promise.all([
    ctx.tx.customer.findMany({
      where: w,
      orderBy: orderBy(p, CUSTOMER_SORTS, "displayName"),
      ...pageArgs(p, opts.all),
      include: { homeSite: { select: { code: true } }, _count: { select: { vehicles: true } } },
    }),
    ctx.tx.customer.count({ where: w }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getCustomer(ctx: ServiceContext, id: string) {
  ctx.require("customer", "view");
  const customer = await ctx.tx.customer.findUnique({
    where: { id },
    include: {
      homeSite: true,
      contacts: { orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }] },
      vehicles: { orderBy: { updatedAt: "desc" } },
    },
  });
  if (!customer) throw new NotFoundError("Customer", id);
  return customer;
}

export async function searchCustomers(ctx: ServiceContext, q: string, take = 10) {
  ctx.require("customer", "view");
  return ctx.tx.customer.findMany({
    where: q
      ? {
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { number: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    select: { id: true, displayName: true, number: true, city: true },
    orderBy: { displayName: "asc" },
    take,
  });
}
