/**
 * Deal pricing (pure): builds the lines of a VN/VO deal, prices them (standard VAT, VAT on margin,
 * outside the scope of VAT), and computes totals, discount level, front/back-end margin and the
 * salesperson commission. Amounts in cents, rates in basis points.
 */
import { applyRate, inclFromExcl, ratioBp, splitIncl, sumCents, type Cents } from "@/lib/money";
import { ValidationError } from "@/lib/errors";
import { marginVat } from "@/modules/accounting";

export type DealLineKind =
  | "VEHICLE"
  | "OPTION"
  | "ACCESSORY"
  | "DISCOUNT"
  | "OEM_INCENTIVE"
  | "ECO_BONUS"
  | "ECO_MALUS"
  | "REGISTRATION_FEE"
  | "ADDON";

/** STANDARD: price excl. VAT · MARGIN: price incl. VAT, VAT on the margin · NONE: no VAT (taxes, fees, State bonus). */
export type DealVatMode = "STANDARD" | "MARGIN" | "NONE";
export type VatRegime = "STANDARD" | "MARGIN";
export type StockKind = "VN" | "VO";

export interface DealLineDraft {
  kind: DealLineKind;
  label: string;
  quantity: number;
  unitPriceCents: Cents;
  unitCostCents: Cents;
  vatMode: DealVatMode;
  purchasePriceCents?: Cents | null;
  catalogueOptionId?: string | null;
  addOnProductId?: string | null;
}

export interface PricedLine extends DealLineDraft {
  vatRateBp: number;
  lineExclVatCents: Cents;
  vatCents: Cents;
  lineInclVatCents: Cents;
}

export function priceLine(line: DealLineDraft, standardRateBp: number): PricedLine {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new RangeError("Quantity must be a positive integer");
  const gross = line.quantity * line.unitPriceCents;
  if (line.vatMode === "NONE") {
    return { ...line, vatRateBp: 0, lineExclVatCents: gross, vatCents: 0, lineInclVatCents: gross };
  }
  if (line.vatMode === "MARGIN") {
    const { vatCents } = marginVat({ salePriceInclCents: gross, purchasePriceCents: line.purchasePriceCents ?? 0, rateBp: standardRateBp });
    return { ...line, vatRateBp: standardRateBp, lineExclVatCents: gross - vatCents, vatCents, lineInclVatCents: gross };
  }
  const vatCents = applyRate(gross, standardRateBp);
  return { ...line, vatRateBp: standardRateBp, lineExclVatCents: gross, vatCents, lineInclVatCents: gross + vatCents };
}

/** What a deal is made of, once the service has resolved vehicle, catalogue and settings. */
export interface DealStructure {
  stockType: StockKind;
  /** MARGIN only for a used vehicle bought without VAT. */
  vatRegime: VatRegime;
  vehicle: {
    label: string;
    /** Excl. VAT; incl. VAT under the margin regime. */
    priceCents: Cents;
    costCents: Cents;
    /** Margin regime: purchase price, base of the VAT on margin. */
    purchasePriceCents?: Cents;
  };
  options: { label: string; priceExclVatCents: Cents; costCents: Cents; catalogueOptionId?: string }[];
  accessories: { label: string; priceExclVatCents: Cents; costCents: Cents }[];
  addOns: { label: string; priceExclVatCents: Cents; costCents: Cents; addOnProductId: string }[];
  /** Dealer discount as the customer sees it (incl. VAT). */
  discountInclVatCents: Cents;
  /** OEM-funded incentive (excl. VAT), reimbursed by the OEM. */
  oemIncentiveExclVatCents: Cents;
  ecoBonusCents: Cents;
  ecoMalusCents: Cents;
  registrationFeeCents: Cents;
}

/**
 * Deal → lines. Under the margin regime the discount reduces the vehicle price itself (the margin
 * is computed on the price actually paid); under standard VAT it is a separate negative line.
 */
export function buildDealLines(d: DealStructure, standardRateBp: number): DealLineDraft[] {
  const amounts = [
    d.vehicle.priceCents,
    d.vehicle.costCents,
    d.discountInclVatCents,
    d.oemIncentiveExclVatCents,
    d.ecoBonusCents,
    d.ecoMalusCents,
    d.registrationFeeCents,
    ...d.options.flatMap((o) => [o.priceExclVatCents, o.costCents]),
    ...d.accessories.flatMap((a) => [a.priceExclVatCents, a.costCents]),
    ...d.addOns.flatMap((a) => [a.priceExclVatCents, a.costCents]),
  ];
  if (amounts.some((a) => !Number.isSafeInteger(a) || a < 0)) throw new ValidationError("Amounts must be positive cents");
  if (d.vatRegime === "MARGIN" && d.stockType !== "VO") throw new ValidationError("Only used vehicles can be sold under the margin regime");

  const margin = d.vatRegime === "MARGIN";
  const lines: DealLineDraft[] = [
    {
      kind: "VEHICLE",
      label: d.vehicle.label,
      quantity: 1,
      unitPriceCents: margin ? d.vehicle.priceCents - d.discountInclVatCents : d.vehicle.priceCents,
      unitCostCents: d.vehicle.costCents,
      vatMode: margin ? "MARGIN" : "STANDARD",
      purchasePriceCents: margin ? d.vehicle.purchasePriceCents ?? 0 : null,
    },
  ];
  for (const o of d.options) {
    lines.push({ kind: "OPTION", label: o.label, quantity: 1, unitPriceCents: o.priceExclVatCents, unitCostCents: o.costCents, vatMode: "STANDARD", catalogueOptionId: o.catalogueOptionId ?? null });
  }
  for (const a of d.accessories) {
    lines.push({ kind: "ACCESSORY", label: a.label, quantity: 1, unitPriceCents: a.priceExclVatCents, unitCostCents: a.costCents, vatMode: "STANDARD" });
  }
  if (!margin && d.discountInclVatCents > 0) {
    const { exclCents } = splitIncl(d.discountInclVatCents, standardRateBp);
    lines.push({ kind: "DISCOUNT", label: "Dealer discount", quantity: 1, unitPriceCents: -exclCents, unitCostCents: 0, vatMode: "STANDARD" });
  }
  if (d.oemIncentiveExclVatCents > 0) {
    lines.push({ kind: "OEM_INCENTIVE", label: "Manufacturer incentive", quantity: 1, unitPriceCents: -d.oemIncentiveExclVatCents, unitCostCents: 0, vatMode: "STANDARD" });
  }
  for (const a of d.addOns) {
    lines.push({ kind: "ADDON", label: a.label, quantity: 1, unitPriceCents: a.priceExclVatCents, unitCostCents: a.costCents, vatMode: "STANDARD", addOnProductId: a.addOnProductId });
  }
  if (d.ecoMalusCents > 0) lines.push({ kind: "ECO_MALUS", label: "Environmental malus (CO₂)", quantity: 1, unitPriceCents: d.ecoMalusCents, unitCostCents: 0, vatMode: "NONE" });
  if (d.registrationFeeCents > 0) lines.push({ kind: "REGISTRATION_FEE", label: "Registration certificate (pass-through)", quantity: 1, unitPriceCents: d.registrationFeeCents, unitCostCents: 0, vatMode: "NONE" });
  if (d.ecoBonusCents > 0) lines.push({ kind: "ECO_BONUS", label: "Environmental bonus (advanced by the dealer)", quantity: 1, unitPriceCents: -d.ecoBonusCents, unitCostCents: 0, vatMode: "NONE" });
  return lines;
}

export interface TradeInValues {
  offerCents: Cents;
  marketValueCents: Cents;
  estimatedRepairCents: Cents;
}

/** Over-allowance: what the dealer pays for the trade-in above its net value (market − repairs). A hidden discount. */
export function overAllowance(t: TradeInValues | null | undefined): Cents {
  if (!t) return 0;
  return Math.max(0, t.offerCents - Math.max(0, t.marketValueCents - t.estimatedRepairCents));
}

export interface CommissionRules {
  /** Share of the front-end margin, bp. */
  frontEndMarginBp: number;
  /** Fixed amount per add-on product sold. */
  perAddOnCents: Cents;
  /** Share of the dealer's financing commission, bp. */
  financeCommissionBp: number;
}

export const DEFAULT_COMMISSION_RULES: CommissionRules = { frontEndMarginBp: 1000, perAddOnCents: 5000, financeCommissionBp: 2000 };

export interface Commission {
  frontEndCents: Cents;
  addOnCents: Cents;
  financeCents: Cents;
  totalCents: Cents;
}

/** Business assumption 9: 10 % of the front-end margin (never negative) + €50 per add-on + 20 % of the financing commission. */
export function computeCommission(args: { frontEndMarginCents: Cents; addOnCount: number; dealerFinanceCommissionCents: Cents }, rules: CommissionRules): Commission {
  const frontEndCents = applyRate(Math.max(0, args.frontEndMarginCents), rules.frontEndMarginBp);
  const addOnCents = args.addOnCount * rules.perAddOnCents;
  const financeCents = applyRate(Math.max(0, args.dealerFinanceCommissionCents), rules.financeCommissionBp);
  return { frontEndCents, addOnCents, financeCents, totalCents: frontEndCents + addOnCents + financeCents };
}

export interface DealPricing {
  lines: PricedLine[];
  totalExclVatCents: Cents;
  vatCents: Cents;
  totalInclVatCents: Cents;
  /** Vehicle + options at list price, incl. VAT. */
  listPriceInclVatCents: Cents;
  discountInclVatCents: Cents;
  overAllowanceCents: Cents;
  /** Effective discount (dealer discount + trade-in over-allowance) / list price. Drives approvals. */
  discountBp: number;
  tradeInCents: Cents;
  financedCents: Cents;
  /** What the customer still pays out of pocket: total − trade-in − financed amount. */
  balanceDueCents: Cents;
  frontEndMarginCents: Cents;
  backEndMarginCents: Cents;
  commission: Commission;
}

const FRONT_END_KINDS: DealLineKind[] = ["VEHICLE", "OPTION", "ACCESSORY", "DISCOUNT"];

/**
 * Price a deal. Front-end margin = vehicle, options and accessories (net of the dealer discount,
 * excl. VAT) − their cost − trade-in over-allowance. The OEM incentive is neutral (the OEM pays it
 * back). Back-end margin = add-ons (price − cost) + the dealer's financing commission.
 */
export function priceDeal(
  d: DealStructure,
  ctx: {
    standardRateBp: number;
    tradeIn?: TradeInValues | null;
    financing?: { principalCents: Cents; dealerCommissionCents: Cents } | null;
    commissionRules?: CommissionRules;
  },
): DealPricing {
  const rate = ctx.standardRateBp;
  const listPriceInclVatCents =
    d.vatRegime === "MARGIN"
      ? d.vehicle.priceCents
      : inclFromExcl(d.vehicle.priceCents + sumCents(d.options.map((o) => o.priceExclVatCents)), rate);
  if (d.discountInclVatCents >= listPriceInclVatCents && listPriceInclVatCents > 0) {
    throw new ValidationError("The discount cannot exceed the list price", { discountInclVatCents: ["Too high"] });
  }
  const lines = buildDealLines(d, rate).map((l) => priceLine(l, rate));
  const totalExclVatCents = sumCents(lines.map((l) => l.lineExclVatCents));
  const vatCents = sumCents(lines.map((l) => l.vatCents));
  const totalInclVatCents = totalExclVatCents + vatCents;
  if (totalInclVatCents <= 0) throw new ValidationError("The deal total must be positive");

  const tradeInCents = ctx.tradeIn?.offerCents ?? 0;
  if (tradeInCents > totalInclVatCents) {
    throw new ValidationError("The trade-in exceeds the deal total; reduce the offer", { tradeInOfferCents: ["Higher than the deal total"] });
  }
  const financedCents = ctx.financing?.principalCents ?? 0;
  if (financedCents > totalInclVatCents - tradeInCents) {
    throw new ValidationError("The financed amount exceeds what the customer owes", { financing: ["Too high"] });
  }

  const overAllowanceCents = overAllowance(ctx.tradeIn);
  const frontRevenue = sumCents(lines.filter((l) => FRONT_END_KINDS.includes(l.kind)).map((l) => l.lineExclVatCents));
  const frontCost = sumCents(lines.filter((l) => FRONT_END_KINDS.includes(l.kind)).map((l) => l.unitCostCents * l.quantity));
  const frontEndMarginCents = frontRevenue - frontCost - overAllowanceCents;
  const addOns = lines.filter((l) => l.kind === "ADDON");
  const dealerFinance = ctx.financing?.dealerCommissionCents ?? 0;
  const backEndMarginCents = sumCents(addOns.map((l) => l.lineExclVatCents - l.unitCostCents * l.quantity)) + dealerFinance;
  const commission = computeCommission(
    { frontEndMarginCents, addOnCount: addOns.reduce((n, l) => n + l.quantity, 0), dealerFinanceCommissionCents: dealerFinance },
    ctx.commissionRules ?? DEFAULT_COMMISSION_RULES,
  );

  return {
    lines,
    totalExclVatCents,
    vatCents,
    totalInclVatCents,
    listPriceInclVatCents,
    discountInclVatCents: d.discountInclVatCents,
    overAllowanceCents,
    discountBp: ratioBp(d.discountInclVatCents + overAllowanceCents, listPriceInclVatCents),
    tradeInCents,
    financedCents,
    balanceDueCents: totalInclVatCents - tradeInCents - financedCents,
    frontEndMarginCents,
    backEndMarginCents,
    commission,
  };
}

/** Accounting treatment of each deal line on the customer invoice (keys resolved by AccountMapping). */
export function invoiceLineFor(
  line: Pick<PricedLine, "kind" | "label" | "quantity" | "unitPriceCents" | "vatMode" | "purchasePriceCents">,
  stockType: StockKind,
): {
  label: string;
  quantity: number;
  unitPriceExclVatCents: Cents;
  vatRateCode: string;
  vatRegime: VatRegime;
  departmentCode: StockKind;
  revenueKey: string;
  purchasePriceCents?: Cents;
} {
  const revenueKey: Record<DealLineKind, string> = {
    VEHICLE: stockType === "VN" ? "REVENUE_VN" : "REVENUE_VO",
    OPTION: "REVENUE_VN",
    ACCESSORY: stockType === "VN" ? "REVENUE_VN" : "REVENUE_VO",
    DISCOUNT: "DISCOUNTS_GRANTED",
    OEM_INCENTIVE: "REVENUE_VN",
    ADDON: "REVENUE_ADDON",
    ECO_BONUS: "ECO_BONUS_RECEIVABLE",
    ECO_MALUS: "ECO_MALUS_PAYABLE",
    REGISTRATION_FEE: "REGISTRATION_FEES",
  };
  return {
    label: line.label,
    quantity: line.quantity,
    unitPriceExclVatCents: line.unitPriceCents,
    vatRateCode: line.vatMode === "NONE" ? "ZERO" : "STANDARD",
    vatRegime: line.vatMode === "MARGIN" ? "MARGIN" : "STANDARD",
    departmentCode: stockType,
    revenueKey: revenueKey[line.kind],
    ...(line.vatMode === "MARGIN" ? { purchasePriceCents: line.purchasePriceCents ?? 0 } : {}),
  };
}

/** Expected front-end margin of a used vehicle sold at its advertised price (VO stock screen). */
export function expectedVoMargin(args: { listPriceInclCents: Cents; stockValueCents: Cents; purchasePriceCents: Cents; vatRegime: VatRegime; rateBp: number }): Cents {
  const excl =
    args.vatRegime === "MARGIN"
      ? args.listPriceInclCents - marginVat({ salePriceInclCents: args.listPriceInclCents, purchasePriceCents: args.purchasePriceCents, rateBp: args.rateBp }).vatCents
      : splitIncl(args.listPriceInclCents, args.rateBp).exclCents;
  return excl - args.stockValueCents;
}
