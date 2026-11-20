import { z } from "zod";
import { parseEuros } from "@/lib/money";
import { CASH_METHODS } from "@/modules/accounting";
import { DAMAGE_ZONES, parseDamages } from "../domain/checkin";
import { JOB_PAYERS } from "../domain/pricing";
import { parseHhmm } from "../domain/time";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const optionalId = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().nullable().optional());

function toCents(v: unknown): unknown {
  if (v === "" || v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  try {
    return parseEuros(String(v));
  } catch {
    return Number.NaN;
  }
}
const euros = z.preprocess(toCents, z.number({ required_error: "Amount is required", invalid_type_error: "Invalid amount" }).int("Invalid amount").min(0, "Cannot be negative"));

/** Hours typed by the user ("1.5", "0,8") → centi-hours; numbers are centi-hours already. */
function toCentiHours(v: unknown): unknown {
  if (v === "" || v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}
const hours = z.preprocess(toCentiHours, z.number({ required_error: "Time is required", invalid_type_error: "Invalid time" }).int().positive("Must be more than zero").max(10_000, "Too long"));
const optionalHours = z.preprocess(toCentiHours, z.number({ invalid_type_error: "Invalid time" }).int().positive("Must be more than zero").max(10_000).optional());

/** "HH:MM" → minutes after midnight; numbers are minutes already. */
const clockTime = z.preprocess(
  (v) => {
    if (typeof v === "number") return v;
    try {
      return parseHhmm(String(v ?? ""));
    } catch {
      return Number.NaN;
    }
  },
  z.number({ invalid_type_error: "Enter a time as HH:MM" }).int().min(0).max(1439),
);
const date = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : new Date(String(v))), z.date({ required_error: "Date is required", invalid_type_error: "Invalid date" }));
const optionalDate = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : new Date(String(v))), z.date({ invalid_type_error: "Invalid date" }).nullable().optional());
const bool = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean());
const qty = z.preprocess(
  (v) => (typeof v === "number" ? String(v) : typeof v === "string" ? v.trim().replace(",", ".") : v),
  z.string({ required_error: "Quantity is required" }).regex(/^\d+(\.\d{1,3})?$/, "Enter a quantity with at most 3 decimals").refine((s) => Number(s) > 0, "Must be more than zero"),
);
const discountBp = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? 0 : typeof v === "number" ? v : Math.round(Number(String(v).replace(",", ".")) * 100)),
  z.number({ invalid_type_error: "Invalid discount" }).int().min(0).max(10_000, "At most 100 %"),
);

// ── Catalogue ───────────────────────────────────────────────

export const labourOperationInputSchema = z.object({
  code: z.string().trim().toUpperCase().min(2, "Code is required").max(20),
  label: z.string().trim().min(2, "Label is required").max(120),
  category: z.string().trim().min(2, "Category is required").max(40),
  brandId: optionalId,
  standardCentiHours: hours,
  active: bool.optional(),
});
export type LabourOperationInput = z.input<typeof labourOperationInputSchema>;

export const technicianInputSchema = z.object({
  userId: z.string().min(1),
  siteId: z.string().min(1),
  dailyCapacityCentiHours: hours,
  active: bool.optional(),
});
export type TechnicianInput = z.input<typeof technicianInputSchema>;

// ── Appointments ────────────────────────────────────────────

export const appointmentInputSchema = z.object({
  siteId: z.string().min(1, "Site is required"),
  customerId: z.string().min(1, "Customer is required"),
  vehicleId: z.string().min(1, "Vehicle is required"),
  technicianId: optionalId,
  bayId: optionalId,
  date,
  startMinute: clockTime,
  plannedCentiHours: hours,
  concern: z.string().trim().min(3, "Describe the customer's request").max(500),
});
export type AppointmentInput = z.input<typeof appointmentInputSchema>;

// ── Check-in ────────────────────────────────────────────────

const damages = z.preprocess(
  (v) => {
    if (Array.isArray(v)) return v;
    try {
      return parseDamages(String(v ?? ""));
    } catch {
      return "invalid";
    }
  },
  z.array(z.object({ zone: z.enum(DAMAGE_ZONES), note: z.string().max(200) }), { invalid_type_error: `Zones: ${DAMAGE_ZONES.join(", ")}` }).max(20),
);

export const checkInInputSchema = z
  .object({
    siteId: z.string().min(1, "Site is required"),
    kind: z.enum(["CUSTOMER", "INTERNAL"]).default("CUSTOMER"),
    appointmentId: optionalId,
    customerId: optionalId,
    vehicleId: z.string().min(1, "Vehicle is required"),
    mileageIn: z.coerce.number({ invalid_type_error: "Enter the odometer reading" }).int("Whole km").min(0),
    fuelLevelPct: z.coerce.number().int().min(0).max(100),
    damages: damages.default([]),
    signedBy: optionalText,
    signatureDataUrl: z.preprocess((v) => (v === "" ? null : v), z.string().max(200_000).startsWith("data:image/", "Invalid signature").nullable().optional()),
    promisedOn: optionalDate,
    notes: optionalText,
    /** First job, from the appointment's concern or typed at the desk. */
    concern: optionalText,
  })
  .refine((c) => c.kind === "INTERNAL" || !!c.customerId, { message: "Customer is required", path: ["customerId"] })
  .refine((c) => c.kind === "INTERNAL" || !!c.signedBy, { message: "The customer signs the check-in", path: ["signedBy"] });
export type CheckInInput = z.input<typeof checkInInputSchema>;

// ── Jobs and lines ──────────────────────────────────────────

export const jobInputSchema = z
  .object({
    description: z.string().trim().min(2, "Describe the job").max(200),
    payer: z.enum(JOB_PAYERS).default("CUSTOMER"),
    payerCustomerId: optionalId,
    technicianId: optionalId,
    isAdditional: bool.default(false),
  })
  .refine((j) => j.payer !== "INSURANCE" || !!j.payerCustomerId, { message: "Choose the insurer", path: ["payerCustomerId"] });
export type JobInput = z.input<typeof jobInputSchema>;

export const labourLineInputSchema = z
  .object({
    operationCode: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() || null : v), z.string().nullable().optional()),
    label: optionalText,
    centiHours: optionalHours,
    discountBp,
  })
  .refine((l) => !!l.operationCode || (!!l.label && !!l.centiHours), { message: "Choose an operation or enter a label and a time", path: ["operationCode"] });
export type LabourLineInput = z.input<typeof labourLineInputSchema>;

export const roPartLineInputSchema = z.object({
  partNumber: z.string({ required_error: "Part number is required" }).trim().min(3, "Part number is required").max(30),
  qty,
});
export type RoPartLineInput = z.input<typeof roPartLineInputSchema>;

export const subletLineInputSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  label: z.string().trim().min(2, "Label is required").max(120),
  costCents: euros,
  priceCents: euros,
  supplierReference: optionalText,
});
export type SubletLineInput = z.input<typeof subletLineInputSchema>;

export const jobDecisionInputSchema = z.object({ approve: bool, note: optionalText });
export type JobDecisionInput = z.input<typeof jobDecisionInputSchema>;

export const qualityCheckInputSchema = z.object({ pass: bool, notes: optionalText });
export type QualityCheckInput = z.input<typeof qualityCheckInputSchema>;

export const roInvoiceInputSchema = z.object({
  /** Paid at the desk now; empty = on the customer's account. */
  paymentMethod: z.preprocess((v) => (v === "" || v === "ACCOUNT" ? undefined : v), z.enum(CASH_METHODS).optional()),
});
export type RoInvoiceInput = z.input<typeof roInvoiceInputSchema>;

export const roPaymentInputSchema = z.object({ method: z.enum(CASH_METHODS).default("CARD") });
export type RoPaymentInput = z.input<typeof roPaymentInputSchema>;

// ── Clocking ────────────────────────────────────────────────

export const clockOnInputSchema = z.object({
  jobId: z.string().min(1, "Choose a job"),
  technicianId: optionalId,
  time: clockTime,
});
export type ClockOnInput = z.input<typeof clockOnInputSchema>;

export const clockOffInputSchema = z.object({ technicianId: optionalId, time: clockTime, jobDone: bool.default(false) });
export type ClockOffInput = z.input<typeof clockOffInputSchema>;

// ── Warranty ────────────────────────────────────────────────

export const claimDecisionInputSchema = z.object({ decision: z.enum(["ACCEPTED", "REJECTED"]), notes: optionalText });
export type ClaimDecisionInput = z.input<typeof claimDecisionInputSchema>;

export const warrantyRemittanceInputSchema = z.object({
  siteId: z.string().min(1),
  claimIds: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string().min(1)).min(1, "Choose at least one claim")),
  reference: optionalText,
});
export type WarrantyRemittanceInput = z.input<typeof warrantyRemittanceInputSchema>;
