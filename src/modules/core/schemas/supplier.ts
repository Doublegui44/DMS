import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const supplierInputSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  isOem: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()).default(false),
  siren: optionalText,
  vatNumber: optionalText,
  email: optionalText,
  phone: optionalText,
  address: optionalText,
  postalCode: optionalText,
  city: optionalText,
  countryCode: z.string().length(2).default("FR"),
  paymentTermsDays: z.coerce.number().int().min(0).max(120).default(30),
});
export type SupplierInput = z.input<typeof supplierInputSchema>;
