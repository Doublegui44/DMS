import { z } from "zod";
import { parseEuros } from "@/lib/money";
import { CASH_METHODS } from "@/modules/accounting";
import { normalisePartNumber } from "../domain/catalogue";
import { PRICE_CLASSES } from "../domain/pricing";

export const PART_UNITS = ["EA", "L", "M"] as const;
export const PURCHASE_ORDER_KINDS = ["STOCK", "EMERGENCY"] as const;

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** Euros typed by the user ("12,50") → cents; numbers are cents already (service and CLI callers). */
function toCents(v: unknown): unknown {
  if (v === "" || v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  try {
    return parseEuros(String(v));
  } catch {
    return Number.NaN;
  }
}
const euros = z.preprocess(toCents, z.number({ required_error: "Price is required", invalid_type_error: "Invalid amount" }).int("Invalid amount").min(0, "Cannot be negative"));
const optionalEuros = z.preprocess(toCents, z.number({ invalid_type_error: "Invalid amount" }).int("Invalid amount").min(0, "Cannot be negative").optional());
const date = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : new Date(String(v))), z.date({ required_error: "Date is required", invalid_type_error: "Invalid date" }));
const optionalDate = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : new Date(String(v))), z.date({ invalid_type_error: "Invalid date" }).nullable().optional());

function decimalText(v: unknown): unknown {
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.trim().replace(",", ".");
  return v;
}
/** A quantity as text: up to 3 decimals ("1", "2.5", "0,25"); the services work in Decimal. */
const qty = z.preprocess(
  decimalText,
  z
    .string({ required_error: "Quantity is required" })
    .regex(/^\d+(\.\d{1,3})?$/, "Enter a quantity with at most 3 decimals")
    .refine((s) => Number(s) > 0, "Must be more than zero"),
);
/** A stock level or a count: zero allowed. */
const level = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? "0" : decimalText(v)),
  z.string().regex(/^\d+(\.\d{1,3})?$/, "Enter a quantity with at most 3 decimals"),
);
const partNumber = z
  .string({ required_error: "Part number is required" })
  .transform(normalisePartNumber)
  .pipe(z.string().min(3, "Part number is required").max(30, "At most 30 characters"));

// ── Catalogue ───────────────────────────────────────────────

export const partInputSchema = z.object({
  partNumber,
  description: z.string().trim().min(2, "Description is required").max(120),
  family: z.string().trim().min(2, "Family is required").max(40),
  brandId: optionalText,
  supplierId: z.string().min(1, "Supplier is required"),
  discountCodeId: z.string().min(1, "Discount code is required"),
  unit: z.enum(PART_UNITS).default("EA"),
  retailPriceCents: euros,
  listCostCents: euros,
  vatRateCode: z.string().default("STANDARD"),
  active: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(true),
});
export type PartInput = z.input<typeof partInputSchema>;

export const supersessionInputSchema = z.object({
  newPartNumber: partNumber,
  effectiveOn: optionalDate,
});
export type SupersessionInput = z.input<typeof supersessionInputSchema>;

/** Percentages typed in the matrix ("25" or "12,5") → basis points; numbers are basis points already. */
const percentBp = z.preprocess(
  (v) => (typeof v === "number" ? v : v === "" || v === null || v === undefined ? 0 : Math.round(Number(String(v).trim().replace(",", ".")) * 100)),
  z.number({ invalid_type_error: "Invalid rate" }).int("Invalid rate").min(0, "Between 0 and 100 %").max(10_000, "Between 0 and 100 %"),
);
export const discountRatesInputSchema = z.object({
  rates: z.array(z.object({ discountCodeId: z.string().min(1), priceClass: z.enum(PRICE_CLASSES), discountBp: percentBp })).min(1),
});
export type DiscountRatesInput = z.input<typeof discountRatesInputSchema>;

// ── Stock ───────────────────────────────────────────────────

export const stockLevelsInputSchema = z
  .object({
    siteId: z.string().min(1, "Site is required"),
    partId: z.string().min(1),
    bin: z
      .string()
      .trim()
      .toUpperCase()
      .max(20, "At most 20 characters")
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    minQty: level,
    maxQty: level,
  })
  .refine((s) => Number(s.maxQty) === 0 || Number(s.maxQty) >= Number(s.minQty), { message: "Maximum must be at least the minimum", path: ["maxQty"] });
export type StockLevelsInput = z.input<typeof stockLevelsInputSchema>;

const partLine = z.object({ partNumber, qty });

export const transferInputSchema = z
  .object({
    fromSiteId: z.string().min(1, "Site is required"),
    toSiteId: z.string().min(1, "Destination is required"),
    notes: optionalText,
    lines: z.array(partLine).min(1, "Add at least one part"),
  })
  .refine((t) => t.fromSiteId !== t.toSiteId, { message: "Choose another site", path: ["toSiteId"] });
export type TransferInput = z.input<typeof transferInputSchema>;

// ── Purchasing ──────────────────────────────────────────────

export const purchaseLineInputSchema = z.object({ partNumber, qty, unitCostCents: optionalEuros });
export type PurchaseLineInput = z.input<typeof purchaseLineInputSchema>;

export const purchaseOrderInputSchema = z.object({
  siteId: z.string().min(1, "Site is required"),
  supplierId: z.string().min(1, "Supplier is required"),
  kind: z.enum(PURCHASE_ORDER_KINDS).default("STOCK"),
  expectedOn: optionalDate,
  notes: optionalText,
  lines: z.array(purchaseLineInputSchema).default([]),
});
export type PurchaseOrderInput = z.input<typeof purchaseOrderInputSchema>;

export const suggestedOrdersInputSchema = z.object({
  siteId: z.string().min(1, "Site is required"),
  /** Restrict to these stock items; all suggestions when empty. */
  stockItemIds: z.array(z.string().min(1)).default([]),
});
export type SuggestedOrdersInput = z.input<typeof suggestedOrdersInputSchema>;

export const receiptInputSchema = z.object({
  deliveryNote: optionalText,
  lines: z
    .array(z.object({ poLineId: z.string().min(1), qty: level }))
    .transform((lines) => lines.filter((l) => Number(l.qty) > 0))
    .pipe(z.array(z.object({ poLineId: z.string(), qty: z.string() })).min(1, "Enter the quantities received")),
});
export type ReceiptInput = z.input<typeof receiptInputSchema>;

export const supplierInvoiceInputSchema = z.object({
  siteId: z.string().min(1, "Site is required"),
  supplierId: z.string().min(1, "Supplier is required"),
  supplierReference: z.string().trim().min(1, "Supplier invoice number is required").max(40),
  invoiceDate: date,
  notes: optionalText,
  lines: z
    .array(z.object({ receiptLineId: z.string().min(1), qty: level, unitCostCents: optionalEuros }))
    .transform((lines) => lines.filter((l) => Number(l.qty) > 0))
    .pipe(z.array(z.object({ receiptLineId: z.string(), qty: z.string(), unitCostCents: z.number().int().min(0).optional() })).min(1, "Select the receipt lines this invoice bills")),
});
export type SupplierInvoiceInput = z.input<typeof supplierInvoiceInputSchema>;

export const supplierPaymentInputSchema = z.object({ method: z.enum(CASH_METHODS).default("TRANSFER") });
export type SupplierPaymentInput = z.input<typeof supplierPaymentInputSchema>;

// ── Counter sales ───────────────────────────────────────────

export const counterSaleInputSchema = z.object({
  siteId: z.string().min(1, "Site is required"),
  customerId: z.string().min(1, "Customer is required"),
  priceClass: z.preprocess((v) => (v === "" ? undefined : v), z.enum(PRICE_CLASSES).optional()),
  reference: optionalText,
});
export type CounterSaleInput = z.input<typeof counterSaleInputSchema>;

export const counterLineInputSchema = partLine;
export type CounterLineInput = z.input<typeof counterLineInputSchema>;

export const counterInvoiceInputSchema = z.object({
  /** Paid at the counter now; empty = on the customer's account. */
  paymentMethod: z.preprocess((v) => (v === "" || v === "ACCOUNT" ? undefined : v), z.enum(CASH_METHODS).optional()),
});
export type CounterInvoiceInput = z.input<typeof counterInvoiceInputSchema>;

// ── Inventory ───────────────────────────────────────────────

export const cycleCountInputSchema = z.object({
  siteId: z.string().min(1, "Site is required"),
  label: z.string().trim().min(2, "Label is required").max(80),
  family: optionalText,
  binPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  limit: z.coerce.number().int().min(1, "At least one item").max(200, "At most 200 items").default(25),
});
export type CycleCountInput = z.input<typeof cycleCountInputSchema>;

export const countEntriesInputSchema = z.object({
  lines: z.array(
    z.object({
      lineId: z.string().min(1),
      countedQty: z.preprocess(
        (v) => (v === "" || v === null || v === undefined ? null : decimalText(v)),
        z.string().regex(/^\d+(\.\d{1,3})?$/, "Enter a quantity with at most 3 decimals").nullable(),
      ),
    }),
  ),
});
export type CountEntriesInput = z.input<typeof countEntriesInputSchema>;
