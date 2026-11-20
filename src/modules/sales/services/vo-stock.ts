/** Used-vehicle stock: purchases, reconditioning costs, pricing, opening stock. */
import type { ServiceContext } from "@/lib/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { applyRate } from "@/lib/money";
import { parseInput } from "@/lib/validation";
import { buildPurchaseEntry, postEntry, recordPayment } from "@/modules/accounting";
import { changeVehicleStatus, moveVehicleStock, patchVehicle, type VehicleStatus } from "@/modules/core";
import {
  repriceInputSchema,
  vehicleCostInputSchema,
  voPurchaseInputSchema,
  type RepriceInput,
  type VehicleCostInput,
  type VoPurchaseInput,
} from "../schemas/sales";
import { partyAddress, standardRateBp, vehicleLabel } from "./shared";
import { intakeUsedVehicle, registerVoEntry } from "./trade-in";

declare module "@/lib/events" {
  interface DomainEventMap {
    VehicleCostAdded: { vehicleId: string; costLineId: string; amountCents: number };
    VoRepriced: { vehicleId: string; oldPriceCents: number | null; newPriceCents: number };
  }
}

/**
 * Buy a used car. Private seller: margin regime, Dr 607200 / Cr 467400 then paid at once
 * (Dr 467400 / Cr bank). Professional: Dr 607200 (+ deductible VAT if it charges VAT) / Cr 401.
 * The car enters stock at its price excl. VAT (Dr 372000 / Cr 603720) and the police register.
 */
export async function purchaseVo(ctx: ServiceContext, input: VoPurchaseInput) {
  const data = parseInput(voPurchaseInputSchema, input);
  ctx.require("sales.vo_stock", "create", data.siteId);
  const customerId = data.source === "PRIVATE" ? data.customerId! : null;
  const supplierId = data.source === "PROFESSIONAL" ? data.supplierId! : null;
  const seller = await sellerOf(ctx, customerId, supplierId);
  const known = await ctx.tx.vehicle.findUnique({ where: { vin: data.vehicle.vin } });
  const vehicle = await intakeUsedVehicle(ctx, {
    siteId: data.siteId,
    knownVehicleId: known?.id ?? null,
    vatRegime: data.vatRegime,
    reason: `Bought from ${seller.name}`,
    data: data.vehicle,
    listPriceCents: data.listPriceCents ?? null,
  });
  const purchase = await bookVoPurchase(ctx, {
    siteId: data.siteId,
    vehicle,
    seller,
    customerId,
    supplierId,
    priceCents: data.priceCents,
    vatRegime: data.vatRegime,
    supplierReference: data.supplierReference ?? null,
    paymentMethod: data.paymentMethod,
  });
  return { vehicle: await ctx.tx.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } }), purchase };
}

/** Name and address of the seller for the police register: a private customer or a supplier. */
async function sellerOf(ctx: ServiceContext, customerId: string | null, supplierId: string | null) {
  if (customerId) {
    const c = await ctx.tx.customer.findUnique({ where: { id: customerId } });
    if (!c) throw new NotFoundError("Customer", customerId);
    if (c.kind !== "INDIVIDUAL") throw new ValidationError("A company sells with an invoice: record it as a professional purchase", { customerId: ["Not a private individual"] });
    return { name: c.displayName, address: partyAddress(c) };
  }
  const s = await ctx.tx.supplier.findUnique({ where: { id: supplierId! } });
  if (!s) throw new NotFoundError("Supplier", supplierId!);
  return { name: s.name, address: partyAddress(s) };
}

/** Purchase record, police register, purchase and stock entries, and the private seller's payment. */
async function bookVoPurchase(
  ctx: ServiceContext,
  args: {
    siteId: string;
    vehicle: { id: string; vin: string; registration: string | null; make: string; model: string; version: string; brandId: string | null };
    seller: { name: string; address: string | null };
    /** Exactly one: a private seller (customer) or a professional one (supplier). */
    customerId: string | null;
    supplierId: string | null;
    priceCents: number;
    vatRegime: "STANDARD" | "MARGIN";
    supplierReference: string | null;
    paymentMethod: "TRANSFER" | "CHEQUE";
  },
) {
  const source = args.customerId ? "PRIVATE" : "PROFESSIONAL";
  const rate = await standardRateBp(ctx.tx, args.siteId, ctx.businessDate);
  const vatCents = source === "PROFESSIONAL" && args.vatRegime === "STANDARD" ? applyRate(args.priceCents, rate) : 0;
  const purchase = await registerVoEntry(ctx, {
    siteId: args.siteId,
    vehicle: args.vehicle,
    source,
    customerId: args.customerId,
    supplierId: args.supplierId,
    priceCents: args.priceCents,
    vatCents,
    vatRegime: args.vatRegime,
    sellerName: args.seller.name,
    sellerAddress: args.seller.address,
    supplierReference: args.supplierReference,
  });
  const label = `VO purchase ${vehicleLabel(args.vehicle)} — ${purchase.number}`;
  await postEntry(
    ctx,
    buildPurchaseEntry({
      siteId: args.siteId,
      date: ctx.businessDate,
      label,
      sourceType: "VO_PURCHASE",
      sourceId: purchase.id,
      lines: [{ account: { key: "PURCHASE_VO" }, amountCents: args.priceCents, departmentCode: "VO" }],
      vatCents,
      credit: args.customerId
        ? { account: { key: "PRIVATE_SELLER" }, partyType: "CUSTOMER", partyId: args.customerId }
        : { account: { key: "PAYABLE_SUPPLIER" }, partyType: "SUPPLIER", partyId: args.supplierId! },
    }),
    { brandId: args.vehicle.brandId },
  );
  await moveVehicleStock(ctx, { vehicleId: args.vehicle.id, movement: "IN", amountCents: args.priceCents, label, sourceType: "VO_PURCHASE", sourceId: purchase.id });
  if (args.customerId) {
    await recordPayment(
      ctx,
      {
        siteId: args.siteId,
        direction: "OUT",
        method: args.paymentMethod,
        customerId: args.customerId,
        amountCents: args.priceCents,
        reference: `VO purchase ${purchase.number}`,
        sourceType: "VO_PURCHASE",
        sourceId: purchase.id,
      },
      { trusted: true, counterKey: "PRIVATE_SELLER" },
    );
  }
  return purchase;
}

async function stockVo(ctx: ServiceContext, vehicleId: string, action: "edit" | "create" = "edit") {
  const v = await ctx.tx.vehicle.findUnique({ where: { id: vehicleId } });
  if (!v) throw new NotFoundError("Vehicle", vehicleId);
  if (v.stockType !== "VO" || !v.siteId) throw new ValidationError("Not a used vehicle in stock");
  ctx.require("sales.vo_stock", action, v.siteId);
  return { ...v, siteId: v.siteId };
}

/**
 * Capitalise a reconditioning, transport or other cost into the car's stock value: the supplier's
 * invoice (Dr 604000 + VAT / Cr 401) and the stock entry (Dr 372000 / Cr 603720).
 */
export async function addVehicleCost(ctx: ServiceContext, vehicleId: string, input: VehicleCostInput) {
  const data = parseInput(vehicleCostInputSchema, input);
  const v = await stockVo(ctx, vehicleId);
  if (!["INTAKE", "RECONDITIONING", "FOR_SALE", "RESERVED"].includes(v.status)) throw new ConflictError("Costs can be added while the car is in stock only");
  const supplier = await ctx.tx.supplier.findUnique({ where: { id: data.supplierId } });
  if (!supplier) throw new NotFoundError("Supplier", data.supplierId);
  const line = await ctx.tx.vehicleCostLine.create({
    data: { vehicleId: v.id, kind: data.kind, label: data.label, amountCents: data.amountCents, supplierId: supplier.id, businessDate: ctx.businessDate, createdById: ctx.actor.userId },
  });
  const rate = await standardRateBp(ctx.tx, v.siteId, ctx.businessDate);
  const label = `${data.label} — ${vehicleLabel(v)}${data.supplierReference ? ` (${data.supplierReference})` : ""}`;
  await postEntry(
    ctx,
    buildPurchaseEntry({
      siteId: v.siteId,
      date: ctx.businessDate,
      label,
      sourceType: "VEHICLE_COST",
      sourceId: line.id,
      lines: [{ account: { key: "PURCHASE_RECONDITIONING" }, amountCents: data.amountCents, departmentCode: "VO" }],
      vatCents: applyRate(data.amountCents, rate),
      credit: { account: { key: "PAYABLE_SUPPLIER" }, partyType: "SUPPLIER", partyId: supplier.id },
    }),
    { brandId: v.brandId },
  );
  await moveVehicleStock(ctx, { vehicleId: v.id, movement: "COST", amountCents: data.amountCents, label, sourceType: "VEHICLE_COST", sourceId: line.id });
  await ctx.audit({ action: "vehicle.cost", entityType: "Vehicle", entityId: v.id, siteId: v.siteId, after: line });
  await ctx.emit({ type: "VehicleCostAdded", aggregateType: "Vehicle", aggregateId: v.id, siteId: v.siteId, payload: { vehicleId: v.id, costLineId: line.id, amountCents: line.amountCents } });
  return line;
}

export async function startReconditioning(ctx: ServiceContext, vehicleId: string) {
  const v = await stockVo(ctx, vehicleId);
  if (v.status !== "INTAKE" && v.status !== "FOR_SALE") throw new ConflictError(`A car ${v.status.toLowerCase()} cannot go to reconditioning`);
  return changeVehicleStatus(ctx, v.id, "RECONDITIONING", "Reconditioning started", { trusted: true });
}

/** Put a used car on sale; it needs an advertised price. */
export async function setForSale(ctx: ServiceContext, vehicleId: string, input: { listPriceCents?: unknown } = {}) {
  const v = await stockVo(ctx, vehicleId);
  if (v.status !== "INTAKE" && v.status !== "RECONDITIONING") throw new ConflictError(`A car ${v.status.toLowerCase()} cannot be put on sale`);
  if (input.listPriceCents !== undefined && input.listPriceCents !== "") await repriceVo(ctx, v.id, { listPriceCents: input.listPriceCents as RepriceInput["listPriceCents"], reason: "Price at listing" });
  const current = await ctx.tx.vehicle.findUniqueOrThrow({ where: { id: v.id } });
  if (!current.listPriceCents) throw new ValidationError("Set the selling price first", { listPriceCents: ["Required"] });
  return changeVehicleStatus(ctx, v.id, "FOR_SALE", "On sale", { trusted: true });
}

/** Change the advertised price (ageing stock is repriced); history kept in VoPriceChange. */
export async function repriceVo(ctx: ServiceContext, vehicleId: string, input: RepriceInput) {
  const data = parseInput(repriceInputSchema, input);
  const v = await stockVo(ctx, vehicleId);
  if (!["INTAKE", "RECONDITIONING", "FOR_SALE", "RESERVED"].includes(v.status)) throw new ConflictError("Only cars in stock can be repriced");
  if (v.listPriceCents === data.listPriceCents) return v;
  await ctx.tx.voPriceChange.create({
    data: { vehicleId: v.id, oldPriceCents: v.listPriceCents, newPriceCents: data.listPriceCents, reason: data.reason ?? null, businessDate: ctx.businessDate, userId: ctx.actor.userId },
  });
  const updated = await patchVehicle(ctx, v.id, { listPriceCents: data.listPriceCents }, { trusted: true });
  await ctx.emit({ type: "VoRepriced", aggregateType: "Vehicle", aggregateId: v.id, siteId: v.siteId, payload: { vehicleId: v.id, oldPriceCents: v.listPriceCents, newPriceCents: data.listPriceCents } });
  return updated;
}

/**
 * Opening stock (seed): used cars already held when the books were opened get their purchase
 * record and police register entry, without posting (the opening balance carries the value).
 */
export async function registerOpeningVo(ctx: ServiceContext, vehicleId: string, args: { sellerName: string; sellerAddress: string | null; purchaseDate: Date }) {
  const v = await ctx.tx.vehicle.findUnique({ where: { id: vehicleId } });
  if (!v || v.stockType !== "VO" || !v.siteId) throw new ValidationError("Not a used vehicle in stock");
  if (!["INTAKE", "RECONDITIONING", "FOR_SALE", "RESERVED"].includes(v.status as VehicleStatus)) throw new ConflictError("Not in stock");
  if (await ctx.tx.voPurchase.findFirst({ where: { vehicleId: v.id, cancelledOn: null } })) throw new ConflictError("Already registered");
  return registerVoEntry(ctx, {
    siteId: v.siteId,
    vehicle: v,
    source: "OPENING",
    priceCents: v.stockValueCents,
    vatRegime: v.vatRegime,
    sellerName: args.sellerName,
    sellerAddress: args.sellerAddress,
    purchaseDate: args.purchaseDate,
  });
}

/**
 * Seed only: a used car of the seed's stock bought after the books were opened. On its stock-in
 * date (the business date) its purchase is booked like any other, at its stock value.
 */
export async function registerPastVoPurchase(ctx: ServiceContext, vehicleId: string, seller: { customerId: string } | { supplierId: string }) {
  const v = await stockVo(ctx, vehicleId, "create");
  if (!["INTAKE", "RECONDITIONING", "FOR_SALE"].includes(v.status)) throw new ConflictError("Not in stock");
  if (v.stockInDate?.getTime() !== ctx.businessDate.getTime()) throw new ConflictError("This car was not bought on that day");
  if (await ctx.tx.voPurchase.findFirst({ where: { vehicleId: v.id, cancelledOn: null } })) throw new ConflictError("Already registered");
  const customerId = "customerId" in seller ? seller.customerId : null;
  const supplierId = "supplierId" in seller ? seller.supplierId : null;
  if (customerId && v.vatRegime !== "MARGIN") throw new ValidationError("A private seller charges no VAT");
  return bookVoPurchase(ctx, {
    siteId: v.siteId,
    vehicle: v,
    seller: await sellerOf(ctx, customerId, supplierId),
    customerId,
    supplierId,
    priceCents: v.stockValueCents,
    vatRegime: v.vatRegime,
    supplierReference: null,
    paymentMethod: "TRANSFER",
  });
}
