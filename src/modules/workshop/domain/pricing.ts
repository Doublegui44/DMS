/** Who pays a job, at which labour rate and parts price class, into which revenue accounts (pure). */
import { sumCents, type Cents } from "@/lib/money";
import { computeLine } from "@/modules/accounting";

export const JOB_PAYERS = ["CUSTOMER", "WARRANTY", "INTERNAL", "INSURANCE"] as const;
export type JobPayer = (typeof JOB_PAYERS)[number];
export type PriceClass = "RETAIL" | "TRADE" | "INTERNAL" | "WARRANTY";

export interface LabourRates {
  /** The site's customer rate (assumption 10: €95/h excl. VAT by default). */
  customerCents: Cents;
  /** The make's warranty rate paid by the OEM (€80/h). */
  warrantyCents: Cents;
  /** Internal rate charged to used-car reconditioning (€60/h). */
  internalCents: Cents;
}

export function labourRateFor(payer: JobPayer, rates: LabourRates): Cents {
  if (payer === "WARRANTY") return rates.warrantyCents;
  if (payer === "INTERNAL") return rates.internalCents;
  return rates.customerCents; // customer and insurer pay the public rate
}

/** Parts on a job are priced for whoever pays it: the customer's class, or warranty / internal. */
export function partsPriceClassFor(payer: JobPayer, customerClass: PriceClass): PriceClass {
  if (payer === "WARRANTY") return "WARRANTY";
  if (payer === "INTERNAL") return "INTERNAL";
  if (payer === "INSURANCE") return "RETAIL";
  return customerClass === "INTERNAL" || customerClass === "WARRANTY" ? "RETAIL" : customerClass;
}

export function revenueKeysFor(payer: JobPayer): { labour: string; parts: string; sublet: string } {
  if (payer === "WARRANTY") return { labour: "REVENUE_WARRANTY_LABOUR", parts: "REVENUE_WARRANTY_PARTS", sublet: "REVENUE_SUBLET" };
  if (payer === "INTERNAL") return { labour: "REVENUE_INTERNAL_LABOUR", parts: "REVENUE_INTERNAL_PARTS", sublet: "REVENUE_SUBLET" };
  return { labour: "REVENUE_LABOUR", parts: "REVENUE_PARTS", sublet: "REVENUE_SUBLET" };
}

/** A labour line, rounded exactly as the invoice will round it (hours × rate − discount). */
export function labourAmount(a: { centiHours: number; rateCents: Cents; discountBp?: number }): Cents {
  if (a.centiHours <= 0) throw new RangeError("Billed time must be positive");
  return computeLine({ quantity: a.centiHours / 100, unitPriceExclVatCents: a.rateCents, discountBp: a.discountBp ?? 0, vatRateBp: 0 }).lineExclVatCents;
}

/** A part line, rounded as the invoice rounds it. */
export function partAmount(a: { qty: number; unitPriceCents: Cents; discountBp: number }): Cents {
  return computeLine({ quantity: a.qty, unitPriceExclVatCents: a.unitPriceCents, discountBp: a.discountBp, vatRateBp: 0 }).lineExclVatCents;
}

/** A job's price excl. VAT: labour + parts + sublet (what an estimate shows). */
export function jobTotal(job: { labour: readonly { amountCents: Cents }[]; parts: readonly { amountCents: Cents }[]; sublet: readonly { priceCents: Cents }[] }): Cents {
  return sumCents([...job.labour.map((l) => l.amountCents), ...job.parts.map((p) => p.amountCents), ...job.sublet.map((s) => s.priceCents)]);
}
