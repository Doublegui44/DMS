import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { orderBy, pageArgs, type ListParams } from "@/lib/list";

export const VEHICLE_SORTS = ["make", "model", "status", "stockInDate", "mileage", "listPriceCents", "stockValueCents", "createdAt"] as const;

/**
 * Stock vehicles are restricted to the actor's sites; customer vehicles (no site) are visible
 * to everyone who can view vehicles (workshop needs them across the group).
 */
function where(ctx: ServiceContext, p: ListParams): Prisma.VehicleWhereInput {
  const and: Prisma.VehicleWhereInput[] = [];
  if (ctx.actor.siteIds !== "ALL") {
    and.push({ OR: [{ siteId: { in: ctx.actor.siteIds } }, { siteId: null }] });
  }
  if (p.q) {
    and.push({
      OR: [
        { vin: { contains: p.q, mode: "insensitive" } },
        { registration: { contains: p.q, mode: "insensitive" } },
        { make: { contains: p.q, mode: "insensitive" } },
        { model: { contains: p.q, mode: "insensitive" } },
        { version: { contains: p.q, mode: "insensitive" } },
        { owner: { displayName: { contains: p.q, mode: "insensitive" } } },
      ],
    });
  }
  const f = p.filters;
  if (f.stockType) and.push({ stockType: f.stockType as Prisma.VehicleWhereInput["stockType"] });
  if (f.status) and.push({ status: f.status as Prisma.VehicleWhereInput["status"] });
  if (f.site) and.push({ siteId: f.site });
  if (f.fuel) and.push({ fuel: f.fuel as Prisma.VehicleWhereInput["fuel"] });
  if (f.brand) and.push({ brandId: f.brand });
  return and.length ? { AND: and } : {};
}

export async function listVehicles(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("vehicle", "view");
  const w = where(ctx, p);
  const [rows, total] = await Promise.all([
    ctx.tx.vehicle.findMany({
      where: w,
      orderBy: orderBy(p, VEHICLE_SORTS, "createdAt"),
      ...pageArgs(p, opts.all),
      include: { site: { select: { code: true } }, owner: { select: { id: true, displayName: true } } },
    }),
    ctx.tx.vehicle.count({ where: w }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getVehicle(ctx: ServiceContext, id: string) {
  ctx.require("vehicle", "view");
  const vehicle = await ctx.tx.vehicle.findUnique({
    where: { id },
    include: {
      site: true,
      brand: true,
      owner: true,
      options: true,
      statusHistory: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!vehicle) throw new NotFoundError("Vehicle", id);
  if (vehicle.siteId && ctx.actor.siteIds !== "ALL" && !ctx.actor.siteIds.includes(vehicle.siteId)) {
    throw new NotFoundError("Vehicle", id);
  }
  return vehicle;
}
