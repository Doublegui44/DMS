import type { ServiceContext } from "@/lib/context";
import { InvalidTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { canTransition, initialStatuses, type StockType, type VehicleStatus } from "../domain/vehicle";
import { vehicleInputSchema, type VehicleInput } from "../schemas/vehicle";

declare module "@/lib/events" {
  interface DomainEventMap {
    VehicleCreated: { vehicleId: string; vin: string; stockType: StockType; status: VehicleStatus };
    VehicleStatusChanged: { vehicleId: string; from: VehicleStatus; to: VehicleStatus; reason: string | null };
  }
}

export async function createVehicle(ctx: ServiceContext, input: VehicleInput) {
  const data = parseInput(vehicleInputSchema, input);
  ctx.require("vehicle", "create", data.siteId ?? ctx.siteId);
  if (!initialStatuses(data.stockType).includes(data.status)) {
    throw new ValidationError(`A new ${data.stockType} vehicle cannot start in ${data.status}`, {
      status: ["Invalid initial status"],
    });
  }
  const inStock = data.stockType !== "NONE";
  // Ageing starts when the car is physically in stock: VO from intake, VN only once IN_STOCK.
  const physicallyInStock = data.stockType === "VO" || (data.stockType === "VN" && data.status === "IN_STOCK");
  const vehicle = await ctx.tx.vehicle.create({
    data: {
      ...data,
      listPriceCents: data.listPriceCents,
      stockValueCents: data.stockValueCents ?? 0,
      stockInDate: physicallyInStock ? data.stockInDate ?? ctx.businessDate : null,
      siteId: inStock ? data.siteId : data.siteId ?? null,
    },
  });
  await ctx.tx.vehicleStatusHistory.create({
    data: {
      vehicleId: vehicle.id,
      fromStatus: null,
      toStatus: vehicle.status,
      businessDate: ctx.businessDate,
      userId: ctx.actor.userId,
      reason: "Created",
    },
  });
  await ctx.audit({
    action: "vehicle.create",
    entityType: "Vehicle",
    entityId: vehicle.id,
    after: vehicle,
    siteId: vehicle.siteId,
  });
  await ctx.emit({
    type: "VehicleCreated",
    aggregateType: "Vehicle",
    aggregateId: vehicle.id,
    siteId: vehicle.siteId,
    payload: { vehicleId: vehicle.id, vin: vehicle.vin, stockType: vehicle.stockType, status: vehicle.status },
  });
  return vehicle;
}

/** Edit descriptive fields. Status, stock type and stock value change only through dedicated services. */
export async function updateVehicle(ctx: ServiceContext, id: string, input: VehicleInput) {
  const before = await ctx.tx.vehicle.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Vehicle", id);
  ctx.require("vehicle", "edit", before.siteId ?? ctx.siteId);
  const data = parseInput(vehicleInputSchema, { ...input, stockType: before.stockType, status: before.status });
  const after = await ctx.tx.vehicle.update({
    where: { id },
    data: {
      vin: data.vin,
      registration: data.registration,
      brandId: data.brandId,
      make: data.make,
      model: data.model,
      version: data.version,
      firstRegistration: data.firstRegistration,
      mileage: data.mileage,
      fuel: data.fuel,
      co2: data.co2,
      powerHp: data.powerHp,
      colour: data.colour,
      ownerCustomerId: data.ownerCustomerId,
      listPriceCents: data.listPriceCents,
      vatRegime: data.vatRegime,
      siteId: data.siteId,
    },
  });
  await ctx.audit({ action: "vehicle.update", entityType: "Vehicle", entityId: id, before, after, siteId: after.siteId });
  return after;
}

/**
 * Move a vehicle along its lifecycle. Used by the UI for manual moves (e.g. VN arrival)
 * and by sales/workshop services in later phases.
 */
export async function changeVehicleStatus(
  ctx: ServiceContext,
  id: string,
  to: VehicleStatus,
  reason: string | null = null,
) {
  const vehicle = await ctx.tx.vehicle.findUnique({ where: { id } });
  if (!vehicle) throw new NotFoundError("Vehicle", id);
  ctx.require("vehicle", "edit", vehicle.siteId ?? ctx.siteId);
  const from = vehicle.status as VehicleStatus;
  if (!canTransition(from, to, vehicle.stockType as StockType)) {
    throw new InvalidTransitionError("Vehicle", from, to);
  }
  const extra: { stockType?: StockType; stockInDate?: Date | null; stockValueCents?: number } = {};
  if (to === "CUSTOMER") Object.assign(extra, { stockType: "NONE", stockInDate: null, stockValueCents: 0 });
  if (from === "CUSTOMER" && to === "INTAKE") Object.assign(extra, { stockType: "VO", stockInDate: ctx.businessDate });
  if (vehicle.stockType === "VN" && to === "IN_STOCK" && !vehicle.stockInDate) extra.stockInDate = ctx.businessDate;

  const updated = await ctx.tx.vehicle.update({ where: { id }, data: { status: to, ...extra } });
  await ctx.tx.vehicleStatusHistory.create({
    data: { vehicleId: id, fromStatus: from, toStatus: to, businessDate: ctx.businessDate, userId: ctx.actor.userId, reason },
  });
  await ctx.audit({
    action: "vehicle.status",
    entityType: "Vehicle",
    entityId: id,
    before: { status: from },
    after: { status: to, reason },
    siteId: vehicle.siteId,
  });
  await ctx.emit({
    type: "VehicleStatusChanged",
    aggregateType: "Vehicle",
    aggregateId: id,
    siteId: vehicle.siteId,
    payload: { vehicleId: id, from, to, reason },
  });
  return updated;
}
