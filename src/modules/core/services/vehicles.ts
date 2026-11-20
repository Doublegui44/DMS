import type { ServiceContext } from "@/lib/context";
import { ConflictError, InvalidTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { canTransition, initialStatuses, type StockType, type VehicleStatus } from "../domain/vehicle";
import { vehicleInputSchema, type VehicleInput } from "../schemas/vehicle";

declare module "@/lib/events" {
  interface DomainEventMap {
    VehicleCreated: { vehicleId: string; vin: string; stockType: StockType; status: VehicleStatus };
    VehicleStatusChanged: { vehicleId: string; from: VehicleStatus; to: VehicleStatus; reason: string | null };
    /**
     * A movement of the vehicle stock sub-ledger. Accounting posts the matching 37x / 603x entry
     * (perpetual inventory, D-005), so the GL stock accounts always equal the sub-ledger.
     */
    VehicleStockMoved: {
      vehicleId: string;
      siteId: string;
      brandId: string | null;
      stockType: "VN" | "VO";
      movement: StockMovement;
      amountCents: number;
      label: string;
      sourceType: string;
      sourceId: string | null;
    };
  }
}

/** IN: enters stock at `amountCents` · COST: capitalised cost added · OUT: leaves stock (cost of sale or return). */
export type StockMovement = "IN" | "COST" | "OUT";

/** `trusted`: the calling module already checked its own permission (e.g. sales confirming an order). */
export interface VehicleCommandOptions {
  trusted?: boolean;
}

/**
 * A stock car's status, stock dates, site and prices move only with its business flow (sales today,
 * the workshop later), in the command that books the matching effects: factory order, reservation,
 * stock entry, invoice. Done by hand, they would skip them and the books would drift (D-048).
 */
function requireFlow(opts: VehicleCommandOptions, what: string) {
  if (!opts.trusted) throw new ConflictError(`A vehicle's ${what} changes only through its sales flow`, { what });
}

export async function createVehicle(ctx: ServiceContext, input: VehicleInput, opts: VehicleCommandOptions = {}) {
  const data = parseInput(vehicleInputSchema, input);
  if (!opts.trusted) ctx.require("vehicle", "create", data.siteId ?? ctx.siteId);
  if (!opts.trusted && data.stockType !== "NONE") {
    // The sales flows create stock cars with their purchase: factory order, VO purchase, trade-in.
    throw new ValidationError("Stock vehicles enter through sales", {
      stockType: ["New cars enter stock through a factory order, used cars through a purchase or a trade-in"],
    });
  }
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
      stockValueCents: inStock ? (data.stockValueCents ?? 0) : 0,
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

/**
 * Edit descriptive fields. Status, stock type and stock value change only through dedicated services.
 * A stock car also keeps its site, brand, owner, price and VAT regime: the books, the OEM account and
 * the discount approvals depend on them, and sales changes them (D-048).
 */
export async function updateVehicle(ctx: ServiceContext, id: string, input: VehicleInput) {
  const before = await ctx.tx.vehicle.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Vehicle", id);
  ctx.require("vehicle", "edit", before.siteId ?? ctx.siteId);
  const kept =
    before.stockType === "NONE"
      ? {}
      : {
          siteId: before.siteId,
          brandId: before.brandId,
          ownerCustomerId: before.ownerCustomerId,
          listPriceCents: before.listPriceCents,
          vatRegime: before.vatRegime,
        };
  const data = parseInput(vehicleInputSchema, { ...input, stockType: before.stockType, status: before.status, ...kept });
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
 * Move a vehicle along its lifecycle. Only the business flows call this (`trusted`), each in the
 * command that books the matching effects; there is no manual status change (D-048).
 */
export async function changeVehicleStatus(
  ctx: ServiceContext,
  id: string,
  to: VehicleStatus,
  reason: string | null = null,
  opts: VehicleCommandOptions = {},
) {
  requireFlow(opts, "status");
  const vehicle = await ctx.tx.vehicle.findUnique({ where: { id } });
  if (!vehicle) throw new NotFoundError("Vehicle", id);
  const from = vehicle.status as VehicleStatus;
  if (!canTransition(from, to, vehicle.stockType as StockType)) {
    throw new InvalidTransitionError("Vehicle", from, to);
  }
  const extra: { stockType?: StockType; stockInDate?: Date | null; stockValueCents?: number } = {};
  if (to === "CUSTOMER") Object.assign(extra, { stockType: "NONE", stockInDate: null, stockValueCents: 0 });
  if (from === "CUSTOMER" && to === "INTAKE") Object.assign(extra, { stockType: "VO", stockInDate: ctx.businessDate, stockValueCents: 0 });
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

/** Commercial fields the business flows set on a vehicle (sales: price, plate, owner…). Audited. */
export interface VehiclePatch {
  listPriceCents?: number | null;
  registration?: string | null;
  mileage?: number;
  ownerCustomerId?: string | null;
  siteId?: string | null;
  vatRegime?: "STANDARD" | "MARGIN";
  stockInDate?: Date | null;
  firstRegistration?: Date | null;
}

export async function patchVehicle(ctx: ServiceContext, id: string, patch: VehiclePatch, opts: VehicleCommandOptions = {}) {
  requireFlow(opts, "commercial data");
  const before = await ctx.tx.vehicle.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Vehicle", id);
  if (patch.mileage !== undefined && patch.mileage < before.mileage) {
    throw new ValidationError("Mileage cannot go down", { mileage: [`Last known mileage is ${before.mileage} km`] });
  }
  const after = await ctx.tx.vehicle.update({ where: { id }, data: patch });
  await ctx.audit({ action: "vehicle.patch", entityType: "Vehicle", entityId: id, before, after: patch, siteId: after.siteId });
  return after;
}

/**
 * Move the vehicle stock sub-ledger and publish `VehicleStockMoved` (accounting posts the entry).
 * IN sets the stock value, COST adds to it, OUT keeps it as the historical cost (the vehicle leaves
 * the ledger through its status). Callers check their own permission.
 */
export async function moveVehicleStock(
  ctx: ServiceContext,
  input: { vehicleId: string; movement: StockMovement; amountCents: number; label: string; sourceType: string; sourceId?: string | null },
) {
  const v = await ctx.tx.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!v) throw new NotFoundError("Vehicle", input.vehicleId);
  if (v.stockType === "NONE" || !v.siteId) throw new ValidationError("Only VN/VO stock vehicles have a stock value");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new ValidationError("A stock movement needs a positive amount", { amountCents: ["Must be positive"] });
  }
  const stockValueCents =
    input.movement === "IN" ? input.amountCents : input.movement === "COST" ? v.stockValueCents + input.amountCents : v.stockValueCents;
  const updated = await ctx.tx.vehicle.update({ where: { id: v.id }, data: { stockValueCents } });
  await ctx.emit({
    type: "VehicleStockMoved",
    aggregateType: "Vehicle",
    aggregateId: v.id,
    siteId: v.siteId,
    payload: {
      vehicleId: v.id,
      siteId: v.siteId,
      brandId: v.brandId,
      stockType: v.stockType,
      movement: input.movement,
      amountCents: input.amountCents,
      label: input.label,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
    },
  });
  return updated;
}
