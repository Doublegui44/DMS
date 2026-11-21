import { beforeEach, describe, expect, it } from "vitest";
import { runCommand, type Actor, type ServiceContext } from "@/lib/context";
import { addDays } from "@/lib/dates";
import { parseListParams } from "@/lib/list";
import { addJob, addLabourLine, addPartLine, addSubletLine, checkIn, completeJob, invoiceRepairOrder, qualityCheck } from "@/modules/workshop";
import { getFecExport, getPayablesAgeing, getProfitAndLoss, getReceivablesAgeing, getTrialBalance, getVatReport, monthRange } from "@/modules/accounting";
import { writeFileSync } from "node:fs";
import { getPrintableDocument, getRoleDashboard } from "@/modules/reports";
import { renderPrintDocument } from "@/components/pdf/print-document";
import { balanceOf, db, makeActor, resetHandlers, resetWithWorkshop, sys } from "./helpers";

const D = new Date("2026-03-16");
let org: Awaited<ReturnType<typeof resetWithWorkshop>>;
const as = <T>(actor: Actor, fn: (ctx: ServiceContext) => Promise<T>, businessDate = D) => runCommand({ actor, siteId: org.siteA.id, businessDate }, fn);
const list = (filters: Record<string, string> = {}) => parseListParams(filters);

/** A visit split between the customer (paid by card), an insurer and the OEM, with a sublet bought from the bodyshop. */
async function splitVisit() {
  const ro = await as(org.advisor, (ctx) =>
    checkIn(ctx, { siteId: org.siteA.id, customerId: org.customer.id, vehicleId: org.car.id, mileageIn: 45_000, fuelLevelPct: 50, signedBy: "Jeanne Martin", concern: "Service" }),
  );
  const job = await db.roJob.findFirstOrThrow({ where: { roId: ro.id } });
  await as(org.advisor, (ctx) => addLabourLine(ctx, ro.id, job.id, { operationCode: "OIL-SVC" }));
  const warranty = await as(org.advisor, (ctx) => addJob(ctx, ro.id, { description: "Brake pads under warranty", payer: "WARRANTY" }));
  await as(org.advisor, (ctx) => addLabourLine(ctx, ro.id, warranty.id, { operationCode: "BRK-PADS-F" }));
  await as(org.advisor, (ctx) => addPartLine(ctx, ro.id, warranty.id, { partNumber: "1609438180", qty: 1 }));
  const insured = await as(org.advisor, (ctx) => addJob(ctx, ro.id, { description: "Windscreen", payer: "INSURANCE", payerCustomerId: org.insurer.id }));
  await as(org.advisor, (ctx) => addSubletLine(ctx, ro.id, insured.id, { supplierId: org.bodyshop.id, label: "Windscreen replacement", costCents: "300", priceCents: "420" }));
  for (const j of await db.roJob.findMany({ where: { roId: ro.id } })) await as(org.advisor, (ctx) => completeJob(ctx, ro.id, j.id));
  await as(org.workshopManager, (ctx) => qualityCheck(ctx, ro.id, { pass: true }));
  await as(org.advisor, (ctx) => invoiceRepairOrder(ctx, ro.id, { paymentMethod: "CARD" }));
  return ro;
}

beforeEach(async () => {
  resetHandlers();
  org = await resetWithWorkshop();
  await splitVisit();
});

describe("financial reports", () => {
  it("P&L by department ties to the trial balance and the revenue accounts", async () => {
    const range = monthRange(2026, 3);
    const pnl = await sys((ctx) => getProfitAndLoss(ctx, range), D);
    const tb = await sys((ctx) => getTrialBalance(ctx, range), D);
    expect(pnl.total.resultCents).toBe(tb.resultCents);

    const workshopRevenue = -((await balanceOf("706100")) + (await balanceOf("706300")) + (await balanceOf("706200")));
    expect(pnl.byDepartment.WORKSHOP.revenueCents).toBe(workshopRevenue);
    expect(pnl.byDepartment.WORKSHOP.costOfSalesCents).toBe(30_000); // the sublet
    expect(pnl.byDepartment.PARTS.revenueCents).toBe(-(await balanceOf("707400")) - (await balanceOf("707300")));
    expect(pnl.byDepartment.PARTS.grossMarginCents).toBe(pnl.byDepartment.PARTS.revenueCents - pnl.byDepartment.PARTS.costOfSalesCents);
    expect(pnl.columns).toEqual(expect.arrayContaining(["WORKSHOP", "PARTS"]));
    // Nothing in April.
    expect((await sys((ctx) => getProfitAndLoss(ctx, monthRange(2026, 4)), D)).lines).toHaveLength(0);
  });

  it("VAT return: collected VAT equals the invoices, deductible VAT includes the sublet", async () => {
    const vat = await sys((ctx) => getVatReport(ctx, { year: 2026, month: 3 }), D);
    expect(vat.collectedCents).toBe(-(await balanceOf("445710")) - (await balanceOf("445715")));
    expect(vat.unexplainedCents).toBe(0);
    expect(vat.deductible.find((x) => x.accountCode === "445660")?.amountCents).toBe(await balanceOf("445660"));
    expect(vat.deductibleCents).toBeGreaterThanOrEqual(6_000);
    expect(vat.netDueCents).toBe(vat.collectedCents - vat.deductibleCents);
    const standard = vat.sales.find((s) => s.vatRegime === "STANDARD" && s.vatRateBp === 2000)!;
    expect(standard.baseCents).toBe(7_600 + 42_000 + 9_600 + 5_850);
  });

  it("ages receivables by due date and payables by the supplier's terms", async () => {
    const now = await sys((ctx) => getReceivablesAgeing(ctx, list()), D);
    expect(now.totals.totalCents).toBe(50_400 + 18_540); // insurer and OEM; the customer paid
    expect(now.totals.balanceCents).toBe((await balanceOf("411000")) + (await balanceOf("411100")));
    expect(now.totals.unappliedCents).toBe(0);
    expect(now.totals.current).toBe(now.totals.totalCents);

    const later = await sys((ctx) => getReceivablesAgeing(ctx, list()), addDays(D, 50));
    const oem = later.rows.find((r) => r.partyId === org.oemCustomer.id)!;
    expect(oem).toMatchObject({ d1_30: 18_540, totalCents: 18_540 }); // 45-day terms: 5 days late
    const insurer = later.rows.find((r) => r.partyId === org.insurer.id)!;
    expect(insurer.totalCents - insurer.current).toBe(50_400); // overdue

    const payables = await sys((ctx) => getPayablesAgeing(ctx, list()), addDays(D, 45));
    const bodyshop = payables.rows.find((r) => r.partyId === org.bodyshop.id)!;
    expect(bodyshop).toMatchObject({ totalCents: 36_000, d1_30: 36_000, balanceCents: 36_000, unappliedCents: 0 });
  });

  it("exports every journal line of the year in the FEC layout", async () => {
    const fec = await sys((ctx) => getFecExport(ctx, 2026), D);
    const count = await db.journalLine.count({ where: { entryDate: { gte: new Date("2026-01-01"), lte: new Date("2026-12-31") } } });
    expect(fec.lineCount).toBe(count);
    expect(fec.debitCents).toBe(fec.creditCents);
    const rows = fec.content.split("\r\n").filter(Boolean);
    expect(rows).toHaveLength(count + 1);
    expect(rows.every((r) => r.split("|").length === 18)).toBe(true);
    expect(fec.fileName).toMatch(/^\d{9}FEC20261231\.txt$/);
    // The OEM's receivable carries its auxiliary account and the invoice number as supporting document.
    const oem = rows.find((r) => r.includes(`|${org.oemCustomer.accountCode}|`))!;
    expect(oem.split("|")[8]).toMatch(/-FA-2026-/);
  });

  it("role dashboards show the report figures, cut to what each role may see", async () => {
    const accountant = await makeActor("ACCOUNTANT", null, "acc@t.test");
    const acc = await as(accountant, (ctx) => getRoleDashboard(ctx));
    expect(acc.layout.widgets).toEqual(expect.arrayContaining(["grossMargin", "receivables", "payables", "vat"]));
    expect(acc.unitsSold).toBeNull();
    const pnl = await sys((ctx) => getProfitAndLoss(ctx, monthRange(2026, 3)), D);
    for (const dep of ["WORKSHOP", "PARTS"] as const) {
      expect(acc.grossMargin!.month.find((r) => r.department === dep)?.grossMarginCents).toBe(pnl.byDepartment[dep].grossMarginCents);
    }
    expect(acc.marginTrend!.at(-1)).toMatchObject({ month: "2026-03", WORKSHOP: pnl.byDepartment.WORKSHOP.grossMarginCents });
    const receivables = await sys((ctx) => getReceivablesAgeing(ctx, list(), { all: true }), D);
    expect(acc.receivables).toEqual(receivables.totals);
    expect(acc.receivables!.balanceCents).toBe((await balanceOf("411000")) + (await balanceOf("411100")));
    const vat = await sys((ctx) => getVatReport(ctx, { year: 2026, month: 3 }), D);
    expect(acc.vat!.at(-1)).toMatchObject({ month: 3, netDueCents: vat.netDueCents });

    const manager = await as(org.workshopManager, (ctx) => getRoleDashboard(ctx));
    expect(manager.layout.departments).toEqual(["WORKSHOP", "PARTS"]);
    expect(manager.receivables).toBeNull();
    expect(manager.workshopProductivity!.mine).toBe(false);

    const tech = await as(org.technician, (ctx) => getRoleDashboard(ctx));
    expect(tech.layout.widgets).toEqual(["workshopProductivity"]);
    expect(tech.workshopProductivity!.mine).toBe(true);
    expect(tech.workshopProductivity!.technicians.every((r) => r.id === org.technician.userId)).toBe(true);
  });

  it("prints the repair order, its invoices and the warranty claim from the same figures", async () => {
    const ro = await db.repairOrder.findFirstOrThrow();
    const invoices = await db.invoice.findMany({ include: { lines: true } });
    const claim = await db.warrantyClaim.findFirstOrThrow();
    const t = (key: string) => key;
    const out = process.env.PDF_OUT;

    const roDoc = await as(org.advisor, (ctx) => getPrintableDocument(ctx, "repair-order", ro.id));
    expect(roDoc.sections.map((s) => s.badge)).toEqual(["CUSTOMER", "WARRANTY", "INSURANCE"]);
    expect(roDoc.totals.at(-1)!.cents).toBe(roDoc.sections.reduce((t, s) => t + s.subtotalCents!, 0));
    expect(roDoc.signatures[0]).toEqual({ key: "customer", name: "Jeanne Martin" });

    for (const inv of invoices) {
      const doc = await sys((ctx) => getPrintableDocument(ctx, "invoice", inv.id), D);
      expect(doc.number).toBe(inv.number);
      expect(doc.totals.find((x) => x.key === "totalInclVat")!.cents).toBe(inv.totalInclVatCents);
      expect(doc.vat.reduce((t, v) => t + v.vatCents, 0)).toBe(inv.vatCents);
      expect(doc.vat.reduce((t, v) => t + v.baseCents, 0)).toBe(inv.totalExclVatCents);
      expect(doc.sections[0].lines).toHaveLength(inv.lines.length);
    }

    const claimDoc = await as(org.workshopManager, (ctx) => getPrintableDocument(ctx, "warranty-claim", claim.id));
    expect(claimDoc.recipient.name).toBe((await db.customer.findFirstOrThrow({ where: { invoices: { some: { id: claim.invoiceId } } } })).displayName);
    expect(claimDoc.totals[0]).toEqual({ key: "claimed", cents: claim.claimedCents, strong: true });
    // A technician may not print another site's... nor any invoice: the invoice screen's permission applies.
    await expect(as(org.technician, (ctx) => getPrintableDocument(ctx, "invoice", invoices[0].id))).rejects.toThrow();

    for (const doc of [roDoc, claimDoc]) {
      const pdf = await renderPrintDocument(doc, t);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.toString("latin1")).toContain(doc.number);
      if (out) writeFileSync(`${out}/${doc.kind}.pdf`, pdf);
    }
  });
});
