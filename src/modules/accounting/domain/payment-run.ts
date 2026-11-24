import { addDays } from "@/lib/dates";
import type { Cents } from "@/lib/money";
import { fifoOpenItems } from "./reports";

/**
 * Supplier documents with a payment flow of their own (a parts supplier invoice is matched, then
 * paid on its own and lettered): a payment run leaves them alone (D-078).
 */
export const OWN_PAYMENT_FLOW = ["SUPPLIER_INVOICE"] as const;

/**
 * The items of one supplier account to pay in a payment run: among its unlettered lines, the
 * credits still fully open (FIFO, D-064) whose due date — entry date + the supplier's terms — has
 * come. An item only partly settled stays out, so the payment always letters against whole items.
 */
export function dueSupplierItems<T extends { date: Date; debitCents: Cents; creditCents: Cents }>(lines: T[], termsDays: number, asOf: Date): T[] {
  return fifoOpenItems(lines, -1)
    .filter((o) => o.openCents === o.line.creditCents - o.line.debitCents && addDays(o.line.date, termsDays).getTime() <= asOf.getTime())
    .map((o) => o.line)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}
