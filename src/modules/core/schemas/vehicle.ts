import { z } from "zod";
import { parseEuros } from "@/lib/money";
import { isValidFrenchPlate, isValidVin, normalisePlate, normaliseVin } from "../domain/vehicle";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalInt = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z.number().int().min(0).nullable(),
);

/** Euros typed by the user ("12 500,00") → cents. Accepts numbers in cents when already converted. */
const optionalEuros = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  try {
    return parseEuros(String(v));
  } catch {
    return Number.NaN;
  }
}, z.number().int("Invalid amount").min(0).nullable());

const optionalDate = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : new Date(String(v))),
  z.date().nullable(),
);

export const vehicleInputSchema = z
  .object({
    vin: z
      .string()
      .transform(normaliseVin)
      .refine(isValidVin, "VIN must be 17 characters, without I, O or Q"),
    registration: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : normalisePlate(v)))
      .nullable()
      .optional()
      .refine((v) => !v || isValidFrenchPlate(v), "Plate must look like AB-123-CD"),
    brandId: optionalText,
    make: z.string().trim().min(1, "Make is required"),
    model: z.string().trim().min(1, "Model is required"),
    version: z.string().trim().min(1, "Version is required"),
    firstRegistration: optionalDate,
    mileage: z.coerce.number().int().min(0).default(0),
    fuel: z.enum(["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "ELECTRIC", "LPG"]),
    co2: optionalInt,
    powerHp: optionalInt,
    colour: optionalText,
    stockType: z.enum(["VN", "VO", "NONE"]),
    status: z.enum([
      "ORDERED",
      "IN_TRANSIT",
      "IN_STOCK",
      "INTAKE",
      "RECONDITIONING",
      "FOR_SALE",
      "RESERVED",
      "SOLD",
      "DELIVERED",
      "CUSTOMER",
    ]),
    siteId: optionalText,
    ownerCustomerId: optionalText,
    listPriceCents: optionalEuros,
    stockValueCents: optionalEuros,
    stockInDate: optionalDate,
    vatRegime: z.enum(["STANDARD", "MARGIN"]).default("STANDARD"),
  })
  .superRefine((v, ctx) => {
    if (v.stockType !== "NONE" && !v.siteId) {
      ctx.addIssue({ code: "custom", path: ["siteId"], message: "A stock vehicle must belong to a site" });
    }
    if (v.stockType === "NONE" && !v.ownerCustomerId) {
      ctx.addIssue({ code: "custom", path: ["ownerCustomerId"], message: "A customer vehicle needs an owner" });
    }
    if (v.stockType === "VN" && v.vatRegime === "MARGIN") {
      ctx.addIssue({ code: "custom", path: ["vatRegime"], message: "New vehicles are always sold under standard VAT" });
    }
  });

export type VehicleInput = z.input<typeof vehicleInputSchema>;

export const vehicleStatusChangeSchema = z.object({
  status: vehicleInputSchema.innerType().shape.status,
  reason: optionalText,
});
