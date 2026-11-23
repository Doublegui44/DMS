import { addDays } from "@/lib/dates";
import { db } from "@/lib/db";
import { postManualEntry, recordPayment } from "@/modules/accounting";
import { unit, unitInt } from "../domain/random";
import type { Sim, SiteCast } from "./shared";

const month = (d: Date) => d.toISOString().slice(0, 7);

/**
 * The accounts desk of one site for one day: rent on the 1st and salaries on the 28th (the same
 * amounts as last time), and customers paying their invoices: on their due date, or 10 to 60 days
 * late for a share of them (`latePaymentRate`), so the ageing report always has overdue items.
 * Car sales are paid through the order (sales activity) and warranty claims by the manufacturer's
 * remittance (workshop activity), so they are left out here.
 */
export async function accountingDay(sim: Sim, site: SiteCast) {
  const actor = sim.cast.accountant;
  if (sim.day.getUTCDate() === 1) await rent(sim, site);
  if (sim.day.getUTCDate() === 28) await salaries(sim, site);

  const open = await db.invoice.findMany({
    where: {
      siteId: site.id,
      kind: "INVOICE",
      status: { in: ["ISSUED", "PARTIALLY_PAID"] },
      sourceType: { not: "SALES_ORDER" },
      warrantyClaim: { is: null },
      issueDate: { lt: sim.day },
    },
    select: { id: true, customerId: true, issueDate: true, dueDate: true, totalInclVatCents: true, paidCents: true },
    orderBy: { number: "asc" },
  });
  for (const inv of open) {
    const due = inv.dueDate ?? inv.issueDate!;
    const late = unit(sim.rates.seed, inv.id, "late") < sim.rates.latePaymentRate;
    const paysOn = addDays(due, late ? unitInt(sim.rates.seed, inv.id, "late-days", 10, 60) : unitInt(sim.rates.seed, inv.id, "early", -3, 2));
    if (paysOn > sim.day) continue;
    const left = inv.totalInclVatCents - inv.paidCents;
    if (left <= 0) continue;
    await sim.step(late ? "late payment" : "customer payment", actor, site.id, (ctx) =>
      recordPayment(ctx, { siteId: site.id, method: "TRANSFER", customerId: inv.customerId, amountCents: left, allocations: [{ invoiceId: inv.id, amountCents: left }] }),
    );
  }
}

/** The landlord's rent, booked and paid by transfer (the amount of the last rent paid). */
async function rent(sim: Sim, site: SiteCast) {
  const last = await db.payment.findFirst({ where: { siteId: site.id, direction: "OUT", reference: "Rent", supplierId: { not: null } }, orderBy: { businessDate: "desc" } });
  if (!last) return;
  await sim.step("rent", sim.cast.accountant, site.id, async (ctx) => {
    await postManualEntry(ctx, {
      journalCode: "OD",
      siteId: site.id,
      entryDate: sim.day,
      label: `Rent ${month(sim.day)}`,
      lines: [
        { accountCode: "613200", debitCents: last.amountCents, departmentCode: "OVERHEAD" },
        { accountCode: "401000", creditCents: last.amountCents, partyType: "SUPPLIER", partyId: last.supplierId! },
      ],
    });
    return recordPayment(ctx, { siteId: site.id, direction: "OUT", method: "TRANSFER", supplierId: last.supplierId!, amountCents: last.amountCents, reference: "Rent" });
  });
}

/** The month's salaries, per department, as last month's. */
async function salaries(sim: Sim, site: SiteCast) {
  const last = await db.journalEntry.findFirst({
    where: { siteId: site.id, journalCode: "OD", label: { startsWith: "Salaries " }, reversalOfId: null },
    include: { lines: { orderBy: { lineNo: "asc" } } },
    orderBy: { entryDate: "desc" },
  });
  if (!last || last.label === `Salaries ${month(sim.day)}`) return;
  await sim.step("salaries", sim.cast.accountant, site.id, (ctx) =>
    postManualEntry(ctx, {
      journalCode: "OD",
      siteId: site.id,
      entryDate: sim.day,
      label: `Salaries ${month(sim.day)}`,
      lines: last.lines.map((l) => ({
        accountCode: l.accountCode,
        debitCents: l.debitCents || undefined,
        creditCents: l.creditCents || undefined,
        departmentCode: l.departmentCode ?? undefined,
      })),
    }),
  );
}
