import { z } from "zod";
import { isValidFrenchVatNumber, isValidSiren } from "../domain/customer";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());

export const customerInputSchema = z
  .object({
    kind: z.enum(["INDIVIDUAL", "COMPANY", "OEM"]),
    title: optionalText,
    firstName: optionalText,
    lastName: optionalText,
    companyName: optionalText,
    siren: optionalText,
    vatNumber: optionalText,
    email: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional()
      .refine((v) => !v || z.string().email().safeParse(v).success, "Invalid email"),
    phone: optionalText,
    address: optionalText,
    postalCode: optionalText,
    city: optionalText,
    countryCode: z.string().trim().length(2).default("FR"),
    priceClass: z.enum(["RETAIL", "TRADE", "INTERNAL", "WARRANTY"]).default("RETAIL"),
    paymentTermsDays: z.coerce.number().int().min(0).max(120).default(0),
    consentEmail: checkbox.default(false),
    consentSms: checkbox.default(false),
    consentPhone: checkbox.default(false),
    homeSiteId: optionalText,
    notes: optionalText,
  })
  .superRefine((c, ctx) => {
    if (c.kind === "INDIVIDUAL") {
      if (!c.lastName) ctx.addIssue({ code: "custom", path: ["lastName"], message: "Last name is required" });
    } else if (!c.companyName) {
      ctx.addIssue({ code: "custom", path: ["companyName"], message: "Company name is required" });
    }
    if (c.siren && !isValidSiren(c.siren)) {
      ctx.addIssue({ code: "custom", path: ["siren"], message: "Invalid SIREN (9 digits, Luhn checksum)" });
    }
    if (c.vatNumber && c.countryCode === "FR" && !isValidFrenchVatNumber(c.vatNumber)) {
      ctx.addIssue({ code: "custom", path: ["vatNumber"], message: "Invalid French VAT number" });
    }
  });

export type CustomerInput = z.input<typeof customerInputSchema>;
export type CustomerData = z.output<typeof customerInputSchema>;

export const contactInputSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  role: optionalText,
  email: optionalText,
  phone: optionalText,
  isPrimary: checkbox.default(false),
});
export type ContactInput = z.input<typeof contactInputSchema>;
