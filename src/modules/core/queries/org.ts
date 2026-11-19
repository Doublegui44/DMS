import type { ServiceContext } from "@/lib/context";

/** Sites the actor can access, ordered by name. */
export async function listAccessibleSites(ctx: ServiceContext) {
  return ctx.tx.site.findMany({
    where: ctx.actor.siteIds === "ALL" ? {} : { id: { in: ctx.actor.siteIds } },
    orderBy: { name: "asc" },
    include: { brands: { include: { brand: true } } },
  });
}

export async function listBrands(ctx: ServiceContext) {
  return ctx.tx.brand.findMany({ orderBy: { name: "asc" } });
}

export async function listAllSites(ctx: ServiceContext) {
  return ctx.tx.site.findMany({ orderBy: { name: "asc" }, include: { brands: { include: { brand: true } }, departments: true } });
}
