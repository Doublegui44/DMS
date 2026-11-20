/**
 * Used vehicles entering stock: the VO purchase record, the police register (livre de police),
 * the purchase entry and the stock movement. Shared by trade-ins and direct VO purchases.
 */
import type { ServiceContext } from "@/lib/context";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { buildPurchaseEntry, postEntry } from "@/modules/accounting";
import { changeVehicleStatus, createVehicle, moveVehicleStock, nextDocumentNumber, patchVehicle } from "@/modules/core";
import type { Fuel } from "../domain/fees";
import { partyAddress, vehicleLabel } from "./shared";

declare module "@/lib/events" {
  interface DomainEventMap {
    VoPurchased: { voPurchaseId: string; number: string; vehicleId: string; source: string; priceCents: number };
    TradeInHandedBack: { voPurchaseId: string; vehicleId: string; orderNumber: string };
  }
}

type PurchaseSource = "TRADE_IN" | "PRIVATE" | "PROFESSIONAL" | "OPENING";

/** VO purchase + police register entry (numbered per site). No posting: callers post what applies. */
export async function registerVoEntry(
  ctx: ServiceContext,
  args: {
    siteId: string;
    vehicle: { id: string; vin: string; registration: string | null; make: string; model: string; version: string };
    source: PurchaseSource;
    customerId?: string | null;
    supplierId?: string | null;
    salesOrderId?: string | null;
    priceCents: number;
    vatCents?: number;
    vatRegime: "STANDARD" | "MARGIN";
    sellerName: string;
    sellerAddress: string | null;
    supplierReference?: string | null;
    purchaseDate?: Date;
  },
) {
  const site = await ctx.tx.site.findUniqueOrThrow({ where: { id: args.siteId } });
  const purchaseDate = args.purchaseDate ?? ctx.businessDate;
  const number = await nextDocumentNumber(ctx, { docType: "VO_PURCHASE", scope: site.id, sitePrefix: site.code, date: purchaseDate });
  const purchase = await ctx.tx.voPurchase.create({
    data: {
      number,
      siteId: site.id,
      vehicleId: args.vehicle.id,
      source: args.source,
      customerId: args.customerId ?? null,
      supplierId: args.supplierId ?? null,
      salesOrderId: args.salesOrderId ?? null,
      priceCents: args.priceCents,
      vatCents: args.vatCents ?? 0,
      vatRegime: args.vatRegime,
      purchaseDate,
      supplierReference: args.supplierReference ?? null,
    },
  });
  const registerNumber = await nextDocumentNumber(ctx, { docType: "POLICE_REGISTER", scope: site.id, sitePrefix: site.code });
  await ctx.tx.policeRegisterEntry.create({
    data: {
      number: registerNumber,
      siteId: site.id,
      vehicleId: args.vehicle.id,
      voPurchaseId: purchase.id,
      inDate: purchaseDate,
      description: vehicleLabel(args.vehicle),
      vin: args.vehicle.vin,
      registration: args.vehicle.registration,
      sellerName: args.sellerName,
      sellerAddress: args.sellerAddress,
      purchasePriceCents: args.priceCents,
    },
  });
  await ctx.audit({ action: "vo.purchase", entityType: "Vehicle", entityId: args.vehicle.id, siteId: site.id, after: { purchase: number, register: registerNumber, source: args.source, priceCents: args.priceCents } });
  await ctx.emit({
    type: "VoPurchased",
    aggregateType: "Vehicle",
    aggregateId: args.vehicle.id,
    siteId: site.id,
    payload: { voPurchaseId: purchase.id, number, vehicleId: args.vehicle.id, source: args.source, priceCents: args.priceCents },
  });
  return purchase;
}

/**
 * Bring a car into VO stock as INTAKE: the customer's known car changes hands, otherwise a new
 * vehicle record is created. Ageing starts today (stockInDate).
 */
export async function intakeUsedVehicle(
  ctx: ServiceContext,
  args: {
    siteId: string;
    knownVehicleId?: string | null;
    vatRegime: "STANDARD" | "MARGIN";
    reason: string;
    data: {
      vin: string;
      registration?: string | null;
      brandId?: string | null;
      make: string;
      model: string;
      version: string;
      firstRegistration?: Date | null;
      mileage: number;
      fuel: Fuel;
      co2?: number | null;
      powerHp?: number | null;
      colour?: string | null;
    };
    listPriceCents?: number | null;
  },
) {
  const known = args.knownVehicleId
    ? await ctx.tx.vehicle.findUnique({ where: { id: args.knownVehicleId } })
    : await ctx.tx.vehicle.findUnique({ where: { vin: args.data.vin } });
  if (args.knownVehicleId && !known) throw new NotFoundError("Vehicle", args.knownVehicleId);
  if (known) {
    if (known.status !== "CUSTOMER") throw new ConflictError(`Vehicle ${known.vin} is already in stock`);
    await changeVehicleStatus(ctx, known.id, "INTAKE", args.reason, { trusted: true });
    return patchVehicle(
      ctx,
      known.id,
      {
        siteId: args.siteId,
        ownerCustomerId: null,
        mileage: Math.max(known.mileage, args.data.mileage),
        vatRegime: args.vatRegime,
        registration: args.data.registration ?? known.registration,
        listPriceCents: args.listPriceCents ?? null,
      },
      { trusted: true },
    );
  }
  const brandId =
    args.data.brandId ?? (await ctx.tx.brand.findFirst({ where: { name: { equals: args.data.make, mode: "insensitive" } }, select: { id: true } }))?.id ?? null;
  return createVehicle(
    ctx,
    {
      vin: args.data.vin,
      registration: args.data.registration ?? null,
      brandId,
      make: args.data.make,
      model: args.data.model,
      version: args.data.version || "—",
      firstRegistration: args.data.firstRegistration ?? null,
      mileage: args.data.mileage,
      fuel: args.data.fuel,
      co2: args.data.co2 ?? null,
      powerHp: args.data.powerHp ?? null,
      colour: args.data.colour ?? null,
      stockType: "VO",
      status: "INTAKE",
      siteId: args.siteId,
      listPriceCents: args.listPriceCents ?? null,
      stockValueCents: 0,
      vatRegime: args.vatRegime,
    },
    { trusted: true },
  );
}

/**
 * Take the trade-in of a confirmed order into stock (D-032): VO in INTAKE, purchase + police
 * register, Dr 607200 / Cr 467400 (owed to the customer), then the stock entry Dr 372 / Cr 6037.
 * The 467400 balance is settled at invoicing by a TRADE_IN payment on the customer's invoice.
 */
export async function takeTradeIn(
  ctx: ServiceContext,
  args: {
    orderId: string;
    orderNumber: string;
    siteId: string;
    customer: { id: string; displayName: string; address: string | null; postalCode: string | null; city: string | null };
    tradeIn: {
      id: string;
      vehicleId: string | null;
      vin: string;
      registration: string | null;
      make: string;
      model: string;
      version: string;
      firstRegistration: Date | null;
      mileage: number;
      fuel: Fuel;
      offerCents: number;
    };
  },
) {
  const t = args.tradeIn;
  const vehicle = await intakeUsedVehicle(ctx, {
    siteId: args.siteId,
    knownVehicleId: t.vehicleId,
    vatRegime: "MARGIN",
    reason: `Trade-in on order ${args.orderNumber}`,
    data: { vin: t.vin, registration: t.registration, make: t.make, model: t.model, version: t.version, firstRegistration: t.firstRegistration, mileage: t.mileage, fuel: t.fuel },
  });
  await ctx.tx.tradeInAppraisal.update({ where: { id: t.id }, data: { vehicleId: vehicle.id } });
  const purchase = await registerVoEntry(ctx, {
    siteId: args.siteId,
    vehicle,
    source: "TRADE_IN",
    customerId: args.customer.id,
    salesOrderId: args.orderId,
    priceCents: t.offerCents,
    vatRegime: "MARGIN",
    sellerName: args.customer.displayName,
    sellerAddress: partyAddress(args.customer),
  });
  const label = `Trade-in ${vehicleLabel(vehicle)} — ${args.orderNumber}`;
  await postEntry(
    ctx,
    buildPurchaseEntry({
      siteId: args.siteId,
      date: ctx.businessDate,
      label,
      sourceType: "VO_PURCHASE",
      sourceId: purchase.id,
      lines: [{ account: { key: "PURCHASE_VO" }, amountCents: t.offerCents, departmentCode: "VO" }],
      credit: { account: { key: "PRIVATE_SELLER" }, partyType: "CUSTOMER", partyId: args.customer.id },
    }),
    { brandId: vehicle.brandId },
  );
  await moveVehicleStock(ctx, { vehicleId: vehicle.id, movement: "IN", amountCents: t.offerCents, label, sourceType: "VO_PURCHASE", sourceId: purchase.id });
  return { vehicleId: vehicle.id, purchase };
}

/**
 * Order cancelled before invoicing: the trade-in goes back to its owner. Only possible while it is
 * still untouched in INTAKE (no reconditioning cost); everything is reversed (stock, purchase entry,
 * police register exit) and the car becomes the customer's again.
 */
export async function handBackTradeIn(ctx: ServiceContext, voPurchaseId: string, orderNumber: string) {
  const p = await ctx.tx.voPurchase.findUnique({ where: { id: voPurchaseId }, include: { vehicle: true, customer: true, policeEntry: true } });
  if (!p) throw new NotFoundError("VoPurchase", voPurchaseId);
  if (p.cancelledOn) return;
  const v = p.vehicle;
  const costs = await ctx.tx.vehicleCostLine.count({ where: { vehicleId: v.id, businessDate: { gte: p.purchaseDate } } });
  if (v.status !== "INTAKE" || costs > 0) {
    throw new ConflictError(`The trade-in ${vehicleLabel(v)} is already being prepared for resale: it cannot be handed back`);
  }
  const label = `Trade-in handed back ${vehicleLabel(v)} — ${orderNumber}`;
  await moveVehicleStock(ctx, { vehicleId: v.id, movement: "OUT", amountCents: v.stockValueCents, label, sourceType: "VO_PURCHASE", sourceId: p.id });
  await postEntry(
    ctx,
    {
      journalCode: "AC",
      siteId: p.siteId,
      entryDate: ctx.businessDate,
      label,
      sourceType: "VO_PURCHASE",
      sourceId: p.id,
      lines: [
        { account: { key: "PRIVATE_SELLER" }, debitCents: p.priceCents, creditCents: 0, label, partyType: "CUSTOMER", partyId: p.customerId },
        { account: { key: "PURCHASE_VO" }, debitCents: 0, creditCents: p.priceCents, label, departmentCode: "VO" },
      ],
    },
    { brandId: v.brandId },
  );
  await ctx.tx.voPurchase.update({ where: { id: p.id }, data: { cancelledOn: ctx.businessDate } });
  if (p.policeEntry) {
    await ctx.tx.policeRegisterEntry.update({
      where: { id: p.policeEntry.id },
      data: {
        outDate: ctx.businessDate,
        buyerName: p.customer?.displayName ?? p.policeEntry.sellerName,
        buyerAddress: p.customer ? partyAddress(p.customer) : p.policeEntry.sellerAddress,
        salePriceCents: p.priceCents,
        saleReference: `Returned to owner — order ${orderNumber} cancelled`,
      },
    });
  }
  await changeVehicleStatus(ctx, v.id, "CUSTOMER", `Handed back — order ${orderNumber} cancelled`, { trusted: true });
  await patchVehicle(ctx, v.id, { ownerCustomerId: p.customerId, siteId: null, listPriceCents: null }, { trusted: true });
  await ctx.emit({ type: "TradeInHandedBack", aggregateType: "Vehicle", aggregateId: v.id, siteId: p.siteId, payload: { voPurchaseId: p.id, vehicleId: v.id, orderNumber } });
}
