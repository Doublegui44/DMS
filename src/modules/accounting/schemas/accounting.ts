import { z } from "zod";

const DEPARTMENTS = ["VN", "VO", "WORKSHOP", "PARTS", "ACCOUNTING", "OVERHEAD"] as const;
const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" || v === undefined ? null : v), z.enum(values).nullable());
const dateInput = z.union([z.string().min(1, "Date is required"), z.date()]).pipe(z.coerce.date());
const cents = z.coerce.number().int("Amount must be in cents").min(0);

export const accountInputSchema = z.object({
  code: z.string().trim().regex(/^[1-8]\d{5}$/, "Account code is 6 digits, class 1 to 8"),
  label: z.string().trim().min(2).max(120),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
  postable: checkbox.default(true),
  requiresAnalytic: checkbox.optional(),
  isReceivable: checkbox.default(false),
  isPayable: checkbox.default(false),
  active: checkbox.default(true),
});
export type AccountInput = z.input<typeof accountInputSchema>;

export const manualEntrySchema = z.object({
  journalCode: z.string().trim().min(2).max(4).default("OD"),
  siteId: z.string().min(1, "Site is required"),
  entryDate: dateInput,
  label: z.string().trim().min(2, "Label is required").max(120),
  lines: z
    .array(
      z.object({
        accountCode: z.string().trim().min(1, "Account is required"),
        debitCents: cents.default(0),
        creditCents: cents.default(0),
        label: optionalText,
        departmentCode: optionalEnum(DEPARTMENTS),
        partyType: optionalEnum(["CUSTOMER", "SUPPLIER"] as const),
        partyId: optionalText,
      }),
    )
    .min(2, "An entry needs at least two lines"),
});
export type ManualEntryInput = z.input<typeof manualEntrySchema>;

const invoiceLineSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(200),
  quantity: z.coerce.number().refine((q) => q !== 0, "Quantity cannot be zero").default(1),
  unitPriceExclVatCents: z.coerce.number().int(),
  discountBp: z.coerce.number().int().min(0).max(10_000).default(0),
  vatRateCode: z.string().default("STANDARD"),
  departmentCode: z.enum(DEPARTMENTS),
  revenueKey: z.string().min(1),
  /** Margin regime only: purchase price of the used vehicle (price is then incl. VAT). */
  purchasePriceCents: z.coerce.number().int().min(0).optional(),
  /** Per-line regime; defaults to the invoice's. A used car (MARGIN) can share an invoice with add-ons (STANDARD). */
  vatRegime: z.enum(["STANDARD", "MARGIN"]).optional(),
});

export const invoiceInputSchema = z.object({
  siteId: z.string().min(1),
  customerId: z.string().min(1, "Customer is required"),
  sourceType: z.string().default("MANUAL"),
  sourceId: z.string().nullable().optional(),
  vatRegime: z.enum(["STANDARD", "MARGIN"]).default("STANDARD"),
  notes: optionalText,
  lines: z.array(invoiceLineSchema).min(1, "Add at least one line"),
});
export type InvoiceInput = z.input<typeof invoiceInputSchema>;

export const paymentInputSchema = z
  .object({
    siteId: z.string().min(1),
    direction: z.enum(["IN", "OUT"]).default("IN"),
    method: z.enum(["TRANSFER", "CARD", "CHEQUE", "CASH", "FINANCE_COMPANY", "TRADE_IN"]),
    customerId: optionalText,
    supplierId: optionalText,
    amountCents: z.coerce.number().int().positive("Amount must be positive"),
    reference: optionalText,
    /** Business document the money was taken for before any invoice exists (e.g. a deposit on an order). */
    sourceType: optionalText,
    sourceId: optionalText,
    allocations: z
      .array(z.object({ invoiceId: z.string().min(1), amountCents: z.coerce.number().int().positive() }))
      .default([]),
  })
  .refine((p) => !!p.customerId !== !!p.supplierId, { message: "Choose a customer or a supplier", path: ["customerId"] });
export type PaymentInput = z.input<typeof paymentInputSchema>;

/** A supplier payment run for one site (D-078): every supplier, or the ones listed. */
export const supplierPaymentRunInputSchema = z.object({
  siteId: z.string().min(1, "Site is required"),
  method: z.enum(["TRANSFER", "CHEQUE"]).default("TRANSFER"),
  supplierIds: z.array(z.string().min(1)).optional(),
});
export type SupplierPaymentRunInput = z.input<typeof supplierPaymentRunInputSchema>;
