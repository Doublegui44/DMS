import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  buildDealLines,
  computeCommission,
  DEFAULT_COMMISSION_RULES,
  expectedVoMargin,
  invoiceLineFor,
  overAllowance,
  priceDeal,
  priceLine,
  type DealStructure,
} from "@/modules/sales/domain/pricing";
import {
  computeFees,
  DEFAULT_ECO_BONUS,
  DEFAULT_ECO_MALUS,
  DEFAULT_REGISTRATION_FEE,
  ecoBonus,
  ecoMalus,
  fiscalHorsepower,
  registrationFee,
} from "@/modules/sales/domain/fees";
import { computeFinancing, monthlyPayment } from "@/modules/sales/domain/financing";
import {
  canApproveRule,
  canCancelOrder,
  canDeliverOrder,
  canInvoiceOrder,
  canQuoteTransition,
  canSetLeadStage,
  isPastDate,
  isQuoteEditable,
  pipelineStage,
  releasedStatus,
  requiredApproval,
  reservationExpiresOn,
} from "@/modules/sales/domain/workflow";

const RATE = 2000;

const vnDeal: DealStructure = {
  stockType: "VN",
  vatRegime: "STANDARD",
  vehicle: { label: "Peugeot 208 Allure", priceCents: 2_500_000, costCents: 2_150_000 },
  options: [{ label: "Metallic paint", priceExclVatCents: 57_500, costCents: 43_125 }],
  accessories: [{ label: "Floor mats", priceExclVatCents: 10_000, costCents: 6_000 }],
  addOns: [{ label: "Warranty 24 months", priceExclVatCents: 59_000, costCents: 32_000, addOnProductId: "a1" }],
  discountInclVatCents: 120_000,
  oemIncentiveExclVatCents: 50_000,
  ecoBonusCents: 0,
  ecoMalusCents: 5_000,
  registrationFeeCents: 30_000,
};

const voDeal: DealStructure = {
  stockType: "VO",
  vatRegime: "MARGIN",
  vehicle: { label: "Renault Clio", priceCents: 1_599_000, costCents: 1_250_000, purchasePriceCents: 1_200_000 },
  options: [],
  accessories: [],
  addOns: [{ label: "Warranty 36 months", priceExclVatCents: 79_000, costCents: 43_000, addOnProductId: "a2" }],
  discountInclVatCents: 49_000,
  oemIncentiveExclVatCents: 0,
  ecoBonusCents: 0,
  ecoMalusCents: 0,
  registrationFeeCents: 20_000,
};

describe("deal pricing", () => {
  it("prices a VN deal with options, discount, incentive, add-on, fees, trade-in and financing", () => {
    const p = priceDeal(vnDeal, {
      standardRateBp: RATE,
      tradeIn: { offerCents: 800_000, marketValueCents: 850_000, estimatedRepairCents: 100_000 },
      financing: { principalCents: 1_500_000, dealerCommissionCents: 37_500 },
    });
    expect(p.lines.map((l) => [l.kind, l.lineExclVatCents, l.vatCents, l.lineInclVatCents])).toEqual([
      ["VEHICLE", 2_500_000, 500_000, 3_000_000],
      ["OPTION", 57_500, 11_500, 69_000],
      ["ACCESSORY", 10_000, 2_000, 12_000],
      ["DISCOUNT", -100_000, -20_000, -120_000],
      ["OEM_INCENTIVE", -50_000, -10_000, -60_000],
      ["ADDON", 59_000, 11_800, 70_800],
      ["ECO_MALUS", 5_000, 0, 5_000],
      ["REGISTRATION_FEE", 30_000, 0, 30_000],
    ]);
    expect(p.totalExclVatCents).toBe(2_511_500);
    expect(p.vatCents).toBe(495_300);
    expect(p.totalInclVatCents).toBe(3_006_800);
    expect(p.listPriceInclVatCents).toBe(3_069_000);
    expect(p.overAllowanceCents).toBe(50_000);
    expect(p.discountBp).toBe(554); // (1 200 + 500 over-allowance) / 30 690
    expect(p.frontEndMarginCents).toBe(218_375);
    expect(p.backEndMarginCents).toBe(64_500);
    expect(p.commission).toEqual({ frontEndCents: 21_838, addOnCents: 5_000, financeCents: 7_500, totalCents: 34_338 });
    expect(p.balanceDueCents).toBe(706_800);
  });

  it("prices a used car under the margin regime (discount reduces the price, VAT on the margin only)", () => {
    const p = priceDeal(voDeal, { standardRateBp: RATE });
    const vehicle = p.lines[0];
    expect(vehicle).toMatchObject({ kind: "VEHICLE", vatMode: "MARGIN", unitPriceCents: 1_550_000, vatCents: 58_333, lineExclVatCents: 1_491_667 });
    expect(p.lines.some((l) => l.kind === "DISCOUNT")).toBe(false);
    expect(p.totalInclVatCents).toBe(1_664_800);
    expect(p.vatCents).toBe(74_133);
    expect(p.discountBp).toBe(306);
    expect(p.frontEndMarginCents).toBe(241_667);
    expect(p.backEndMarginCents).toBe(36_000);
  });

  it("gives no VAT when a used car is sold below its purchase price", () => {
    const l = priceLine({ kind: "VEHICLE", label: "x", quantity: 1, unitPriceCents: 900_000, unitCostCents: 0, vatMode: "MARGIN", purchasePriceCents: 1_000_000 }, RATE);
    expect(l).toMatchObject({ vatCents: 0, lineExclVatCents: 900_000, lineInclVatCents: 900_000 });
  });

  it("keeps fees and the State bonus outside the scope of VAT", () => {
    const lines = buildDealLines({ ...vnDeal, ecoBonusCents: 300_000 }, RATE).map((l) => priceLine(l, RATE));
    const bonus = lines.find((l) => l.kind === "ECO_BONUS")!;
    expect(bonus).toMatchObject({ vatMode: "NONE", vatRateBp: 0, lineInclVatCents: -300_000 });
  });

  it("refuses the margin regime on a new vehicle, negative amounts, excessive discounts and trade-ins", () => {
    expect(() => buildDealLines({ ...vnDeal, vatRegime: "MARGIN" }, RATE)).toThrow(ValidationError);
    expect(() => buildDealLines({ ...vnDeal, discountInclVatCents: -1 }, RATE)).toThrow(ValidationError);
    expect(() => priceDeal({ ...vnDeal, discountInclVatCents: 3_069_000 }, { standardRateBp: RATE })).toThrow(/discount/);
    expect(() =>
      priceDeal(vnDeal, { standardRateBp: RATE, tradeIn: { offerCents: 4_000_000, marketValueCents: 4_000_000, estimatedRepairCents: 0 } }),
    ).toThrow(/trade-in/);
    expect(() =>
      priceDeal(vnDeal, { standardRateBp: RATE, financing: { principalCents: 3_100_000, dealerCommissionCents: 0 } }),
    ).toThrow(/financed/);
  });

  it("computes the trade-in over-allowance", () => {
    expect(overAllowance(null)).toBe(0);
    expect(overAllowance({ offerCents: 700_000, marketValueCents: 850_000, estimatedRepairCents: 100_000 })).toBe(0);
    expect(overAllowance({ offerCents: 900_000, marketValueCents: 850_000, estimatedRepairCents: 100_000 })).toBe(150_000);
  });

  it("never pays commission on a negative front-end margin", () => {
    expect(computeCommission({ frontEndMarginCents: -50_000, addOnCount: 2, dealerFinanceCommissionCents: 10_000 }, DEFAULT_COMMISSION_RULES)).toEqual({
      frontEndCents: 0,
      addOnCents: 10_000,
      financeCents: 2_000,
      totalCents: 12_000,
    });
  });

  it("maps deal lines to invoice lines and revenue keys", () => {
    const p = priceDeal(vnDeal, { standardRateBp: RATE });
    const byKind = Object.fromEntries(p.lines.map((l) => [l.kind, invoiceLineFor(l, "VN")]));
    expect(byKind.VEHICLE).toMatchObject({ revenueKey: "REVENUE_VN", vatRateCode: "STANDARD", departmentCode: "VN", vatRegime: "STANDARD" });
    expect(byKind.DISCOUNT).toMatchObject({ revenueKey: "DISCOUNTS_GRANTED", unitPriceExclVatCents: -100_000 });
    expect(byKind.OEM_INCENTIVE).toMatchObject({ revenueKey: "REVENUE_VN", unitPriceExclVatCents: -50_000 });
    expect(byKind.ADDON).toMatchObject({ revenueKey: "REVENUE_ADDON" });
    expect(byKind.ECO_MALUS).toMatchObject({ revenueKey: "ECO_MALUS_PAYABLE", vatRateCode: "ZERO" });
    expect(byKind.REGISTRATION_FEE).toMatchObject({ revenueKey: "REGISTRATION_FEES", vatRateCode: "ZERO" });
    const vo = priceDeal(voDeal, { standardRateBp: RATE });
    expect(invoiceLineFor(vo.lines[0], "VO")).toMatchObject({ revenueKey: "REVENUE_VO", vatRegime: "MARGIN", purchasePriceCents: 1_200_000, unitPriceExclVatCents: 1_550_000 });
  });

  it("estimates the margin of a used car at its advertised price", () => {
    expect(expectedVoMargin({ listPriceInclCents: 1_599_000, stockValueCents: 1_250_000, purchasePriceCents: 1_200_000, vatRegime: "MARGIN", rateBp: RATE })).toBe(282_500);
    expect(expectedVoMargin({ listPriceInclCents: 1_200_000, stockValueCents: 900_000, purchasePriceCents: 900_000, vatRegime: "STANDARD", rateBp: RATE })).toBe(100_000);
  });
});

describe("fees", () => {
  it("computes fiscal horsepower and the registration fee", () => {
    expect(fiscalHorsepower({ co2: 128, powerHp: 75 })).toBe(5);
    expect(fiscalHorsepower({ co2: 0, powerHp: 156 })).toBe(5);
    expect(registrationFee({ fuel: "PETROL", co2: 128, powerHp: 75 }, DEFAULT_REGISTRATION_FEE)).toBe(1_376 + 5 * 5_100);
    expect(registrationFee({ fuel: "ELECTRIC", co2: 0, powerHp: 156 }, DEFAULT_REGISTRATION_FEE)).toBe(1_376);
  });

  it("applies the CO₂ malus scale", () => {
    expect(ecoMalus(0, DEFAULT_ECO_MALUS)).toBe(0);
    expect(ecoMalus(112, DEFAULT_ECO_MALUS)).toBe(0);
    expect(ecoMalus(113, DEFAULT_ECO_MALUS)).toBe(5_000);
    expect(ecoMalus(128, DEFAULT_ECO_MALUS)).toBe(90_000);
    expect(ecoMalus(250, DEFAULT_ECO_MALUS)).toBe(6_000_000);
  });

  it("grants the bonus to individuals buying an eligible electric car", () => {
    const base = { fuel: "ELECTRIC" as const, priceInclVatCents: 3_900_000, customerKind: "INDIVIDUAL" as const };
    expect(ecoBonus(base, DEFAULT_ECO_BONUS)).toBe(300_000);
    expect(ecoBonus({ ...base, customerKind: "COMPANY" }, DEFAULT_ECO_BONUS)).toBe(0);
    expect(ecoBonus({ ...base, priceInclVatCents: 4_800_000 }, DEFAULT_ECO_BONUS)).toBe(0);
    expect(ecoBonus({ ...base, fuel: "HYBRID" }, DEFAULT_ECO_BONUS)).toBe(0);
  });

  it("charges malus and bonus on new vehicles only, registration on request", () => {
    const rules = { registration: DEFAULT_REGISTRATION_FEE, malus: DEFAULT_ECO_MALUS, bonus: DEFAULT_ECO_BONUS };
    const car = { fuel: "PETROL" as const, co2: 128, powerHp: 75, priceInclVatCents: 2_000_000, customerKind: "INDIVIDUAL" as const };
    expect(computeFees({ ...car, stockType: "VN", includeRegistration: true }, rules)).toEqual({ fiscalHp: 5, registrationFeeCents: 26_876, ecoMalusCents: 90_000, ecoBonusCents: 0 });
    expect(computeFees({ ...car, stockType: "VO", includeRegistration: false }, rules)).toEqual({ fiscalHp: 5, registrationFeeCents: 0, ecoMalusCents: 0, ecoBonusCents: 0 });
  });
});

describe("financing", () => {
  it("computes the monthly payment", () => {
    expect(monthlyPayment({ principalCents: 1_000_000, aprBp: 0, months: 10 })).toBe(100_000);
    expect(monthlyPayment({ principalCents: 1_200_000, aprBp: 600, months: 12 })).toBe(103_280);
    expect(monthlyPayment({ principalCents: 2_000_000, aprBp: 0, months: 36, residualCents: 1_000_000 })).toBe(27_778);
  });

  it("computes totals and the dealer commission", () => {
    const f = computeFinancing(
      { kind: "LOAN", principalCents: 1_200_000, aprBp: 600, months: 12, residualCents: 0, depositCents: 300_000 },
      { commissionBp: 250, minMonths: 12, maxMonths: 84 },
    );
    expect(f).toEqual({ monthlyPaymentCents: 103_280, totalPayableCents: 1_539_360, totalCostCents: 39_360, dealerCommissionCents: 30_000 });
  });

  it("rejects durations out of range and a residual on a loan", () => {
    const s = { commissionBp: 250, minMonths: 12, maxMonths: 84 };
    expect(() => computeFinancing({ kind: "LOAN", principalCents: 1_000_000, aprBp: 500, months: 6, residualCents: 0, depositCents: 0 }, s)).toThrow(ValidationError);
    expect(() => computeFinancing({ kind: "LOAN", principalCents: 1_000_000, aprBp: 500, months: 36, residualCents: 100_000, depositCents: 0 }, s)).toThrow(/residual/);
    expect(() => computeFinancing({ kind: "LEASE", principalCents: 1_000_000, aprBp: 500, months: 36, residualCents: 1_000_000, depositCents: 0 }, s)).toThrow(/residual/);
  });
});

describe("sales workflow", () => {
  const rules = [
    { id: "sm", thresholdBp: 500, roleKey: "SALES_MANAGER" },
    { id: "dp", thresholdBp: 1000, roleKey: "DEALER_PRINCIPAL" },
  ];

  it("follows the quote lifecycle", () => {
    expect(canQuoteTransition("DRAFT", "SENT")).toBe(true);
    expect(canQuoteTransition("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(canQuoteTransition("PENDING_APPROVAL", "DRAFT")).toBe(true);
    expect(canQuoteTransition("SENT", "ACCEPTED")).toBe(true);
    expect(canQuoteTransition("DRAFT", "ACCEPTED")).toBe(false);
    expect(canQuoteTransition("ACCEPTED", "DRAFT")).toBe(false);
    expect(isQuoteEditable("DRAFT")).toBe(true);
    expect(isQuoteEditable("SENT")).toBe(false);
  });

  it("requires approval strictly above each threshold, from the right level", () => {
    expect(requiredApproval(0, rules)).toBeNull();
    expect(requiredApproval(500, rules)).toBeNull();
    expect(requiredApproval(501, rules)?.id).toBe("sm");
    expect(requiredApproval(1000, rules)?.id).toBe("sm");
    expect(requiredApproval(1001, rules)?.id).toBe("dp");
    expect(canApproveRule(rules[0], rules, ["SALES_MANAGER"])).toBe(true);
    expect(canApproveRule(rules[0], rules, ["DEALER_PRINCIPAL"])).toBe(true);
    expect(canApproveRule(rules[1], rules, ["SALES_MANAGER"])).toBe(false);
    expect(canApproveRule(rules[1], rules, ["SALESPERSON"])).toBe(false);
    expect(canApproveRule(rules[1], rules, ["ADMIN"])).toBe(true);
  });

  it("derives the kanban column", () => {
    expect(pipelineStage({ stage: "NEW" }, null)).toBe("NEW");
    expect(pipelineStage({ stage: "WON" }, { status: "CONFIRMED" })).toBe("ORDERED");
    expect(pipelineStage({ stage: "WON" }, { status: "INVOICED" })).toBe("INVOICED");
    expect(pipelineStage({ stage: "WON" }, { status: "DELIVERED" })).toBe("DELIVERED");
    expect(pipelineStage({ stage: "LOST" }, { status: "CANCELLED" })).toBe("LOST");
    expect(pipelineStage({ stage: "QUOTED" }, { status: "CANCELLED" })).toBe("QUOTED");
  });

  it("lets a salesperson move a lead to contacted or lost only", () => {
    expect(canSetLeadStage("NEW", "CONTACTED")).toBe(true);
    expect(canSetLeadStage("CONTACTED", "CONTACTED")).toBe(false);
    expect(canSetLeadStage("QUOTED", "LOST")).toBe(true);
    expect(canSetLeadStage("WON", "LOST")).toBe(false);
    expect(canSetLeadStage("NEW", "WON")).toBe(false);
  });

  it("expires reservations the day after their last valid day", () => {
    const until = reservationExpiresOn(new Date("2026-03-15"), 7);
    expect(until.toISOString().slice(0, 10)).toBe("2026-03-22");
    expect(isPastDate(until, new Date("2026-03-22"))).toBe(false);
    expect(isPastDate(until, new Date("2026-03-23"))).toBe(true);
  });

  it("puts a released vehicle back where it belongs", () => {
    expect(releasedStatus({ stockType: "VO", stockInDate: new Date("2026-01-01") })).toBe("FOR_SALE");
    expect(releasedStatus({ stockType: "VN", stockInDate: new Date("2026-01-01") })).toBe("IN_STOCK");
    expect(releasedStatus({ stockType: "VN", stockInDate: null, inTransit: true })).toBe("IN_TRANSIT");
    expect(releasedStatus({ stockType: "VN", stockInDate: null })).toBe("ORDERED");
  });

  it("guards invoicing, delivery and cancellation", () => {
    expect(canInvoiceOrder({ status: "CONFIRMED", vehicleInStock: false }).ok).toBe(false);
    expect(canInvoiceOrder({ status: "CONFIRMED", vehicleInStock: true }).ok).toBe(true);
    expect(canInvoiceOrder({ status: "INVOICED", vehicleInStock: true }).ok).toBe(false);
    expect(canDeliverOrder({ status: "INVOICED", invoiceTotalCents: 100, invoicePaidCents: 99 })).toEqual({ ok: false, reason: "€0.01 still due on the invoice" });
    expect(canDeliverOrder({ status: "INVOICED", invoiceTotalCents: 100, invoicePaidCents: 100 }).ok).toBe(true);
    expect(canDeliverOrder({ status: "CONFIRMED", invoiceTotalCents: 0, invoicePaidCents: 0 }).ok).toBe(false);
    expect(canCancelOrder({ status: "CONFIRMED" }).ok).toBe(true);
    expect(canCancelOrder({ status: "INVOICED" }).ok).toBe(false);
  });
});
