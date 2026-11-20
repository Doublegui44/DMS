import { z } from "zod";
import { parseEuros } from "@/lib/money";
import { isValidFrenchPlate, isValidVin, normalisePlate, normaliseVin } from "@/modules/core";

export const LEAD_SOURCES = ["WALK_IN", "PHONE", "WEB", "REFERRAL", "RETURNING", "EVENT"] as const;
export const FUELS = ["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "ELECTRIC", "LPG"] as const;
/** Methods for money the dealer takes or pays itself (finance company and trade-in are recorded by sales). */
export const MONEY_METHODS = ["TRANSFER", "CARD", "CHEQUE", "CASH"] as const;

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** Euros typed by the user ("12 500,00") → cents; numbers are cents already (service and CLI callers). */
function toCents(v: unknown): unknown {
  if (v === "" || v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  try {
    return parseEuros(String(v));
  } catch {
    return Number.NaN;
  }
}
const euros = z.preprocess(toCents, z.number({ invalid_type_error: "Invalid amount" }).int("Invalid amount").min(0, "Must be positive").default(0));
const positiveEuros = z.preprocess(
  toCents,
  z.number({ required_error: "Amount is required", invalid_type_error: "Invalid amount" }).int("Invalid amount").positive("Must be positive"),
);
const optionalEuros = z.preprocess(toCents, z.number({ invalid_type_error: "Invalid amount" }).int("Invalid amount").positive("Must be positive").optional());
const optionalDate = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : new Date(String(v))), z.date().nullable());
const int = z.coerce.number({ invalid_type_error: "Must be a number" }).int("Must be a whole number");

const vin = z
  .string({ required_error: "VIN is required" })
  .transform(normaliseVin)
  .refine(isValidVin, "VIN must be 17 characters, without I, O or Q");
const plate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : normalisePlate(v)))
  .refine((v) => v === null || isValidFrenchPlate(v), "Plate format is AB-123-CD")
  .nullable()
  .optional();

// ── Leads ────────────────────────────────────────────────────

export const leadInputSchema = z.object({
  siteId: z.string().min(1, "Site is required"),
  customerId: z.string().min(1, "Customer is required"),
  salespersonId: optionalText,
  source: z.enum(LEAD_SOURCES),
  interest: z.enum(["VN", "VO"]),
  description: optionalText,
});
export type LeadInput = z.input<typeof leadInputSchema>;

// ── Quotes ───────────────────────────────────────────────────

/** The customer's car, appraised. `vehicleId` when it is already known (serviced here, sold by us…). */
export const tradeInInputSchema = z.object({
  vehicleId: optionalText,
  vin,
  registration: plate,
  make: z.string().trim().min(1, "Make is required"),
  model: z.string().trim().min(1, "Model is required"),
  version: z.string().trim().default(""),
  firstRegistration: optionalDate,
  mileage: int.min(0, "Mileage cannot be negative"),
  fuel: z.enum(FUELS),
  marketValueCents: positiveEuros,
  estimatedRepairCents: euros,
  offerCents: positiveEuros,
  notes: optionalText,
});
export type TradeInInput = z.input<typeof tradeInInputSchema>;

export const financingInputSchema = z.object({
  kind: z.enum(["LOAN", "LEASE"]).default("LOAN"),
  lender: z.string().trim().min(1, "Choose a lender"),
  principalCents: positiveEuros,
  months: int,
  /** Defaults to the lender's standard rate (settings). */
  aprBp: int.min(0).max(3_000).optional(),
  residualCents: euros,
});
export type FinancingInput = z.input<typeof financingInputSchema>;

export const quoteInputSchema = z
  .object({
    leadId: z.string().min(1),
    /** A stock vehicle (VN in stock or on order, VO for sale)… */
    vehicleId: optionalText,
    /** …or a new vehicle to order from the manufacturer. */
    catalogueVersionId: optionalText,
    optionIds: z.array(z.string()).default([]),
    colour: optionalText,
    accessories: z
      .array(z.object({ label: z.string().trim().min(1, "Label is required").max(120), priceExclVatCents: euros, costCents: euros }))
      .default([]),
    addOnIds: z.array(z.string()).default([]),
    discountInclVatCents: euros,
    applyOemIncentive: z.boolean().default(true),
    includeRegistration: z.boolean().default(true),
    tradeIn: tradeInInputSchema.nullable().optional(),
    financing: financingInputSchema.nullable().optional(),
    notes: optionalText,
  })
  .refine((q) => !!q.vehicleId !== !!q.catalogueVersionId, { message: "Choose a stock vehicle or a version to order", path: ["vehicleId"] });
export type QuoteInput = z.input<typeof quoteInputSchema>;
export type QuoteData = z.output<typeof quoteInputSchema>;

// ── Orders ───────────────────────────────────────────────────

export const depositInputSchema = z.object({
  amountCents: positiveEuros,
  method: z.enum(MONEY_METHODS),
  reference: optionalText,
});
export type DepositInput = z.input<typeof depositInputSchema>;

export const deliveryInputSchema = z.object({
  mileage: z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), int.min(0).optional()),
  registration: plate,
});
export type DeliveryInput = z.input<typeof deliveryInputSchema>;

export const reasonSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(300) });

// ── New-vehicle stock ────────────────────────────────────────

export const stockOrderInputSchema = z.object({
  siteId: z.string().min(1, "Site is required"),
  catalogueVersionId: z.string().min(1, "Choose a version"),
  optionIds: z.array(z.string()).default([]),
  colour: optionalText,
});
export type StockOrderInput = z.input<typeof stockOrderInputSchema>;

export const receiveVehicleSchema = z.object({
  /** Manufacturer's invoice amount excl. VAT; defaults to the expected dealer cost. */
  costCents: optionalEuros,
});
export type ReceiveVehicleInput = z.input<typeof receiveVehicleSchema>;

// ── Used-vehicle stock ───────────────────────────────────────

export const voVehicleSchema = z.object({
  vin,
  registration: plate,
  brandId: optionalText,
  make: z.string().trim().min(1, "Make is required"),
  model: z.string().trim().min(1, "Model is required"),
  version: z.string().trim().default(""),
  firstRegistration: optionalDate,
  mileage: int.min(0),
  fuel: z.enum(FUELS),
  co2: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), int.min(0).nullable()),
  powerHp: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), int.min(0).nullable()),
  colour: optionalText,
});

export const voPurchaseInputSchema = z
  .object({
    siteId: z.string().min(1, "Site is required"),
    source: z.enum(["PRIVATE", "PROFESSIONAL"]),
    /** Private seller (a customer record). */
    customerId: optionalText,
    /** Professional seller. */
    supplierId: optionalText,
    /** Professional seller: STANDARD if it charges VAT (resold with VAT), MARGIN otherwise. Private: always MARGIN. */
    vatRegime: z.enum(["STANDARD", "MARGIN"]).default("MARGIN"),
    priceCents: positiveEuros,
    supplierReference: optionalText,
    /** A private seller is paid at once. */
    paymentMethod: z.enum(["TRANSFER", "CHEQUE"]).default("TRANSFER"),
    listPriceCents: optionalEuros,
    vehicle: voVehicleSchema,
  })
  .superRefine((p, ctx) => {
    if (p.source === "PRIVATE" && !p.customerId) ctx.addIssue({ code: "custom", path: ["customerId"], message: "Choose the seller" });
    if (p.source === "PRIVATE" && p.vatRegime !== "MARGIN") ctx.addIssue({ code: "custom", path: ["vatRegime"], message: "A private seller charges no VAT" });
    if (p.source === "PROFESSIONAL" && !p.supplierId) ctx.addIssue({ code: "custom", path: ["supplierId"], message: "Choose the supplier" });
  });
export type VoPurchaseInput = z.input<typeof voPurchaseInputSchema>;

export const vehicleCostInputSchema = z.object({
  kind: z.enum(["RECONDITIONING", "TRANSPORT", "OTHER"]),
  label: z.string().trim().min(2, "Label is required").max(120),
  amountCents: positiveEuros,
  supplierId: z.string().min(1, "Supplier is required"),
  supplierReference: optionalText,
});
export type VehicleCostInput = z.input<typeof vehicleCostInputSchema>;

export const repriceInputSchema = z.object({
  listPriceCents: positiveEuros,
  reason: optionalText,
});
export type RepriceInput = z.input<typeof repriceInputSchema>;
