import type { ServiceContext } from "@/lib/context";
import { ConflictError, DomainError, InvalidTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import { applyRate, formatBp, inclFromExcl, splitIncl, sumCents } from "@/lib/money";
import { parseInput } from "@/lib/validation";
import { nextDocumentNumber } from "@/modules/core";
import { computeFees, type Fuel, type VehicleFees } from "../domain/fees";
import { computeFinancing, type FinancingQuote } from "../domain/financing";
import { priceDeal, type DealPricing, type DealStructure } from "../domain/pricing";
import {
  canApproveRule,
  canQuoteTransition,
  isPastDate,
  isQuoteEditable,
  quoteValidUntil,
  requiredApproval,
  type QuoteStatus,
} from "../domain/workflow";
import { quoteInputSchema, type QuoteData, type QuoteInput } from "../schemas/sales";
import { closeOpenQuotes } from "./leads";
import { releaseReservation, reserveVehicle } from "./reservations";
import { catalogueVersionFor, discountRules, salesSettings, standardRateBp, vehicleLabel, voPurchasePrice } from "./shared";

declare module "@/lib/events" {
  interface DomainEventMap {
    QuoteCreated: { quoteId: string; number: string; leadId: string; totalInclVatCents: number; discountBp: number };
    QuoteStatusChanged: { quoteId: string; number: string; from: string; to: string };
  }
}

/** Vehicle statuses a stock vehicle can be quoted in (availability is checked again at acceptance). */
const QUOTABLE = ["ORDERED", "IN_TRANSIT", "IN_STOCK", "INTAKE", "RECONDITIONING", "FOR_SALE", "RESERVED"];

type LeadForDeal = { id: string; number: string; siteId: string; customerId: string; stage: string; salespersonId: string | null; customer: { kind: "INDIVIDUAL" | "COMPANY" | "OEM" }; site: { code: string } };

export interface FinancingPlanData extends FinancingQuote {
  kind: "LOAN" | "LEASE";
  lender: string;
  aprBp: number;
  months: number;
  principalCents: number;
  residualCents: number;
  depositCents: number;
}

export interface ResolvedDeal {
  structure: DealStructure;
  pricing: DealPricing;
  fees: VehicleFees;
  financing: FinancingPlanData | null;
  tradeIn: QuoteData["tradeIn"];
  vehicleId: string | null;
  catalogueVersionId: string | null;
  rateBp: number;
}

async function loadLead(ctx: ServiceContext, leadId: string): Promise<LeadForDeal> {
  const lead = await ctx.tx.lead.findUnique({ where: { id: leadId }, include: { customer: { select: { kind: true } }, site: { select: { code: true } } } });
  if (!lead) throw new NotFoundError("Lead", leadId);
  return lead;
}

/**
 * Turn a quote input into a priced deal: resolve the vehicle (stock or catalogue), options,
 * add-ons, fees, trade-in and financing, then price everything with the pure pricing domain.
 * Used by the live preview, quote creation and quote edits, so the three always agree.
 */
export async function resolveDeal(ctx: ServiceContext, data: QuoteData, lead: LeadForDeal): Promise<ResolvedDeal> {
  const tx = ctx.tx;
  const rateBp = await standardRateBp(tx, lead.siteId, ctx.businessDate);
  const settings = await salesSettings(tx, lead.siteId);
  const accessories = data.accessories.map((a) => ({ label: a.label, priceExclVatCents: a.priceExclVatCents, costCents: a.costCents }));
  const addOnIds = [...new Set(data.addOnIds)];
  const addOnRows = addOnIds.length ? await tx.addOnProduct.findMany({ where: { id: { in: addOnIds }, active: true } }) : [];
  if (addOnRows.length !== addOnIds.length) throw new ValidationError("Unknown add-on product", { addOnIds: ["Unknown product"] });
  const addOns = addOnRows.map((a) => ({ label: a.name, priceExclVatCents: a.priceExclVatCents, costCents: a.costCents, addOnProductId: a.id }));

  let base: Omit<DealStructure, "ecoBonusCents" | "ecoMalusCents" | "registrationFeeCents">;
  let tech: { fuel: Fuel; co2: number | null; powerHp: number | null };
  let vehicleId: string | null = null;
  let catalogueVersionId: string | null = null;

  if (data.vehicleId) {
    const v = await tx.vehicle.findUnique({ where: { id: data.vehicleId } });
    if (!v) throw new NotFoundError("Vehicle", data.vehicleId);
    if (v.siteId !== lead.siteId) throw new ValidationError("This vehicle is in stock at another site", { vehicleId: ["Vehicle of another site"] });
    if (v.stockType === "NONE" || !QUOTABLE.includes(v.status)) {
      throw new ValidationError(`This vehicle is not for sale (${v.status.toLowerCase()})`, { vehicleId: ["Not for sale"] });
    }
    if (!v.listPriceCents) throw new ValidationError("Set a selling price on this vehicle first", { vehicleId: ["No selling price"] });
    const regime = v.stockType === "VO" ? v.vatRegime : "STANDARD";
    const version = v.stockType === "VN" ? await catalogueVersionFor(tx, v) : null;
    base = {
      stockType: v.stockType,
      vatRegime: regime,
      vehicle: {
        label: vehicleLabel(v),
        // Stock prices are shown incl. VAT; standard-regime lines are priced excl. VAT.
        priceCents: regime === "MARGIN" ? v.listPriceCents : splitIncl(v.listPriceCents, rateBp).exclCents,
        costCents: v.stockValueCents,
        purchasePriceCents: regime === "MARGIN" ? await voPurchasePrice(tx, v) : undefined,
      },
      options: [],
      accessories,
      addOns,
      discountInclVatCents: data.discountInclVatCents,
      oemIncentiveExclVatCents: data.applyOemIncentive && version ? version.oemIncentiveCents : 0,
    };
    tech = { fuel: v.fuel, co2: v.co2 ?? version?.co2 ?? null, powerHp: v.powerHp ?? version?.powerHp ?? null };
    vehicleId = v.id;
  } else {
    const version = await tx.catalogueVersion.findUnique({
      where: { id: data.catalogueVersionId! },
      include: { model: { include: { brand: true } }, options: true },
    });
    if (!version || !version.active || !version.model.active) throw new ValidationError("This version is not available to order", { catalogueVersionId: ["Not available"] });
    const sells = await tx.siteBrand.findUnique({ where: { siteId_brandId: { siteId: lead.siteId, brandId: version.model.brandId } } });
    if (!sells) throw new ValidationError(`This site does not sell ${version.model.brand.name}`, { catalogueVersionId: ["Brand not sold here"] });
    const optionIds = [...new Set(data.optionIds)];
    const options = version.options.filter((o) => optionIds.includes(o.id));
    if (options.length !== optionIds.length) throw new ValidationError("Unknown option for this version", { optionIds: ["Unknown option"] });
    if (options.filter((o) => o.kind === "PAINT").length > 1) throw new ValidationError("Choose one paint only", { optionIds: ["One paint only"] });
    base = {
      stockType: "VN",
      vatRegime: "STANDARD",
      vehicle: { label: `${version.model.brand.name} ${version.model.name} ${version.name}`, priceCents: version.listPriceExclVatCents, costCents: version.dealerCostCents },
      options: options.map((o) => ({ label: o.label, priceExclVatCents: o.listPriceExclVatCents, costCents: o.dealerCostCents, catalogueOptionId: o.id })),
      accessories,
      addOns,
      discountInclVatCents: data.discountInclVatCents,
      oemIncentiveExclVatCents: data.applyOemIncentive ? version.oemIncentiveCents : 0,
    };
    tech = { fuel: version.fuel, co2: version.co2, powerHp: version.powerHp };
    catalogueVersionId = version.id;
  }
  if (base.stockType !== "VN" && base.stockType !== "VO") throw new ValidationError("Only new and used vehicles can be sold");

  if (data.tradeIn) {
    const t = data.tradeIn;
    if (t.vehicleId) {
      const own = await tx.vehicle.findUnique({ where: { id: t.vehicleId } });
      if (!own || own.status !== "CUSTOMER" || own.ownerCustomerId !== lead.customerId) {
        throw new ValidationError("The trade-in must be a car owned by this customer", { "tradeIn.vehicleId": ["Not this customer's car"] });
      }
    } else {
      const known = await tx.vehicle.findUnique({ where: { vin: t.vin } });
      if (known && known.status !== "CUSTOMER") throw new ValidationError("A vehicle with this VIN is in stock", { "tradeIn.vin": ["VIN already in stock"] });
    }
    if (t.vehicleId && t.vehicleId === vehicleId) throw new ValidationError("The trade-in cannot be the vehicle sold");
  }

  // Fees are assessed on what the customer pays for the car itself (vehicle + options − discount).
  const carPriceIncl =
    (base.vatRegime === "MARGIN" ? base.vehicle.priceCents : inclFromExcl(base.vehicle.priceCents + sumCents(base.options.map((o) => o.priceExclVatCents)), rateBp)) -
    base.discountInclVatCents;
  const fees = computeFees(
    { stockType: base.stockType, ...tech, priceInclVatCents: carPriceIncl, customerKind: lead.customer.kind, includeRegistration: data.includeRegistration },
    { registration: settings.registrationFee, malus: settings.ecoMalus, bonus: settings.ecoBonus },
  );
  const structure: DealStructure = { ...base, ecoBonusCents: fees.ecoBonusCents, ecoMalusCents: fees.ecoMalusCents, registrationFeeCents: fees.registrationFeeCents };

  const f = data.financing ?? null;
  if (f && !settings.financing.lenders.includes(f.lender)) throw new ValidationError("Unknown lender", { "financing.lender": ["Choose a partner lender"] });
  const pricing = priceDeal(structure, {
    standardRateBp: rateBp,
    tradeIn: data.tradeIn ? { offerCents: data.tradeIn.offerCents, marketValueCents: data.tradeIn.marketValueCents, estimatedRepairCents: data.tradeIn.estimatedRepairCents } : null,
    financing: f ? { principalCents: f.principalCents, dealerCommissionCents: applyRate(f.principalCents, settings.financing.commissionBp) } : null,
    commissionRules: settings.commission,
  });
  let financing: FinancingPlanData | null = null;
  if (f) {
    const aprBp = f.aprBp ?? settings.financing.defaultAprBp;
    // The customer's own contribution (trade-in + cash) is the "deposit" of the credit offer.
    const depositCents = pricing.totalInclVatCents - f.principalCents;
    const plan = computeFinancing({ kind: f.kind, principalCents: f.principalCents, aprBp, months: f.months, residualCents: f.residualCents, depositCents }, settings.financing);
    financing = { kind: f.kind, lender: f.lender, aprBp, months: f.months, principalCents: f.principalCents, residualCents: f.residualCents, depositCents, ...plan };
  }
  return { structure, pricing, fees, financing, tradeIn: data.tradeIn ?? null, vehicleId, catalogueVersionId, rateBp };
}

function snapshot(p: DealPricing) {
  return {
    listPriceInclVatCents: p.listPriceInclVatCents,
    discountInclVatCents: p.discountInclVatCents,
    discountBp: p.discountBp,
    totalExclVatCents: p.totalExclVatCents,
    vatCents: p.vatCents,
    totalInclVatCents: p.totalInclVatCents,
    tradeInCents: p.tradeInCents,
    financedCents: p.financedCents,
    balanceDueCents: p.balanceDueCents,
    frontEndMarginCents: p.frontEndMarginCents,
    backEndMarginCents: p.backEndMarginCents,
    commissionCents: p.commission.totalCents,
  };
}

function nestedRecords(deal: ResolvedDeal) {
  const t = deal.tradeIn;
  return {
    lines: {
      create: deal.pricing.lines.map((l, i) => ({
        lineNo: i + 1,
        kind: l.kind,
        label: l.label,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        unitCostCents: l.unitCostCents,
        purchasePriceCents: l.purchasePriceCents ?? null,
        vatMode: l.vatMode,
        vatRateBp: l.vatRateBp,
        lineExclVatCents: l.lineExclVatCents,
        vatCents: l.vatCents,
        lineInclVatCents: l.lineInclVatCents,
        catalogueOptionId: l.catalogueOptionId ?? null,
        addOnProductId: l.addOnProductId ?? null,
      })),
    },
    ...(t
      ? {
          tradeIn: {
            create: {
              vehicleId: t.vehicleId ?? null,
              vin: t.vin,
              registration: t.registration ?? null,
              make: t.make,
              model: t.model,
              version: t.version,
              firstRegistration: t.firstRegistration,
              mileage: t.mileage,
              fuel: t.fuel,
              marketValueCents: t.marketValueCents,
              estimatedRepairCents: t.estimatedRepairCents,
              offerCents: t.offerCents,
              notes: t.notes ?? null,
            },
          },
        }
      : {}),
    ...(deal.financing
      ? {
          financing: {
            create: {
              kind: deal.financing.kind,
              lender: deal.financing.lender,
              depositCents: deal.financing.depositCents,
              principalCents: deal.financing.principalCents,
              aprBp: deal.financing.aprBp,
              months: deal.financing.months,
              residualCents: deal.financing.residualCents,
              monthlyPaymentCents: deal.financing.monthlyPaymentCents,
              totalCostCents: deal.financing.totalCostCents,
              totalPayableCents: deal.financing.totalPayableCents,
              dealerCommissionCents: deal.financing.dealerCommissionCents,
            },
          },
        }
      : {}),
  };
}

/** Serializable summary of a priced deal for the quote builder's live preview. */
export interface QuotePreview {
  lines: { kind: string; label: string; quantity: number; unitPriceCents: number; vatMode: string; lineExclVatCents: number; vatCents: number; lineInclVatCents: number }[];
  listPriceInclVatCents: number;
  discountInclVatCents: number;
  overAllowanceCents: number;
  discountBp: number;
  totalExclVatCents: number;
  vatCents: number;
  totalInclVatCents: number;
  tradeInCents: number;
  financedCents: number;
  balanceDueCents: number;
  frontEndMarginCents: number;
  backEndMarginCents: number;
  commissionCents: number;
  fees: VehicleFees;
  financing: FinancingPlanData | null;
  vatRegime: "STANDARD" | "MARGIN";
  approvalRole: string | null;
}

export async function previewQuote(ctx: ServiceContext, input: QuoteInput): Promise<QuotePreview> {
  const data = parseInput(quoteInputSchema, input);
  const lead = await loadLead(ctx, data.leadId);
  ctx.require("sales.quote", "view", lead.siteId);
  const deal = await resolveDeal(ctx, data, lead);
  const approval = requiredApproval(deal.pricing.discountBp, await discountRules(ctx.tx));
  const p = deal.pricing;
  return {
    lines: p.lines.map((l) => ({
      kind: l.kind,
      label: l.label,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      vatMode: l.vatMode,
      lineExclVatCents: l.lineExclVatCents,
      vatCents: l.vatCents,
      lineInclVatCents: l.lineInclVatCents,
    })),
    ...snapshot(p),
    overAllowanceCents: p.overAllowanceCents,
    fees: deal.fees,
    financing: deal.financing,
    vatRegime: deal.structure.vatRegime,
    approvalRole: approval?.roleName ?? null,
  };
}

export async function createQuote(ctx: ServiceContext, input: QuoteInput) {
  const data = parseInput(quoteInputSchema, input);
  const lead = await loadLead(ctx, data.leadId);
  ctx.require("sales.quote", "create", lead.siteId);
  if (data.tradeIn) ctx.require("sales.trade_in", "create", lead.siteId);
  if (lead.stage === "WON" || lead.stage === "LOST") throw new ConflictError(`Lead ${lead.number} is closed`);
  const deal = await resolveDeal(ctx, data, lead);
  const { quoteValidityDays } = await salesSettings(ctx.tx, lead.siteId);
  const number = await nextDocumentNumber(ctx, { docType: "QUOTE", scope: lead.siteId, sitePrefix: lead.site.code });

  const quote = await ctx.tx.quote.create({
    data: {
      number,
      leadId: lead.id,
      siteId: lead.siteId,
      customerId: lead.customerId,
      salespersonId: lead.salespersonId ?? ctx.actor.userId,
      stockType: deal.structure.stockType,
      vehicleId: deal.vehicleId,
      catalogueVersionId: deal.catalogueVersionId,
      colour: data.colour ?? null,
      vatRegime: deal.structure.vatRegime,
      createdOn: ctx.businessDate,
      validUntil: quoteValidUntil(ctx.businessDate, quoteValidityDays),
      notes: data.notes ?? null,
      ...snapshot(deal.pricing),
      ...nestedRecords(deal),
    },
  });
  if (lead.stage === "NEW" || lead.stage === "CONTACTED") {
    await ctx.tx.lead.update({ where: { id: lead.id }, data: { stage: "QUOTED" } });
    await ctx.emit({ type: "LeadStageChanged", aggregateType: "Lead", aggregateId: lead.id, siteId: lead.siteId, payload: { leadId: lead.id, from: lead.stage, to: "QUOTED", reason: `Quote ${number}` } });
  }
  await ctx.audit({ action: "quote.create", entityType: "Quote", entityId: quote.id, siteId: quote.siteId, after: { number, ...snapshot(deal.pricing) } });
  await ctx.emit({
    type: "QuoteCreated",
    aggregateType: "Quote",
    aggregateId: quote.id,
    siteId: quote.siteId,
    payload: { quoteId: quote.id, number, leadId: lead.id, totalInclVatCents: quote.totalInclVatCents, discountBp: quote.discountBp },
  });
  return quote;
}

/** Replace the content of a draft quote (same number). */
export async function updateQuote(ctx: ServiceContext, quoteId: string, input: QuoteInput) {
  const existing = await ctx.tx.quote.findUnique({ where: { id: quoteId } });
  if (!existing) throw new NotFoundError("Quote", quoteId);
  ctx.require("sales.quote", "edit", existing.siteId);
  if (!isQuoteEditable(existing.status as QuoteStatus)) throw new ConflictError("Only draft quotes can be changed: revise the quote first");
  const data = parseInput(quoteInputSchema, { ...input, leadId: existing.leadId });
  if (data.tradeIn) ctx.require("sales.trade_in", "edit", existing.siteId);
  const lead = await loadLead(ctx, existing.leadId);
  const deal = await resolveDeal(ctx, data, lead);

  if (existing.vehicleId && existing.vehicleId !== deal.vehicleId) {
    const held = await ctx.tx.reservation.findMany({ where: { quoteId, status: "ACTIVE" } });
    for (const r of held) await releaseReservation(ctx, r.id, "RELEASED", { trusted: true });
  }
  await ctx.tx.dealLine.deleteMany({ where: { quoteId } });
  await ctx.tx.tradeInAppraisal.deleteMany({ where: { quoteId } });
  await ctx.tx.financingPlan.deleteMany({ where: { quoteId } });
  const quote = await ctx.tx.quote.update({
    where: { id: quoteId },
    data: {
      stockType: deal.structure.stockType,
      vehicleId: deal.vehicleId,
      catalogueVersionId: deal.catalogueVersionId,
      colour: data.colour ?? null,
      vatRegime: deal.structure.vatRegime,
      notes: data.notes ?? null,
      ...snapshot(deal.pricing),
      ...nestedRecords(deal),
    },
  });
  await ctx.audit({ action: "quote.update", entityType: "Quote", entityId: quoteId, siteId: quote.siteId, before: existing, after: snapshot(deal.pricing) });
  return quote;
}

async function setQuoteStatus(ctx: ServiceContext, quote: { id: string; number: string; siteId: string; status: string }, to: QuoteStatus, extra: Record<string, unknown> = {}) {
  const from = quote.status as QuoteStatus;
  if (!canQuoteTransition(from, to)) throw new InvalidTransitionError("Quote", from, to);
  const updated = await ctx.tx.quote.update({ where: { id: quote.id }, data: { status: to, ...extra } });
  await ctx.audit({ action: `quote.${to.toLowerCase()}`, entityType: "Quote", entityId: quote.id, siteId: quote.siteId, before: { status: from }, after: { status: to, ...extra } });
  await ctx.emit({ type: "QuoteStatusChanged", aggregateType: "Quote", aggregateId: quote.id, siteId: quote.siteId, payload: { quoteId: quote.id, number: quote.number, from, to } });
  return updated;
}

/**
 * Send the quote to the customer. Above the discount thresholds (business assumption 7), it first
 * goes to the approver: an ApprovalRequest is opened and the quote waits in PENDING_APPROVAL.
 */
export async function submitQuote(ctx: ServiceContext, quoteId: string) {
  const quote = await ctx.tx.quote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new NotFoundError("Quote", quoteId);
  ctx.require("sales.quote", "edit", quote.siteId);
  if (quote.status !== "DRAFT") throw new InvalidTransitionError("Quote", quote.status, "SENT");
  const { quoteValidityDays } = await salesSettings(ctx.tx, quote.siteId);
  const rule = requiredApproval(quote.discountBp, await discountRules(ctx.tx));
  if (rule) {
    const requestedById = ctx.actor.userId ?? quote.salespersonId;
    if (!requestedById) throw new DomainError("requester_required", "A quote needing approval must have a salesperson");
    await ctx.tx.approvalRequest.create({
      data: {
        ruleId: rule.id,
        entityType: "Quote",
        entityId: quote.id,
        siteId: quote.siteId,
        requestedById,
        businessDate: ctx.businessDate,
        comment: `Effective discount ${formatBp(quote.discountBp, 2, "en-GB")}`,
      },
    });
    return setQuoteStatus(ctx, quote, "PENDING_APPROVAL");
  }
  // Validity runs from the day the customer receives the quote.
  return setQuoteStatus(ctx, quote, "SENT", { sentOn: ctx.businessDate, validUntil: quoteValidUntil(ctx.businessDate, quoteValidityDays) });
}

/** Approve (→ SENT) or reject (→ DRAFT) a discount. The requester cannot approve their own request. */
export async function decideQuoteApproval(ctx: ServiceContext, quoteId: string, decision: "APPROVE" | "REJECT", comment: string | null = null) {
  const quote = await ctx.tx.quote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new NotFoundError("Quote", quoteId);
  ctx.require("sales.quote", "validate", quote.siteId);
  if (quote.status !== "PENDING_APPROVAL") throw new ConflictError("This quote is not waiting for approval");
  const request = await ctx.tx.approvalRequest.findFirst({
    where: { entityType: "Quote", entityId: quoteId, status: "PENDING" },
    include: { rule: { include: { approverRole: true } } },
  });
  if (!request) throw new ConflictError("No pending approval request for this quote");
  const rules = await discountRules(ctx.tx);
  const rule = rules.find((r) => r.id === request.ruleId) ?? { id: request.ruleId, thresholdBp: request.rule.thresholdBp ?? 0, roleKey: request.rule.approverRole.key, roleName: request.rule.approverRole.name };
  if (!canApproveRule(rule, rules, ctx.actor.roleKeys)) {
    throw new DomainError("approval_level", `This discount must be approved by a ${rule.roleName}`);
  }
  if (!ctx.actor.isSystem && request.requestedById === ctx.actor.userId) {
    throw new DomainError("self_approval", "You cannot approve your own discount request");
  }
  await ctx.tx.approvalRequest.update({
    where: { id: request.id },
    data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedById: ctx.actor.userId, decidedAt: ctx.businessDate, comment: comment ?? request.comment },
  });
  if (decision === "REJECT") return setQuoteStatus(ctx, quote, "DRAFT");
  const { quoteValidityDays } = await salesSettings(ctx.tx, quote.siteId);
  return setQuoteStatus(ctx, quote, "SENT", { sentOn: ctx.businessDate, validUntil: quoteValidUntil(ctx.businessDate, quoteValidityDays) });
}

/** The customer declined: the quote is closed and its reservation released. */
export async function declineQuote(ctx: ServiceContext, quoteId: string) {
  const quote = await ctx.tx.quote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new NotFoundError("Quote", quoteId);
  ctx.require("sales.quote", "edit", quote.siteId);
  if (!canQuoteTransition(quote.status as QuoteStatus, "DECLINED")) throw new InvalidTransitionError("Quote", quote.status, "DECLINED");
  await closeOpenQuotes(ctx, [quote.id]);
  await ctx.audit({ action: "quote.declined", entityType: "Quote", entityId: quote.id, siteId: quote.siteId, before: { status: quote.status }, after: { status: "DECLINED" } });
  await ctx.emit({ type: "QuoteStatusChanged", aggregateType: "Quote", aggregateId: quote.id, siteId: quote.siteId, payload: { quoteId: quote.id, number: quote.number, from: quote.status, to: "DECLINED" } });
  return ctx.tx.quote.findUniqueOrThrow({ where: { id: quote.id } });
}

/** Back to draft to change it: from SENT or EXPIRED, or withdraw a pending approval request. */
export async function reviseQuote(ctx: ServiceContext, quoteId: string) {
  const quote = await ctx.tx.quote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new NotFoundError("Quote", quoteId);
  ctx.require("sales.quote", "edit", quote.siteId);
  if (quote.status === "PENDING_APPROVAL") {
    await ctx.tx.approvalRequest.updateMany({
      where: { entityType: "Quote", entityId: quote.id, status: "PENDING" },
      data: { status: "REJECTED", comment: "Withdrawn by the salesperson", decidedAt: ctx.businessDate },
    });
  }
  return setQuoteStatus(ctx, quote, "DRAFT", { sentOn: null });
}

/** End-of-day job: sent quotes past their validity expire. */
export async function expireQuotes(ctx: ServiceContext, asOf: Date = ctx.businessDate): Promise<number> {
  const due = await ctx.tx.quote.findMany({ where: { status: "SENT", validUntil: { lt: asOf } } });
  for (const q of due) await setQuoteStatus(ctx, q, "EXPIRED");
  return due.length;
}

/** Reserve the quoted stock vehicle for the customer. */
export async function reserveQuoteVehicle(ctx: ServiceContext, quoteId: string) {
  const quote = await ctx.tx.quote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new NotFoundError("Quote", quoteId);
  ctx.require("sales.quote", "edit", quote.siteId);
  if (!quote.vehicleId) throw new ValidationError("A vehicle to order from the manufacturer cannot be reserved");
  if (!["DRAFT", "PENDING_APPROVAL", "SENT"].includes(quote.status)) throw new ConflictError("This quote is closed");
  if (isPastDate(quote.validUntil, ctx.businessDate) && quote.status === "SENT") throw new ConflictError("This quote has expired");
  return reserveVehicle(ctx, { vehicleId: quote.vehicleId, customerId: quote.customerId, quoteId: quote.id }, { trusted: true });
}
