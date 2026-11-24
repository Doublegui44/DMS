import type { ServiceContext } from "@/lib/context";
import { addDays } from "@/lib/dates";
import { sumCents } from "@/lib/money";
import { oemOrderState } from "../domain/oem-portal";

/** Days delivered and cancelled orders stay on the portal. */
const HISTORY_DAYS = 30;

/**
 * The factory orders of the user's sites as the manufacturer's portal shows them (mock, D-084):
 * plant stage, build date, promised date, and the invoice the OEM will raise (the expected cost
 * booked when ordering) for the orders not yet delivered.
 */
export async function getOemPortal(ctx: ServiceContext, filters: { brandId?: string }) {
  ctx.require("sales.vn_stock", "view");
  const since = addDays(ctx.businessDate, -HISTORY_DAYS);
  const sites = ctx.actor.siteIds === "ALL" ? {} : { siteId: { in: ctx.actor.siteIds } };
  const orders = await ctx.tx.factoryOrder.findMany({
    where: {
      ...sites,
      ...(filters.brandId ? { catalogueVersion: { model: { brandId: filters.brandId } } } : {}),
      OR: [{ status: { in: ["ORDERED", "IN_TRANSIT"] } }, { arrivedOn: { gte: since } }, { status: "CANCELLED", expectedOn: { gte: since } }],
    },
    include: {
      site: { select: { code: true } },
      catalogueVersion: { include: { model: { include: { brand: { select: { id: true, name: true } } } } } },
      vehicle: { select: { id: true, vin: true, colour: true, stockValueCents: true } },
      salesOrder: { select: { number: true, customer: { select: { displayName: true } } } },
    },
    orderBy: [{ expectedOn: "asc" }, { number: "asc" }],
  });
  const brands = await ctx.tx.brand.findMany({ where: { oemSupplierId: { not: null } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const rows = orders.map((fo) => ({
    id: fo.id,
    number: fo.number,
    oemReference: fo.oemReference,
    site: fo.site.code,
    brand: fo.catalogueVersion.model.brand.name,
    vehicle: `${fo.catalogueVersion.model.name} ${fo.catalogueVersion.name}`,
    vehicleId: fo.vehicle.id,
    vin: fo.vehicle.vin,
    colour: fo.vehicle.colour,
    customer: fo.salesOrder?.customer.displayName ?? null,
    salesOrder: fo.salesOrder?.number ?? null,
    status: fo.status,
    orderedOn: fo.orderedOn,
    expectedOn: fo.expectedOn,
    shippedOn: fo.shippedOn,
    // The expected cost the dealer set when ordering: version and options at dealer cost.
    invoiceCents: fo.vehicle.stockValueCents,
    ...oemOrderState(fo, ctx.businessDate),
  }));
  const open = rows.filter((r) => r.stage !== "DELIVERED" && r.stage !== "CANCELLED");
  return {
    brands,
    rows,
    totals: {
      open: open.length,
      readyToShip: open.filter((r) => r.readyToShip).length,
      inTransit: open.filter((r) => r.stage === "SHIPPED").length,
      late: open.filter((r) => r.late).length,
      toInvoiceCents: sumCents(open.map((r) => r.invoiceCents)),
    },
  };
}
