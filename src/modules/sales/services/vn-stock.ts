/** New-vehicle stock: factory orders for stock, shipping, arrival (purchase + stock entry). */
import type { ServiceContext } from "@/lib/context";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { applyRate, inclFromExcl, sumCents } from "@/lib/money";
import { parseInput } from "@/lib/validation";
import { buildPurchaseEntry, postEntry } from "@/modules/accounting";
import { changeVehicleStatus, moveVehicleStock, nextDocumentNumber, patchVehicle } from "@/modules/core";
import { addDays } from "@/lib/dates";
import { factoryDelayInputSchema, receiveVehicleSchema, stockOrderInputSchema, type FactoryDelayInput, type ReceiveVehicleInput, type StockOrderInput } from "../schemas/sales";
import { oemReference, placeFactoryOrder } from "./orders";
import { catalogueVersionFor, standardRateBp, vehicleLabel } from "./shared";

declare module "@/lib/events" {
  interface DomainEventMap {
    VehicleReceived: { vehicleId: string; costCents: number; factoryOrderId: string | null };
  }
}

/** Order a new vehicle from the manufacturer for stock (no customer yet). */
export async function orderForStock(ctx: ServiceContext, input: StockOrderInput) {
  const data = parseInput(stockOrderInputSchema, input);
  ctx.require("sales.vn_stock", "create", data.siteId);
  const version = await ctx.tx.catalogueVersion.findUnique({ where: { id: data.catalogueVersionId }, include: { model: true, options: true } });
  if (!version || !version.active) throw new ValidationError("This version is not available to order", { catalogueVersionId: ["Not available"] });
  const sells = await ctx.tx.siteBrand.findUnique({ where: { siteId_brandId: { siteId: data.siteId, brandId: version.model.brandId } } });
  if (!sells) throw new ValidationError("This site does not sell this brand", { catalogueVersionId: ["Brand not sold here"] });
  const options = version.options.filter((o) => data.optionIds.includes(o.id));
  const rate = await standardRateBp(ctx.tx, data.siteId, ctx.businessDate);
  const placed = await placeFactoryOrder(ctx, {
    siteId: data.siteId,
    versionId: version.id,
    optionIds: options.map((o) => o.id),
    colour: data.colour ?? null,
    listPriceInclVatCents: inclFromExcl(version.listPriceExclVatCents + sumCents(options.map((o) => o.listPriceExclVatCents)), rate),
    salesOrderId: null,
    seed: "STOCK",
  });
  return placed.factoryOrder;
}

/** The manufacturer ships the vehicle. */
export async function shipFactoryOrder(ctx: ServiceContext, factoryOrderId: string) {
  const fo = await ctx.tx.factoryOrder.findUnique({ where: { id: factoryOrderId }, include: { vehicle: true } });
  if (!fo) throw new NotFoundError("FactoryOrder", factoryOrderId);
  ctx.require("sales.vn_stock", "edit", fo.siteId);
  if (fo.status !== "ORDERED") throw new ConflictError(`Factory order ${fo.number} is ${fo.status.toLowerCase().replace("_", " ")}`);
  const updated = await ctx.tx.factoryOrder.update({ where: { id: fo.id }, data: { status: "IN_TRANSIT", shippedOn: ctx.businessDate } });
  // A vehicle sold to a customer stays RESERVED; a stock vehicle shows as in transit.
  if (fo.vehicle.status === "ORDERED") await changeVehicleStatus(ctx, fo.vehicleId, "IN_TRANSIT", `Shipped — ${fo.number}`, { trusted: true });
  await ctx.audit({ action: "factory_order.ship", entityType: "Vehicle", entityId: fo.vehicleId, siteId: fo.siteId, after: { number: fo.number } });
  return updated;
}

/**
 * The manufacturer pushes a factory order back (OEM portal mock, D-084): the promised date moves,
 * and so does the delivery date promised to the customer when the car is already sold.
 */
export async function delayFactoryOrder(ctx: ServiceContext, factoryOrderId: string, input: FactoryDelayInput) {
  const data = parseInput(factoryDelayInputSchema, input);
  const fo = await ctx.tx.factoryOrder.findUnique({ where: { id: factoryOrderId }, include: { salesOrder: { select: { id: true, expectedDeliveryDate: true } } } });
  if (!fo) throw new NotFoundError("FactoryOrder", factoryOrderId);
  ctx.require("sales.vn_stock", "edit", fo.siteId);
  if (fo.status !== "ORDERED" && fo.status !== "IN_TRANSIT") throw new ConflictError(`Factory order ${fo.number} is ${fo.status.toLowerCase().replace("_", " ")}`);
  const expectedOn = addDays(fo.expectedOn, data.days);
  const updated = await ctx.tx.factoryOrder.update({ where: { id: fo.id }, data: { expectedOn } });
  if (fo.salesOrder?.expectedDeliveryDate) {
    await ctx.tx.salesOrder.update({ where: { id: fo.salesOrder.id }, data: { expectedDeliveryDate: addDays(fo.salesOrder.expectedDeliveryDate, data.days) } });
  }
  await ctx.audit({ action: "factory_order.delay", entityType: "Vehicle", entityId: fo.vehicleId, siteId: fo.siteId, before: { expectedOn: fo.expectedOn }, after: { expectedOn, days: data.days, reason: data.reason } });
  return updated;
}

/** The manufacturer's invoice (Dr 607100 + VAT / Cr 401100) and the stock entry at cost (Dr 371000 / Cr 603710). */
async function bookArrival(
  ctx: ServiceContext,
  v: { id: string; siteId: string; brandId: string | null; vin: string; make: string; model: string; version: string; brand: { oemSupplierId: string | null } | null },
  costCents: number,
) {
  const oemSupplierId = v.brand?.oemSupplierId;
  if (!oemSupplierId) throw new DomainError("oem_account_missing", `${v.make} has no manufacturer supplier account`);
  const rate = await standardRateBp(ctx.tx, v.siteId, ctx.businessDate);
  const label = `Arrival ${vehicleLabel(v)} — VIN ${v.vin}`;
  await postEntry(
    ctx,
    buildPurchaseEntry({
      siteId: v.siteId,
      date: ctx.businessDate,
      label,
      sourceType: "VEHICLE_RECEIPT",
      sourceId: v.id,
      lines: [{ account: { key: "PURCHASE_VN" }, amountCents: costCents, departmentCode: "VN" }],
      vatCents: applyRate(costCents, rate),
      credit: { account: { key: "PAYABLE_OEM" }, partyType: "SUPPLIER", partyId: oemSupplierId },
    }),
    { brandId: v.brandId },
  );
  await moveVehicleStock(ctx, { vehicleId: v.id, movement: "IN", amountCents: costCents, label, sourceType: "VEHICLE_RECEIPT", sourceId: v.id });
}

/**
 * A new vehicle arrives: the manufacturer's invoice is booked (Dr 607100 + VAT / Cr 401100) and the
 * car enters the stock ledger at its cost (Dr 371000 / Cr 603710). Ageing starts today.
 */
export async function receiveVehicle(ctx: ServiceContext, vehicleId: string, input: ReceiveVehicleInput = {}) {
  const data = parseInput(receiveVehicleSchema, input);
  const v = await ctx.tx.vehicle.findUnique({ where: { id: vehicleId }, include: { brand: true, factoryOrder: true } });
  if (!v) throw new NotFoundError("Vehicle", vehicleId);
  if (!v.siteId || v.stockType !== "VN") throw new ValidationError("Only new vehicles on order can be received");
  ctx.require("sales.vn_stock", "edit", v.siteId);
  if (v.stockInDate || !["ORDERED", "IN_TRANSIT", "RESERVED"].includes(v.status)) throw new ConflictError("This vehicle has already arrived");
  const costCents = data.costCents ?? v.stockValueCents;
  if (costCents <= 0) throw new ValidationError("Enter the manufacturer's invoice amount", { costCents: ["Required"] });
  if (v.status === "RESERVED") {
    await patchVehicle(ctx, v.id, { stockInDate: ctx.businessDate }, { trusted: true });
  } else {
    await changeVehicleStatus(ctx, v.id, "IN_STOCK", "Arrived from the manufacturer", { trusted: true });
  }
  await bookArrival(ctx, { ...v, siteId: v.siteId }, costCents);
  if (v.factoryOrder) {
    await ctx.tx.factoryOrder.update({
      where: { id: v.factoryOrder.id },
      data: { status: "ARRIVED", arrivedOn: ctx.businessDate, shippedOn: v.factoryOrder.shippedOn ?? ctx.businessDate },
    });
  }
  await ctx.audit({ action: "vehicle.receive", entityType: "Vehicle", entityId: v.id, siteId: v.siteId, after: { costCents } });
  await ctx.emit({ type: "VehicleReceived", aggregateType: "Vehicle", aggregateId: v.id, siteId: v.siteId, payload: { vehicleId: v.id, costCents, factoryOrderId: v.factoryOrder?.id ?? null } });
  return ctx.tx.vehicle.findUniqueOrThrow({ where: { id: v.id } });
}

/**
 * Seed only: the factory order of a new vehicle already on order when the history starts, dated
 * today (the business date). Nothing is posted: the purchase is booked at arrival.
 */
export async function registerOpeningFactoryOrder(ctx: ServiceContext, vehicleId: string, args: { expectedOn: Date; shippedOn?: Date | null }) {
  const v = await ctx.tx.vehicle.findUnique({ where: { id: vehicleId }, include: { brand: true, factoryOrder: true } });
  if (!v || v.stockType !== "VN" || !v.siteId || !v.brand) throw new ValidationError("Not a new vehicle of a site");
  if (v.status !== "ORDERED" && v.status !== "IN_TRANSIT") throw new ConflictError("This vehicle is not on order");
  if ((v.status === "IN_TRANSIT") !== !!args.shippedOn) throw new ValidationError("A vehicle in transit needs a shipping date (and only then)");
  if (v.factoryOrder) throw new ConflictError("Already registered");
  const version = await catalogueVersionFor(ctx.tx, v);
  if (!version) throw new ValidationError(`${vehicleLabel(v)} is not in the catalogue`);
  const site = await ctx.tx.site.findUniqueOrThrow({ where: { id: v.siteId } });
  const number = await nextDocumentNumber(ctx, { docType: "FACTORY_ORDER", scope: site.id, sitePrefix: site.code });
  const fo = await ctx.tx.factoryOrder.create({
    data: {
      number,
      siteId: site.id,
      catalogueVersionId: version.id,
      vehicleId: v.id,
      salesOrderId: null,
      oemReference: oemReference(v.brand.code, number),
      status: args.shippedOn ? "IN_TRANSIT" : "ORDERED",
      orderedOn: ctx.businessDate,
      expectedOn: args.expectedOn,
      shippedOn: args.shippedOn ?? null,
    },
  });
  await ctx.audit({ action: "factory_order.register", entityType: "Vehicle", entityId: v.id, siteId: site.id, after: fo });
  return fo;
}

/**
 * Seed only: a new vehicle of the seed's stock that arrived after the books were opened. On its
 * stock-in date (the business date) it gets its factory order, already shipped and arrived, and its
 * arrival is booked like any other, at its stock value.
 */
export async function registerPastArrival(ctx: ServiceContext, vehicleId: string, args: { orderedOn: Date; shippedOn: Date }) {
  const v = await ctx.tx.vehicle.findUnique({ where: { id: vehicleId }, include: { brand: true, factoryOrder: true } });
  if (!v || v.stockType !== "VN" || !v.siteId || !v.brand) throw new ValidationError("Not a new vehicle of a site");
  if (v.status !== "IN_STOCK" || v.stockInDate?.getTime() !== ctx.businessDate.getTime()) throw new ConflictError("This vehicle did not arrive on that day");
  if (v.factoryOrder) throw new ConflictError("Already registered");
  const version = await catalogueVersionFor(ctx.tx, v);
  if (!version) throw new ValidationError(`${vehicleLabel(v)} is not in the catalogue`);
  const site = await ctx.tx.site.findUniqueOrThrow({ where: { id: v.siteId } });
  const number = await nextDocumentNumber(ctx, { docType: "FACTORY_ORDER", scope: site.id, sitePrefix: site.code });
  const fo = await ctx.tx.factoryOrder.create({
    data: {
      number,
      siteId: site.id,
      catalogueVersionId: version.id,
      vehicleId: v.id,
      salesOrderId: null,
      oemReference: oemReference(v.brand.code, number),
      status: "ARRIVED",
      orderedOn: args.orderedOn,
      expectedOn: ctx.businessDate,
      shippedOn: args.shippedOn,
      arrivedOn: ctx.businessDate,
    },
  });
  await bookArrival(ctx, { ...v, siteId: v.siteId }, v.stockValueCents);
  await ctx.audit({ action: "factory_order.register", entityType: "Vehicle", entityId: v.id, siteId: site.id, after: fo });
  await ctx.emit({ type: "VehicleReceived", aggregateType: "Vehicle", aggregateId: v.id, siteId: v.siteId, payload: { vehicleId: v.id, costCents: v.stockValueCents, factoryOrderId: fo.id } });
  return fo;
}
