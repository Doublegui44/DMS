import type { ServiceContext } from "@/lib/context";
import { addDays, isoDate } from "@/lib/dates";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatMoney, sumCents } from "@/lib/money";
import { parseInput } from "@/lib/validation";
import { allocatePayment, buildPurchaseEntry, createAndIssueInvoice, postEntry, recordPayment } from "@/modules/accounting";
import {
  canTransition,
  changeVehicleStatus,
  createVehicle,
  getSetting,
  isPhysicallyInStock,
  moveVehicleStock,
  nextDocumentNumber,
  patchVehicle,
  seededRandom,
  type StockType,
  type VehicleStatus,
} from "@/modules/core";
import { computeCommission, invoiceLineFor, type DealLineKind } from "../domain/pricing";
import { canCancelOrder, canDeliverOrder, canInvoiceOrder, isPastDate, releasedStatus } from "../domain/workflow";
import { deliveryInputSchema, depositInputSchema, MONEY_METHODS, reasonSchema, type DeliveryInput, type DepositInput } from "../schemas/sales";
import { closeOpenQuotes } from "./leads";
import { openOrderFor, releaseReservation } from "./reservations";
import { partyAddress, salesSettings, uniquePlate, uniqueVin, vehicleLabel } from "./shared";
import { handBackTradeIn, takeTradeIn } from "./trade-in";

declare module "@/lib/events" {
  interface DomainEventMap {
    SalesOrderConfirmed: { orderId: string; number: string; quoteId: string; vehicleId: string; customerId: string; totalInclVatCents: number; tradeInVehicleId: string | null };
    FactoryOrderPlaced: { factoryOrderId: string; number: string; vehicleId: string; salesOrderId: string | null; expectedOn: string };
    SalesOrderInvoiced: { orderId: string; number: string; invoiceId: string; invoiceNumber: string; totalInclVatCents: number };
    SalesOrderDelivered: { orderId: string; number: string; vehicleId: string; customerId: string; commissionCents: number };
    SalesOrderCancelled: { orderId: string; number: string; reason: string };
  }
}

/** Days between arrival in stock and the planned handover (preparation, registration). */
const PREPARATION_DAYS = 7;

/** OEM order reference, deterministic from our factory-order number. */
export function oemReference(brandCode: string, number: string): string {
  const digits = String(Math.floor(seededRandom(number)() * 1e8)).padStart(8, "0");
  return `${brandCode.slice(0, 2)}${digits}`;
}

/** Place a factory order: the VN vehicle record (ORDERED) with its options and the CU document. */
export async function placeFactoryOrder(
  ctx: ServiceContext,
  args: { siteId: string; versionId: string; optionIds: string[]; colour: string | null; listPriceInclVatCents: number; salesOrderId: string | null; seed: string },
) {
  const site = await ctx.tx.site.findUniqueOrThrow({ where: { id: args.siteId } });
  const version = await ctx.tx.catalogueVersion.findUnique({ where: { id: args.versionId }, include: { model: { include: { brand: true } }, options: true } });
  if (!version) throw new NotFoundError("CatalogueVersion", args.versionId);
  const brand = version.model.brand;
  const options = version.options.filter((o) => args.optionIds.includes(o.id));
  const number = await nextDocumentNumber(ctx, { docType: "FACTORY_ORDER", scope: site.id, sitePrefix: site.code });
  const vehicle = await createVehicle(
    ctx,
    {
      vin: await uniqueVin(ctx.tx, brand.wmi ?? "VF7", `${args.seed}/${number}`),
      brandId: brand.id,
      make: brand.name,
      model: version.model.name,
      version: version.name,
      fuel: version.fuel,
      co2: version.co2,
      powerHp: version.powerHp,
      colour: args.colour,
      mileage: 0,
      stockType: "VN",
      status: "ORDERED",
      siteId: site.id,
      listPriceCents: args.listPriceInclVatCents,
      // Expected cost: what the OEM will invoice (vehicle + options); confirmed at arrival.
      stockValueCents: version.dealerCostCents + sumCents(options.map((o) => o.dealerCostCents)),
      vatRegime: "STANDARD",
    },
    { trusted: true },
  );
  if (options.length) {
    await ctx.tx.vehicleOption.createMany({ data: options.map((o) => ({ vehicleId: vehicle.id, code: o.code, label: o.label, priceCents: o.listPriceExclVatCents })) });
  }
  const expectedOn = addDays(ctx.businessDate, version.leadTimeDays);
  const fo = await ctx.tx.factoryOrder.create({
    data: {
      number,
      siteId: site.id,
      catalogueVersionId: version.id,
      vehicleId: vehicle.id,
      salesOrderId: args.salesOrderId,
      oemReference: oemReference(brand.code, number),
      orderedOn: ctx.businessDate,
      expectedOn,
    },
  });
  await ctx.audit({ action: "factory_order.place", entityType: "Vehicle", entityId: vehicle.id, siteId: site.id, after: fo });
  await ctx.emit({
    type: "FactoryOrderPlaced",
    aggregateType: "Vehicle",
    aggregateId: vehicle.id,
    siteId: site.id,
    payload: { factoryOrderId: fo.id, number, vehicleId: vehicle.id, salesOrderId: args.salesOrderId, expectedOn: isoDate(expectedOn) },
  });
  return { vehicle, factoryOrder: fo, leadTimeDays: version.leadTimeDays };
}

/**
 * The customer signs: the quote becomes an order (bon de commande). The vehicle is taken off sale
 * (or ordered from the manufacturer), the trade-in enters VO stock, the lead is won and the other
 * quotes of the lead are closed — all in one transaction. Double sale is impossible: one open order
 * per vehicle (checked here and by a partial unique index).
 */
export async function acceptQuote(ctx: ServiceContext, quoteId: string) {
  const quote = await ctx.tx.quote.findUnique({
    where: { id: quoteId },
    include: { lead: true, customer: true, site: true, tradeIn: true, lines: true },
  });
  if (!quote) throw new NotFoundError("Quote", quoteId);
  ctx.require("sales.order", "create", quote.siteId);
  if (quote.status !== "SENT") {
    throw new ConflictError(quote.status === "PENDING_APPROVAL" ? "The discount is waiting for approval" : `The quote is ${quote.status.toLowerCase().replace("_", " ")}`);
  }
  if (isPastDate(quote.validUntil, ctx.businessDate)) throw new ConflictError(`The quote expired on ${isoDate(quote.validUntil)}: revise it first`);
  if (quote.lead.stage === "LOST" || quote.lead.stage === "WON") throw new ConflictError(`Lead ${quote.lead.number} is closed`);
  if (quote.stockType !== "VN" && quote.stockType !== "VO") throw new ValidationError("Only new and used vehicles can be sold");

  const number = await nextDocumentNumber(ctx, { docType: "SALES_ORDER", scope: quote.siteId, sitePrefix: quote.site.code });
  let vehicleId: string;
  let expectedDeliveryDate: Date;
  let factoryOrderId: string | null = null;
  if (quote.vehicleId) {
    const v = await ctx.tx.vehicle.findUniqueOrThrow({ where: { id: quote.vehicleId }, include: { factoryOrder: true } });
    const sold = await openOrderFor(ctx.tx, v.id);
    if (sold) throw new ConflictError(`This vehicle was sold on order ${sold.number} in the meantime`);
    const active = await ctx.tx.reservation.findFirst({ where: { vehicleId: v.id, status: "ACTIVE" }, include: { customer: true } });
    if (active && active.customerId !== quote.customerId) {
      throw new ConflictError(`This vehicle is reserved for ${active.customer.displayName} until ${isoDate(active.expiresOn)}`);
    }
    if (active) await releaseReservation(ctx, active.id, "CONVERTED", { trusted: true });
    if (v.status !== "RESERVED") {
      if (!canTransition(v.status as VehicleStatus, "RESERVED", v.stockType as StockType)) {
        throw new ConflictError(`A vehicle in status ${v.status.toLowerCase().replace("_", " ")} cannot be sold`);
      }
      await changeVehicleStatus(ctx, v.id, "RESERVED", `Sold on order ${number}`, { trusted: true });
    }
    vehicleId = v.id;
    const arrival = v.stockInDate ? ctx.businessDate : v.factoryOrder?.expectedOn ?? addDays(ctx.businessDate, 30);
    expectedDeliveryDate = addDays(arrival > ctx.businessDate ? arrival : ctx.businessDate, PREPARATION_DAYS);
  } else {
    if (!quote.catalogueVersionId) throw new ValidationError("The quote has no vehicle");
    const placed = await placeFactoryOrder(ctx, {
      siteId: quote.siteId,
      versionId: quote.catalogueVersionId,
      optionIds: quote.lines.map((l) => l.catalogueOptionId).filter((id): id is string => !!id),
      colour: quote.colour,
      listPriceInclVatCents: quote.listPriceInclVatCents,
      salesOrderId: null,
      seed: number,
    });
    await changeVehicleStatus(ctx, placed.vehicle.id, "RESERVED", `Ordered for ${number}`, { trusted: true });
    vehicleId = placed.vehicle.id;
    factoryOrderId = placed.factoryOrder.id;
    expectedDeliveryDate = addDays(ctx.businessDate, placed.leadTimeDays + PREPARATION_DAYS);
  }

  const order = await ctx.tx.salesOrder.create({
    data: {
      number,
      quoteId: quote.id,
      leadId: quote.leadId,
      siteId: quote.siteId,
      customerId: quote.customerId,
      salespersonId: quote.salespersonId,
      vehicleId,
      stockType: quote.stockType,
      orderDate: ctx.businessDate,
      expectedDeliveryDate,
      totalInclVatCents: quote.totalInclVatCents,
      tradeInCents: quote.tradeInCents,
      financedCents: quote.financedCents,
      frontEndMarginCents: quote.frontEndMarginCents,
      backEndMarginCents: quote.backEndMarginCents,
    },
  });
  if (factoryOrderId) await ctx.tx.factoryOrder.update({ where: { id: factoryOrderId }, data: { salesOrderId: order.id } });

  let tradeInVehicleId: string | null = null;
  if (quote.tradeIn) {
    const taken = await takeTradeIn(ctx, { orderId: order.id, orderNumber: number, siteId: quote.siteId, customer: quote.customer, tradeIn: quote.tradeIn });
    tradeInVehicleId = taken.vehicleId;
  }

  await ctx.tx.quote.update({ where: { id: quote.id }, data: { status: "ACCEPTED", decidedOn: ctx.businessDate } });
  const others = await ctx.tx.quote.findMany({
    where: { leadId: quote.leadId, id: { not: quote.id }, status: { in: ["DRAFT", "PENDING_APPROVAL", "SENT"] } },
    select: { id: true },
  });
  await closeOpenQuotes(ctx, others.map((q) => q.id));
  await ctx.tx.lead.update({ where: { id: quote.leadId }, data: { stage: "WON", closedOn: ctx.businessDate } });

  await ctx.audit({ action: "order.confirm", entityType: "SalesOrder", entityId: order.id, siteId: order.siteId, after: order });
  await ctx.emit({ type: "QuoteStatusChanged", aggregateType: "Quote", aggregateId: quote.id, siteId: quote.siteId, payload: { quoteId: quote.id, number: quote.number, from: "SENT", to: "ACCEPTED" } });
  await ctx.emit({ type: "LeadStageChanged", aggregateType: "Lead", aggregateId: quote.leadId, siteId: quote.siteId, payload: { leadId: quote.leadId, from: quote.lead.stage, to: "WON", reason: `Order ${number}` } });
  await ctx.emit({
    type: "SalesOrderConfirmed",
    aggregateType: "SalesOrder",
    aggregateId: order.id,
    siteId: order.siteId,
    payload: { orderId: order.id, number, quoteId: quote.id, vehicleId, customerId: order.customerId, totalInclVatCents: order.totalInclVatCents, tradeInVehicleId },
  });
  return order;
}

/** Money the customer still pays out of pocket on an order (total − trade-in − financed). */
function cashDue(order: { totalInclVatCents: number; tradeInCents: number; financedCents: number }): number {
  return order.totalInclVatCents - order.tradeInCents - order.financedCents;
}

/**
 * Deposit (or later payment) taken on an order. Before invoicing it stays on the customer's account
 * (sourceType SALES_ORDER) and is allocated to the invoice when the order is invoiced.
 * Recording money needs `accounting.payment:create`.
 */
export async function recordOrderPayment(ctx: ServiceContext, orderId: string, input: DepositInput) {
  const data = parseInput(depositInputSchema, input);
  const order = await ctx.tx.salesOrder.findUnique({ where: { id: orderId }, include: { invoice: true } });
  if (!order) throw new NotFoundError("SalesOrder", orderId);
  ctx.require("sales.order", "edit", order.siteId);
  if (order.status !== "CONFIRMED" && order.status !== "INVOICED") throw new ConflictError(`The order is ${order.status.toLowerCase()}`);
  let allocations: { invoiceId: string; amountCents: number }[] = [];
  if (order.invoice) {
    const due = order.invoice.totalInclVatCents - order.invoice.paidCents;
    if (data.amountCents > due) throw new ValidationError(`Only ${formatMoney(due)} is due`, { amountCents: [`At most ${formatMoney(due)}`] });
    allocations = [{ invoiceId: order.invoice.id, amountCents: data.amountCents }];
  } else {
    const taken = await ctx.tx.payment.aggregate({ where: { sourceType: "SALES_ORDER", sourceId: order.id, direction: "IN", method: { in: [...MONEY_METHODS] } }, _sum: { amountCents: true } });
    const left = cashDue(order) - (taken._sum.amountCents ?? 0);
    if (data.amountCents > left) throw new ValidationError(`Deposits cannot exceed what the customer pays: ${formatMoney(Math.max(0, left))} left`, { amountCents: ["Too high"] });
  }
  return recordPayment(ctx, {
    siteId: order.siteId,
    direction: "IN",
    method: data.method,
    customerId: order.customerId,
    amountCents: data.amountCents,
    reference: data.reference ?? `${order.invoice ? "Payment" : "Deposit"} ${order.number}`,
    sourceType: "SALES_ORDER",
    sourceId: order.id,
    allocations,
  });
}

/**
 * Invoice the order once the vehicle is physically in stock: customer invoice (vehicle, options,
 * add-ons, fees…), vehicle SOLD and out of stock (cost of sale), settlement by the trade-in, the
 * finance company and the deposits, finance commission, OEM incentive claim, add-on cost accruals,
 * police register exit for a used car. One transaction.
 */
export async function invoiceOrder(ctx: ServiceContext, orderId: string) {
  const order = await ctx.tx.salesOrder.findUnique({
    where: { id: orderId },
    include: {
      quote: { include: { lines: { orderBy: { lineNo: "asc" } }, financing: true } },
      vehicle: { include: { brand: true } },
      customer: true,
    },
  });
  if (!order) throw new NotFoundError("SalesOrder", orderId);
  ctx.require("sales.order", "validate", order.siteId);
  const v = order.vehicle;
  const guard = canInvoiceOrder({
    status: order.status,
    vehicleInStock: isPhysicallyInStock({ stockType: v.stockType as StockType, status: v.status as VehicleStatus, stockInDate: v.stockInDate }),
  });
  if (!guard.ok) throw new ConflictError(guard.reason);
  if (order.stockType !== "VN" && order.stockType !== "VO") throw new ValidationError("Only new and used vehicles can be invoiced here");
  const stockType = order.stockType;
  const quote = order.quote;

  const mention = quote.vatRegime === "MARGIN" ? await getSetting(ctx.tx, "accounting.marginSchemeMention", order.siteId, "") : "";
  const invoice = await createAndIssueInvoice(
    ctx,
    {
      siteId: order.siteId,
      customerId: order.customerId,
      sourceType: "SALES_ORDER",
      sourceId: order.id,
      vatRegime: quote.vatRegime,
      notes: [`Order ${order.number}`, `VIN ${v.vin}`, mention].filter(Boolean).join(" — "),
      lines: quote.lines.map((l) =>
        invoiceLineFor({ kind: l.kind as DealLineKind, label: l.label, quantity: l.quantity, unitPriceCents: l.unitPriceCents, vatMode: l.vatMode, purchasePriceCents: l.purchasePriceCents }, stockType),
      ),
    },
    { trusted: true },
  );
  if (invoice.totalInclVatCents !== order.totalInclVatCents) {
    throw new DomainError("total_mismatch", `Invoice total ${formatMoney(invoice.totalInclVatCents)} differs from the order ${formatMoney(order.totalInclVatCents)}`);
  }
  const invoiceNumber = invoice.number!;

  // The vehicle leaves stock: cost of sale at its stock value (Dr 6037x / Cr 37x via the stock event).
  await changeVehicleStatus(ctx, v.id, "SOLD", `Invoiced ${invoiceNumber}`, { trusted: true });
  await moveVehicleStock(ctx, { vehicleId: v.id, movement: "OUT", amountCents: v.stockValueCents, label: `Cost of sale ${vehicleLabel(v)} — ${invoiceNumber}`, sourceType: "SALES_ORDER", sourceId: order.id });

  // Settlement in kind and by third parties.
  if (order.tradeInCents > 0) {
    await recordPayment(
      ctx,
      {
        siteId: order.siteId,
        method: "TRADE_IN",
        customerId: order.customerId,
        amountCents: order.tradeInCents,
        reference: `Trade-in — ${order.number}`,
        sourceType: "SALES_ORDER",
        sourceId: order.id,
        allocations: [{ invoiceId: invoice.id, amountCents: order.tradeInCents }],
      },
      { trusted: true },
    );
  }
  if (order.financedCents > 0 && quote.financing) {
    const f = quote.financing;
    await recordPayment(
      ctx,
      {
        siteId: order.siteId,
        method: "FINANCE_COMPANY",
        customerId: order.customerId,
        amountCents: order.financedCents,
        reference: `${f.lender} — ${order.number}`,
        sourceType: "SALES_ORDER",
        sourceId: order.id,
        allocations: [{ invoiceId: invoice.id, amountCents: order.financedCents }],
      },
      { trusted: true },
    );
    if (f.dealerCommissionCents > 0) {
      const label = `Finance commission ${f.lender} — ${order.number}`;
      await postEntry(
        ctx,
        {
          journalCode: "OD",
          siteId: order.siteId,
          entryDate: ctx.businessDate,
          label,
          sourceType: "SALES_ORDER",
          sourceId: order.id,
          lines: [
            { account: { key: "FINANCE_COMPANY_RECEIVABLE" }, debitCents: f.dealerCommissionCents, creditCents: 0, label },
            { account: { key: "REVENUE_FINANCE_COMMISSION" }, debitCents: 0, creditCents: f.dealerCommissionCents, label, departmentCode: stockType },
          ],
        },
        { brandId: v.brandId },
      );
    }
  }
  let remaining = cashDue(order);
  const deposits = await ctx.tx.payment.findMany({
    where: { sourceType: "SALES_ORDER", sourceId: order.id, direction: "IN", method: { in: [...MONEY_METHODS] } },
    orderBy: { createdAt: "asc" },
  });
  for (const p of deposits) {
    const amount = Math.min(p.amountCents - p.allocatedCents, remaining);
    if (amount <= 0) continue;
    await allocatePayment(ctx, p.id, [{ invoiceId: invoice.id, amountCents: amount }], { trusted: true });
    remaining -= amount;
  }

  // Manufacturer incentive: the OEM reimburses what was deducted on the customer invoice.
  const incentiveCents = -sumCents(quote.lines.filter((l) => l.kind === "OEM_INCENTIVE").map((l) => l.unitPriceCents * l.quantity));
  if (incentiveCents > 0) {
    const oemCustomerId = v.brand?.oemCustomerId;
    if (!oemCustomerId) throw new DomainError("oem_account_missing", `${v.make} has no manufacturer account to claim the incentive from`);
    await createAndIssueInvoice(
      ctx,
      {
        siteId: order.siteId,
        customerId: oemCustomerId,
        sourceType: "OEM_INCENTIVE",
        sourceId: order.id,
        notes: `Incentive claim — order ${order.number}, invoice ${invoiceNumber}, VIN ${v.vin}`,
        lines: [{ label: `Manufacturer incentive — ${vehicleLabel(v)}`, quantity: 1, unitPriceExclVatCents: incentiveCents, vatRateCode: "STANDARD", departmentCode: "VN", revenueKey: "REVENUE_VN" }],
      },
      { trusted: true },
    );
  }

  // Add-ons and accessories: their cost is accrued until the provider's invoice arrives (408100).
  const costOf = (kind: DealLineKind) => sumCents(quote.lines.filter((l) => l.kind === kind).map((l) => l.unitCostCents * l.quantity));
  const accruals = [
    { key: "PURCHASE_ADDON", amountCents: costOf("ADDON") },
    { key: "PURCHASE_ACCESSORY", amountCents: costOf("ACCESSORY") },
  ].filter((a) => a.amountCents > 0);
  if (accruals.length) {
    await postEntry(
      ctx,
      buildPurchaseEntry({
        siteId: order.siteId,
        date: ctx.businessDate,
        label: `Add-ons and accessories — ${order.number}`,
        sourceType: "SALES_ORDER",
        sourceId: order.id,
        lines: accruals.map((a) => ({ account: { key: a.key }, amountCents: a.amountCents, departmentCode: stockType })),
        credit: { account: { key: "GOODS_RECEIVED_NOT_INVOICED" } },
      }),
      { brandId: v.brandId },
    );
  }

  // Police register: the used car leaves the register on its sale.
  if (stockType === "VO") {
    const entry = await ctx.tx.policeRegisterEntry.findFirst({ where: { vehicleId: v.id, outDate: null }, orderBy: { inDate: "desc" } });
    const vehicleLine = quote.lines.find((l) => l.kind === "VEHICLE");
    if (entry) {
      await ctx.tx.policeRegisterEntry.update({
        where: { id: entry.id },
        data: {
          outDate: ctx.businessDate,
          buyerName: order.customer.displayName,
          buyerAddress: partyAddress(order.customer),
          salePriceCents: vehicleLine?.lineInclVatCents ?? invoice.totalInclVatCents,
          saleReference: invoiceNumber,
        },
      });
    }
  }

  const updated = await ctx.tx.salesOrder.update({ where: { id: order.id }, data: { status: "INVOICED", invoiceId: invoice.id, invoicedOn: ctx.businessDate } });
  await ctx.audit({ action: "order.invoice", entityType: "SalesOrder", entityId: order.id, siteId: order.siteId, after: { invoice: invoiceNumber } });
  await ctx.emit({
    type: "SalesOrderInvoiced",
    aggregateType: "SalesOrder",
    aggregateId: order.id,
    siteId: order.siteId,
    payload: { orderId: order.id, number: order.number, invoiceId: invoice.id, invoiceNumber, totalInclVatCents: invoice.totalInclVatCents },
  });
  return updated;
}

/**
 * Hand the car over. Payment check first: the invoice must be fully settled. The vehicle becomes
 * the customer's (a new car gets its plate), and the salesperson's commission is earned.
 */
export async function deliverOrder(ctx: ServiceContext, orderId: string, input: DeliveryInput = {}) {
  const data = parseInput(deliveryInputSchema, input);
  const order = await ctx.tx.salesOrder.findUnique({
    where: { id: orderId },
    include: { invoice: true, vehicle: true, quote: { include: { lines: true, financing: true } } },
  });
  if (!order) throw new NotFoundError("SalesOrder", orderId);
  ctx.require("sales.order", "edit", order.siteId);
  const guard = canDeliverOrder({ status: order.status, invoiceTotalCents: order.invoice?.totalInclVatCents ?? 0, invoicePaidCents: order.invoice?.paidCents ?? 0 });
  if (!guard.ok) throw new ConflictError(guard.reason);
  const v = order.vehicle;
  const mileage = data.mileage ?? v.mileage;
  if (mileage < v.mileage) throw new ValidationError("Mileage cannot go down", { mileage: [`Last known mileage is ${v.mileage} km`] });

  await changeVehicleStatus(ctx, v.id, "DELIVERED", `Delivered — ${order.number}`, { trusted: true });
  await changeVehicleStatus(ctx, v.id, "CUSTOMER", `Owned by the customer — ${order.number}`, { trusted: true });
  const registration = data.registration ?? v.registration ?? (await uniquePlate(ctx.tx, order.number));
  await patchVehicle(
    ctx,
    v.id,
    {
      ownerCustomerId: order.customerId,
      siteId: null,
      listPriceCents: null,
      registration,
      mileage,
      ...(order.stockType === "VN" ? { firstRegistration: ctx.businessDate } : {}),
    },
    { trusted: true },
  );

  const { commission: rules } = await salesSettings(ctx.tx, order.siteId);
  const addOnCount = order.quote.lines.filter((l) => l.kind === "ADDON").reduce((n, l) => n + l.quantity, 0);
  const c = computeCommission(
    { frontEndMarginCents: order.frontEndMarginCents, addOnCount, dealerFinanceCommissionCents: order.quote.financing?.dealerCommissionCents ?? 0 },
    rules,
  );
  if (order.salespersonId) {
    await ctx.tx.commission.create({
      data: {
        salesOrderId: order.id,
        userId: order.salespersonId,
        siteId: order.siteId,
        frontEndCents: c.frontEndCents,
        addOnCents: c.addOnCents,
        financeCents: c.financeCents,
        amountCents: c.totalCents,
        earnedOn: ctx.businessDate,
      },
    });
  }
  const updated = await ctx.tx.salesOrder.update({ where: { id: order.id }, data: { status: "DELIVERED", deliveredOn: ctx.businessDate, deliveryMileage: mileage } });
  await ctx.audit({ action: "order.deliver", entityType: "SalesOrder", entityId: order.id, siteId: order.siteId, after: { registration, mileage, commissionCents: c.totalCents } });
  await ctx.emit({
    type: "SalesOrderDelivered",
    aggregateType: "SalesOrder",
    aggregateId: order.id,
    siteId: order.siteId,
    payload: { orderId: order.id, number: order.number, vehicleId: v.id, customerId: order.customerId, commissionCents: order.salespersonId ? c.totalCents : 0 },
  });
  return updated;
}

/**
 * Cancel a confirmed (not yet invoiced) order: the vehicle goes back on sale (a factory order
 * becomes a stock order), the trade-in is handed back, the lead is lost. Deposits stay on the
 * customer's account for a refund from accounting.
 */
export async function cancelOrder(ctx: ServiceContext, orderId: string, reasonInput: string) {
  const { reason } = parseInput(reasonSchema, { reason: reasonInput });
  const order = await ctx.tx.salesOrder.findUnique({
    where: { id: orderId },
    include: { vehicle: { include: { factoryOrder: true } }, voPurchases: { where: { cancelledOn: null } } },
  });
  if (!order) throw new NotFoundError("SalesOrder", orderId);
  ctx.require("sales.order", "delete", order.siteId);
  const guard = canCancelOrder({ status: order.status });
  if (!guard.ok) throw new ConflictError(guard.reason);

  for (const p of order.voPurchases) await handBackTradeIn(ctx, p.id, order.number);
  const updated = await ctx.tx.salesOrder.update({ where: { id: order.id }, data: { status: "CANCELLED", cancelledOn: ctx.businessDate, cancelReason: reason } });

  const v = order.vehicle;
  const fo = v.factoryOrder;
  if (fo && fo.salesOrderId === order.id) await ctx.tx.factoryOrder.update({ where: { id: fo.id }, data: { salesOrderId: null } });
  const held = await ctx.tx.reservation.findMany({ where: { vehicleId: v.id, status: "ACTIVE" }, select: { id: true } });
  for (const r of held) await releaseReservation(ctx, r.id, "RELEASED", { trusted: true });
  const current = await ctx.tx.vehicle.findUniqueOrThrow({ where: { id: v.id } });
  if (current.status === "RESERVED" && (current.stockType === "VN" || current.stockType === "VO")) {
    const to = releasedStatus({ stockType: current.stockType, stockInDate: current.stockInDate, inTransit: fo?.status === "IN_TRANSIT" });
    await changeVehicleStatus(ctx, v.id, to, `Order ${order.number} cancelled`, { trusted: true });
  }
  await ctx.tx.lead.update({ where: { id: order.leadId }, data: { stage: "LOST", lostReason: `Order cancelled: ${reason}`, closedOn: ctx.businessDate } });

  await ctx.audit({ action: "order.cancel", entityType: "SalesOrder", entityId: order.id, siteId: order.siteId, before: { status: order.status }, after: { status: "CANCELLED", reason } });
  await ctx.emit({ type: "LeadStageChanged", aggregateType: "Lead", aggregateId: order.leadId, siteId: order.siteId, payload: { leadId: order.leadId, from: "WON", to: "LOST", reason } });
  await ctx.emit({ type: "SalesOrderCancelled", aggregateType: "SalesOrder", aggregateId: order.id, siteId: order.siteId, payload: { orderId: order.id, number: order.number, reason } });
  return updated;
}
