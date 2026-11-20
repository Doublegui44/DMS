/**
 * Quote builder state, shared by the server pages (initial drafts) and the client builder.
 * No "use client": server components call these helpers directly.
 */
import { isoDate } from "@/lib/dates";
import type { getQuote, getQuoteFormData } from "@/modules/sales";

export const FUELS = ["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "ELECTRIC", "LPG"] as const;
export type Fuel = (typeof FUELS)[number];

export interface BuilderData {
  leadId: string;
  interest: "VN" | "VO";
  customer: { name: string; kind: string };
  stock: {
    id: string;
    stockType: "VN" | "VO";
    label: string;
    vin: string;
    registration: string | null;
    status: string;
    colour: string | null;
    mileage: number | null;
    listPriceCents: number;
    vatRegime: string;
    oemIncentiveCents: number;
    reservedFor: string | null;
  }[];
  catalogue: {
    id: string;
    label: string;
    versions: {
      id: string;
      name: string;
      fuel: string;
      co2: number | null;
      powerHp: number | null;
      listPriceExclVatCents: number;
      oemIncentiveCents: number;
      leadTimeDays: number;
      options: { id: string; code: string; label: string; kind: string; listPriceExclVatCents: number }[];
    }[];
  }[];
  addOns: { id: string; name: string; kind: string; months: number | null; priceExclVatCents: number }[];
  ownCars: { id: string; vin: string; registration: string | null; make: string; model: string; version: string; firstRegistration: string | null; mileage: number | null; fuel: string }[];
  financing: { lenders: string[]; defaultAprBp: number; commissionBp: number; minMonths: number; maxMonths: number };
  approvalThresholds: { thresholdBp: number; role: string }[];
}

export interface TradeInDraft {
  vehicleId: string;
  vin: string;
  registration: string;
  make: string;
  model: string;
  version: string;
  firstRegistration: string;
  mileage: string;
  fuel: Fuel;
  marketValue: string;
  estimatedRepair: string;
  offer: string;
  notes: string;
}

export interface FinancingDraft {
  kind: "LOAN" | "LEASE";
  lender: string;
  principal: string;
  months: string;
  apr: string;
  residual: string;
}

export interface QuoteDraft {
  source: "STOCK" | "FACTORY";
  vehicleId: string;
  catalogueVersionId: string;
  optionIds: string[];
  colour: string;
  accessories: { label: string; price: string; cost: string }[];
  addOnIds: string[];
  discount: string;
  applyOemIncentive: boolean;
  includeRegistration: boolean;
  tradeIn: TradeInDraft | null;
  financing: FinancingDraft | null;
  notes: string;
}

/** Cents → what a user would type in a money field ("1234.50"). */
export const centsToInput = (cents: number | null | undefined) => (cents ? (cents / 100).toFixed(2) : "");

export function emptyDraft(): QuoteDraft {
  return {
    source: "STOCK",
    vehicleId: "",
    catalogueVersionId: "",
    optionIds: [],
    colour: "",
    accessories: [],
    addOnIds: [],
    discount: "",
    applyOemIncentive: true,
    includeRegistration: true,
    tradeIn: null,
    financing: null,
    notes: "",
  };
}

/** Serializable builder data from the quote form query. */
export function toBuilderData(d: Awaited<ReturnType<typeof getQuoteFormData>>): BuilderData {
  return {
    leadId: d.lead.id,
    interest: d.lead.interest === "VO" ? "VO" : "VN",
    customer: { name: d.lead.customer.displayName, kind: d.lead.customer.kind },
    stock: d.stock,
    catalogue: d.catalogue,
    addOns: d.addOns,
    ownCars: d.ownCars.map((c) => ({ ...c, firstRegistration: c.firstRegistration ? isoDate(c.firstRegistration) : null })),
    financing: d.financing,
    approvalThresholds: d.approvalThresholds,
  };
}

/** A saved draft quote back into builder state (options, add-ons and accessories from its lines). */
export function draftFromQuote(q: Awaited<ReturnType<typeof getQuote>>): QuoteDraft {
  const lines = q.lines;
  const t = q.tradeIn;
  const f = q.financing;
  return {
    source: q.vehicleId ? "STOCK" : "FACTORY",
    vehicleId: q.vehicleId ?? "",
    catalogueVersionId: q.catalogueVersionId ?? "",
    optionIds: lines.filter((l) => l.kind === "OPTION" && l.catalogueOptionId).map((l) => l.catalogueOptionId!),
    colour: q.colour ?? "",
    accessories: lines.filter((l) => l.kind === "ACCESSORY").map((l) => ({ label: l.label, price: centsToInput(l.unitPriceCents), cost: centsToInput(l.unitCostCents) })),
    addOnIds: lines.filter((l) => l.kind === "ADDON" && l.addOnProductId).map((l) => l.addOnProductId!),
    discount: centsToInput(q.discountInclVatCents),
    applyOemIncentive: q.stockType !== "VN" || lines.some((l) => l.kind === "OEM_INCENTIVE"),
    includeRegistration: lines.some((l) => l.kind === "REGISTRATION_FEE"),
    tradeIn: t
      ? {
          vehicleId: t.vehicleId ?? "",
          vin: t.vin,
          registration: t.registration ?? "",
          make: t.make,
          model: t.model,
          version: t.version,
          firstRegistration: t.firstRegistration ? isoDate(t.firstRegistration) : "",
          mileage: String(t.mileage),
          fuel: t.fuel,
          marketValue: centsToInput(t.marketValueCents),
          estimatedRepair: centsToInput(t.estimatedRepairCents),
          offer: centsToInput(t.offerCents),
          notes: t.notes ?? "",
        }
      : null,
    financing: f
      ? {
          kind: f.kind,
          lender: f.lender,
          principal: centsToInput(f.principalCents),
          months: String(f.months),
          apr: (f.aprBp / 100).toFixed(2),
          residual: centsToInput(f.residualCents),
        }
      : null,
    notes: q.notes ?? "",
  };
}
