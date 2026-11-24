import type { ServiceContext } from "@/lib/context";
import { isoDate } from "@/lib/dates";
import { sumCents } from "@/lib/money";
import { parseInput } from "@/lib/validation";
import { dueSupplierItems, OWN_PAYMENT_FLOW } from "../domain/payment-run";
import { supplierPaymentRunInputSchema, type SupplierPaymentRunInput } from "../schemas/accounting";
import { letterLines } from "./lettering";
import { recordPayment } from "./payments";

/**
 * Supplier payment run (D-078): for one site, pay every supplier the items that are due — car
 * arrivals, used-car purchases, car costs, sublets, overheads — one transfer per supplier and
 * account, lettered against the items it pays. Parts supplier invoices keep their own flow.
 */
export async function runSupplierPayments(ctx: ServiceContext, input: SupplierPaymentRunInput) {
  const data = parseInput(supplierPaymentRunInputSchema, input);
  ctx.require("accounting.payment", "create", data.siteId);
  const lines = await ctx.tx.journalLine.findMany({
    where: {
      siteId: data.siteId,
      partyType: "SUPPLIER",
      accountCode: { startsWith: "40" },
      NOT: { accountCode: { startsWith: "408" } },
      letteringCode: null,
      entry: { sourceType: { notIn: [...OWN_PAYMENT_FLOW] } },
      ...(data.supplierIds ? { partyId: { in: data.supplierIds } } : {}),
    },
    select: { id: true, partyId: true, accountCode: true, entryDate: true, debitCents: true, creditCents: true },
    orderBy: [{ entryDate: "asc" }, { id: "asc" }],
  });
  const suppliers = await ctx.tx.supplier.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.partyId!))] } }, select: { id: true, name: true, paymentTermsDays: true }, orderBy: { name: "asc" } });
  const paid: { supplierId: string; name: string; paymentId: string; amountCents: number; items: number }[] = [];
  for (const s of suppliers) {
    for (const account of [...new Set(lines.filter((l) => l.partyId === s.id).map((l) => l.accountCode))].sort()) {
      const mine = lines.filter((l) => l.partyId === s.id && l.accountCode === account).map((l) => ({ ...l, date: l.entryDate }));
      const due = dueSupplierItems(mine, s.paymentTermsDays, ctx.businessDate);
      const amountCents = sumCents(due.map((l) => l.creditCents - l.debitCents));
      if (amountCents <= 0) continue;
      const payment = await recordPayment(ctx, { siteId: data.siteId, direction: "OUT", method: data.method, supplierId: s.id, amountCents, reference: `Payment run ${isoDate(ctx.businessDate)} — ${due.length} item(s)` });
      const line = payment.journalEntryId ? await ctx.tx.journalLine.findFirst({ where: { entryId: payment.journalEntryId, partyId: s.id, accountCode: account } }) : null;
      if (line) await letterLines(ctx, [...due.map((l) => l.id), line.id], { trusted: true });
      paid.push({ supplierId: s.id, name: s.name, paymentId: payment.id, amountCents, items: due.length });
    }
  }
  await ctx.audit({ action: "payment.run", entityType: "Site", entityId: data.siteId, siteId: data.siteId, after: { suppliers: paid.length, amountCents: sumCents(paid.map((p) => p.amountCents)) } });
  return paid;
}
