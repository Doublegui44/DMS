/** Document numbering format (pure). */

export interface SequenceDefinition {
  prefix: string;
  padding: number;
  /** true → counter restarts each fiscal year and the year appears in the number. */
  yearly: boolean;
}

/** Default series. Site-scoped prefixes get the site code prepended (e.g. "NTE-FA"). */
export const DEFAULT_SEQUENCES: Record<string, SequenceDefinition> = {
  CUSTOMER: { prefix: "C", padding: 6, yearly: false },
  INVOICE: { prefix: "FA", padding: 6, yearly: true },
  CREDIT_NOTE: { prefix: "AV", padding: 6, yearly: true },
  QUOTE: { prefix: "DE", padding: 5, yearly: true },
  SALES_ORDER: { prefix: "BC", padding: 5, yearly: true },
  REPAIR_ORDER: { prefix: "OR", padding: 6, yearly: true },
  PURCHASE_ORDER: { prefix: "CF", padding: 5, yearly: true },
  GOODS_RECEIPT: { prefix: "BR", padding: 5, yearly: true },
  COUNTER_SALE: { prefix: "VC", padding: 5, yearly: true },
  WARRANTY_CLAIM: { prefix: "GA", padding: 5, yearly: true },
  POLICE_REGISTER: { prefix: "LP", padding: 5, yearly: false },
  SUPPLIER: { prefix: "F", padding: 5, yearly: false },
  RECEIPT: { prefix: "RC", padding: 6, yearly: true },
  DISBURSEMENT: { prefix: "RG", padding: 6, yearly: true },
};

/** Journal entry series: one gap-free counter per journal and fiscal year (e.g. VE-2026-000001). */
export function sequenceDefinition(docType: string): SequenceDefinition | undefined {
  if (docType.startsWith("JOURNAL_")) return { prefix: docType.slice("JOURNAL_".length), padding: 6, yearly: true };
  return DEFAULT_SEQUENCES[docType];
}

export function formatDocumentNumber(args: { prefix: string; fiscalYear: number; padding: number; value: number }): string {
  if (!Number.isInteger(args.value) || args.value < 1) throw new RangeError(`Invalid sequence value ${args.value}`);
  const n = String(args.value).padStart(args.padding, "0");
  return args.fiscalYear > 0 ? `${args.prefix}-${args.fiscalYear}-${n}` : `${args.prefix}${n}`;
}
