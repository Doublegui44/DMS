import { beforeEach, describe, expect, it } from "vitest";
import { runCommand, type Actor, type ServiceContext } from "@/lib/context";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import {
  addJob,
  addLabourLine,
  addPartLine,
  addSubletLine,
  bookAppointment,
  cancelRepairOrder,
  checkIn,
  clockOff,
  clockOn,
  closeRepairOrder,
  completeJob,
  decideJob,
  decideWarrantyClaim,
  getProductivity,
  invoiceRepairOrder,
  qualityCheck,
  recordRoPayment,
  recordWarrantyRemittance,
  removePartLine,
} from "@/modules/workshop";
import { purchaseVo } from "@/modules/sales";
import { balanceOf, db, partsStockValue, resetHandlers, resetWithWorkshop, sys } from "./helpers";

const D = new Date("2026-03-16"); // a Monday
let org: Awaited<ReturnType<typeof resetWithWorkshop>>;

const as = <T>(actor: Actor, fn: (ctx: ServiceContext) => Promise<T>, businessDate = D) => runCommand({ actor, siteId: org.siteA.id, businessDate }, fn);

beforeEach(async () => {
  resetHandlers();
  org = await resetWithWorkshop();
});

async function expectBooksMatchSubLedgers() {
  expect(await balanceOf("373000")).toBe(await partsStockValue());
  const vo = await db.vehicle.aggregate({ where: { stockType: "VO", status: { in: ["INTAKE", "RECONDITIONING", "FOR_SALE", "RESERVED"] } }, _sum: { stockValueCents: true } });
  expect(await balanceOf("372000")).toBe(vo._sum.stockValueCents ?? 0);
}

/** Check a customer's car in and return the RO with its first job. */
async function checkedIn(concern = "Annual service") {
  const ro = await as(org.advisor, (ctx) =>
    checkIn(ctx, { siteId: org.siteA.id, customerId: org.customer.id, vehicleId: org.car.id, mileageIn: 45_000, fuelLevelPct: 50, damages: "FRONT: scratch on bumper", signedBy: "Jeanne Martin", concern }),
  );
  const job = await db.roJob.findFirstOrThrow({ where: { roId: ro.id } });
  return { ro, job };
}

/** Finish every open job, pass QC: the RO is ready to invoice. */
async function makeReady(roId: string) {
  for (const j of await db.roJob.findMany({ where: { roId, status: "OPEN", approval: { in: ["NOT_REQUIRED", "APPROVED"] } } })) {
    await as(org.advisor, (ctx) => completeJob(ctx, roId, j.id));
  }
  await as(org.workshopManager, (ctx) => qualityCheck(ctx, roId, { pass: true }));
}

describe("check-in and appointments", () => {
  it("books within the technician's capacity and checks the car in from the appointment", async () => {
    const appt = await as(org.advisor, (ctx) =>
      bookAppointment(ctx, { siteId: org.siteA.id, customerId: org.customer.id, vehicleId: org.car.id, technicianId: org.technician.userId, date: "2026-03-16", startMinute: "08:30", plannedCentiHours: "6", concern: "Noise when braking" }),
    );
    expect(appt.number).toMatch(/^NTE-RV-2026-/);
    await expect(
      as(org.advisor, (ctx) =>
        bookAppointment(ctx, { siteId: org.siteA.id, customerId: org.customer.id, vehicleId: org.car.id, technicianId: org.technician.userId, date: "2026-03-16", startMinute: "14:00", plannedCentiHours: "2", concern: "Second job" }),
      ),
    ).rejects.toThrow(ValidationError);

    await expect(
      as(org.advisor, (ctx) => checkIn(ctx, { siteId: org.siteA.id, appointmentId: appt.id, customerId: org.customer.id, vehicleId: org.car.id, mileageIn: 39_000, fuelLevelPct: 25, signedBy: "J. Martin" })),
    ).rejects.toThrow(ValidationError); // odometer lower than known
    const ro = await as(org.advisor, (ctx) =>
      checkIn(ctx, { siteId: org.siteA.id, appointmentId: appt.id, customerId: org.customer.id, vehicleId: org.car.id, mileageIn: 41_250, fuelLevelPct: 25, damages: "REAR: dent", signedBy: "J. Martin" }),
    );
    expect(ro).toMatchObject({ status: "CHECKED_IN", mileageIn: 41_250, damages: [{ zone: "REAR", note: "dent" }] });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe("ARRIVED");
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: org.car.id } })).mileage).toBe(41_250);
    const job = await db.roJob.findFirstOrThrow({ where: { roId: ro.id } });
    expect(job).toMatchObject({ description: "Noise when braking", technicianId: org.technician.userId, payer: "CUSTOMER" });
    await expect(checkedIn()).rejects.toThrow(ConflictError); // already in the workshop
  });
});

describe("customer repair order", () => {
  it("bills standard time at the site rate, issues parts at PMP and posts revenue per department (Flow 3)", async () => {
    const { ro, job } = await checkedIn();
    const stockBefore = await partsStockValue(org.siteA.id);
    await as(org.advisor, (ctx) => addLabourLine(ctx, ro.id, job.id, { operationCode: "OIL-SVC" }));
    await as(org.advisor, (ctx) => addLabourLine(ctx, ro.id, job.id, { label: "Diagnosis", centiHours: "0,5", discountBp: "10" }));
    await as(org.advisor, (ctx) => addPartLine(ctx, ro.id, job.id, { partNumber: "1109AY", qty: 1 }));
    await as(org.advisor, (ctx) => addPartLine(ctx, ro.id, job.id, { partNumber: "ATO5W30", qty: "4,5" }));
    const lines = await db.roLabourLine.findMany({ where: { jobId: job.id }, orderBy: { amountCents: "desc" } });
    expect(lines.map((l) => [l.billedCentiHours, l.rateCents, l.amountCents])).toEqual([
      [80, 9_500, 7_600],
      [50, 9_500, 4_275], // 0.5 h × 95 − 10 %
    ]);
    // Parts left the shelf at PMP (filter 6.90, oil 6.00/L) and were posted at once.
    expect(stockBefore - (await partsStockValue(org.siteA.id))).toBe(690 + 2_700);
    expect((await db.repairOrder.findUniqueOrThrow({ where: { id: ro.id } })).totalExclVatCents).toBe(7_600 + 4_275 + 1_490 + 5_400);

    await as(org.technician, (ctx) => clockOn(ctx, { jobId: job.id, time: "08:00" }));
    expect((await db.repairOrder.findUniqueOrThrow({ where: { id: ro.id } })).status).toBe("IN_PROGRESS");
    await expect(as(org.advisor, (ctx) => completeJob(ctx, ro.id, job.id))).rejects.toThrow(ConflictError); // still clocked on
    await as(org.technician, (ctx) => clockOff(ctx, { time: "09:15", jobDone: true }));
    expect((await db.repairOrder.findUniqueOrThrow({ where: { id: ro.id } })).status).toBe("QUALITY_CHECK");
    await expect(as(org.technician, (ctx) => qualityCheck(ctx, ro.id, { pass: true }))).rejects.toThrow(ForbiddenError);
    await as(org.workshopManager, (ctx) => qualityCheck(ctx, ro.id, { pass: true }));

    const invoiced = await as(org.advisor, (ctx) => invoiceRepairOrder(ctx, ro.id));
    expect(invoiced.status).toBe("INVOICED");
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiced.customerInvoiceId! } });
    expect(invoice).toMatchObject({ customerId: org.customer.id, totalExclVatCents: 18_765, totalInclVatCents: 22_518, sourceType: "REPAIR_ORDER" });
    await expect(as(org.advisor, (ctx) => closeRepairOrder(ctx, ro.id))).rejects.toThrow(ConflictError); // an individual pays first
    await as(org.advisor, (ctx) => recordRoPayment(ctx, ro.id, { method: "CARD" }));
    expect((await as(org.advisor, (ctx) => closeRepairOrder(ctx, ro.id))).status).toBe("CLOSED");

    expect(await balanceOf("706100")).toBe(-(7_600 + 4_275));
    expect(await balanceOf("707300")).toBe(-(1_490 + 5_400));
    const byDept = await db.journalLine.groupBy({ by: ["accountCode", "departmentCode"], where: { accountCode: { in: ["706100", "707300", "603730"] } }, _sum: { creditCents: true, debitCents: true } });
    expect(byDept.find((r) => r.accountCode === "706100")?.departmentCode).toBe("WORKSHOP");
    expect(byDept.find((r) => r.accountCode === "707300")?.departmentCode).toBe("PARTS");
    expect(await balanceOf("411000", { partyId: org.customer.id })).toBe(0);
    await expectBooksMatchSubLedgers();
  });

  it("splits the invoice per payer: customer, insurer and the OEM's warranty claim (Flow 4)", async () => {
    const { ro, job } = await checkedIn("Service");
    await as(org.advisor, (ctx) => addLabourLine(ctx, ro.id, job.id, { operationCode: "OIL-SVC" }));
    const warranty = await as(org.advisor, (ctx) => addJob(ctx, ro.id, { description: "Brake pads under warranty", payer: "WARRANTY" }));
    await as(org.advisor, (ctx) => addLabourLine(ctx, ro.id, warranty.id, { operationCode: "BRK-PADS-F" }));
    await as(org.advisor, (ctx) => addPartLine(ctx, ro.id, warranty.id, { partNumber: "1609438180", qty: 1 }));
    const insured = await as(org.advisor, (ctx) => addJob(ctx, ro.id, { description: "Windscreen", payer: "INSURANCE", payerCustomerId: org.insurer.id }));
    await as(org.advisor, (ctx) => addSubletLine(ctx, ro.id, insured.id, { supplierId: org.bodyshop.id, label: "Windscreen replacement", costCents: "300", priceCents: "420" }));
    await expect(as(org.advisor, (ctx) => addJob(ctx, ro.id, { description: "Internal", payer: "INTERNAL" }))).rejects.toThrow(ValidationError);

    // Warranty pays its own rate and the warranty parts price.
    const wl = await db.roLabourLine.findFirstOrThrow({ where: { jobId: warranty.id } });
    expect(wl).toMatchObject({ rateCents: 8_000, amountCents: 9_600 });
    expect(await db.roPartLine.findFirstOrThrow({ where: { jobId: warranty.id } })).toMatchObject({ discountBp: 1_000, amountCents: 5_850 });

    await makeReady(ro.id);
    await as(org.advisor, (ctx) => invoiceRepairOrder(ctx, ro.id, { paymentMethod: "CARD" }));
    const invoices = await db.invoice.findMany({ where: { sourceType: "REPAIR_ORDER", sourceId: ro.id } });
    expect(invoices.map((i) => [i.customerId, i.totalExclVatCents]).sort()).toEqual(
      [
        [org.customer.id, 7_600],
        [org.insurer.id, 42_000],
        [org.oemCustomer.id, 9_600 + 5_850],
      ].sort(),
    );
    // The warranty receivable sits on the OEM account, not the customer's.
    expect(await balanceOf("411100", { partyId: org.oemCustomer.id })).toBe(18_540);
    expect(await balanceOf("411000", { partyId: org.customer.id })).toBe(0);
    expect(await balanceOf("411000", { partyId: org.insurer.id })).toBe(50_400);
    expect(await balanceOf("706300")).toBe(-9_600);
    expect(await balanceOf("707400")).toBe(-5_850);
    expect(await balanceOf("706200")).toBe(-42_000);
    // The sublet was bought from the bodyshop: Dr 604000 + VAT / Cr 401.
    expect(await balanceOf("604000")).toBe(30_000);
    expect(await balanceOf("401000", { partyId: org.bodyshop.id })).toBe(-36_000);

    const claim = await db.warrantyClaim.findFirstOrThrow({ where: { roId: ro.id } });
    expect(claim).toMatchObject({ status: "SUBMITTED", claimedCents: 18_540, jobId: warranty.id, brandId: org.brand.id });
    await as(org.workshopManager, (ctx) => decideWarrantyClaim(ctx, claim.id, { decision: "ACCEPTED" }));
    await as(org.workshopManager, (ctx) => recordWarrantyRemittance(ctx, { siteId: org.siteA.id, claimIds: [claim.id] }));
    expect((await db.warrantyClaim.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe("PAID");
    expect(await balanceOf("411100", { partyId: org.oemCustomer.id })).toBe(0);
    await expectBooksMatchSubLedgers();
  });

  it("credits a rejected warranty claim in full", async () => {
    const { ro } = await checkedIn("Warranty");
    const warranty = await as(org.advisor, (ctx) => addJob(ctx, ro.id, { description: "Warranty pads", payer: "WARRANTY" }));
    await db.roJob.deleteMany({ where: { roId: ro.id, id: { not: warranty.id } } });
    await as(org.advisor, (ctx) => addLabourLine(ctx, ro.id, warranty.id, { operationCode: "BRK-PADS-F" }));
    await makeReady(ro.id);
    await as(org.advisor, (ctx) => invoiceRepairOrder(ctx, ro.id));
    const claim = await db.warrantyClaim.findFirstOrThrow({ where: { roId: ro.id } });
    await expect(as(org.advisor, (ctx) => decideWarrantyClaim(ctx, claim.id, { decision: "REJECTED" }))).rejects.toThrow(ForbiddenError);
    const rejected = await as(org.workshopManager, (ctx) => decideWarrantyClaim(ctx, claim.id, { decision: "REJECTED", notes: "Wear, not a defect" }));
    expect(rejected.creditNoteId).toBeTruthy();
    expect(await balanceOf("411100", { partyId: org.oemCustomer.id })).toBe(0);
    expect(await balanceOf("706300")).toBe(0);
  });

  it("issues the parts of additional work only once the customer approves it", async () => {
    const { ro, job } = await checkedIn();
    await as(org.advisor, (ctx) => addLabourLine(ctx, ro.id, job.id, { operationCode: "OIL-SVC" }));
    const extra = await as(org.advisor, (ctx) => addJob(ctx, ro.id, { description: "Front pads worn", isAdditional: "on" }));
    expect(extra.approval).toBe("PENDING");
    await as(org.advisor, (ctx) => addLabourLine(ctx, ro.id, extra.id, { operationCode: "BRK-PADS-F" }));
    await as(org.advisor, (ctx) => addPartLine(ctx, ro.id, extra.id, { partNumber: "1609438180", qty: 1 }));
    expect((await db.roPartLine.findFirstOrThrow({ where: { jobId: extra.id } })).issued).toBe(false);
    expect((await db.roJob.findUniqueOrThrow({ where: { id: extra.id } })).estimateCents).toBe(11_400 + 6_500);
    await expect(as(org.technician, (ctx) => clockOn(ctx, { jobId: extra.id, time: "10:00" }))).rejects.toThrow(ConflictError);

    await as(org.advisor, (ctx) => decideJob(ctx, ro.id, extra.id, { approve: true, note: "Phoned the customer" }));
    expect((await db.roPartLine.findFirstOrThrow({ where: { jobId: extra.id } })).issued).toBe(true);

    const declined = await as(org.advisor, (ctx) => addJob(ctx, ro.id, { description: "Rear tyres", isAdditional: true }));
    await as(org.advisor, (ctx) => addLabourLine(ctx, ro.id, declined.id, { label: "Fit two tyres", centiHours: "0.6" }));
    await as(org.advisor, (ctx) => decideJob(ctx, ro.id, declined.id, { approve: false }));
    await makeReady(ro.id);
    const saved = await as(org.advisor, (ctx) => invoiceRepairOrder(ctx, ro.id));
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: saved.customerInvoiceId! } });
    expect(invoice.totalExclVatCents).toBe(7_600 + 11_400 + 6_500); // the declined job is not billed
  });

  it("returns parts to the shelf when a line is removed or the RO is cancelled", async () => {
    const { ro, job } = await checkedIn();
    const before = await partsStockValue(org.siteA.id);
    await as(org.advisor, (ctx) => addPartLine(ctx, ro.id, job.id, { partNumber: "1609438180", qty: 2 }));
    const line = await db.roPartLine.findFirstOrThrow({ where: { jobId: job.id } });
    await as(org.advisor, (ctx) => removePartLine(ctx, ro.id, line.id));
    expect(await partsStockValue(org.siteA.id)).toBe(before);
    await as(org.advisor, (ctx) => addPartLine(ctx, ro.id, job.id, { partNumber: "1109AY", qty: 3 }));
    await expect(as(org.advisor, (ctx) => addPartLine(ctx, ro.id, job.id, { partNumber: "1109AY", qty: 20 }))).rejects.toThrow(ValidationError);
    await as(org.workshopManager, (ctx) => cancelRepairOrder(ctx, ro.id, "Customer changed their mind"));
    expect(await partsStockValue(org.siteA.id)).toBe(before);
    const moves = await db.partMovement.findMany({ where: { sourceType: "REPAIR_ORDER" }, select: { kind: true } });
    expect(moves.map((m) => m.kind).sort()).toEqual(["ISSUE_RO", "ISSUE_RO", "RETURN_RO", "RETURN_RO"]);
    await expectBooksMatchSubLedgers();
  });
});

describe("internal repair order", () => {
  it("adds the work at internal rates to the used car's stock value (Flow 2, workshop side)", async () => {
    const { vehicle } = await sys((ctx) =>
      purchaseVo(ctx, {
        siteId: org.siteA.id,
        source: "PRIVATE",
        customerId: org.customer.id,
        priceCents: 1_000_000,
        vehicle: { vin: "VF3CCCCC0K1111111", registration: "CD-456-EF", brandId: org.brand.id, make: "Peugeot", model: "2008", version: "Allure", mileage: 60_000, fuel: "PETROL", firstRegistration: "2021-05-01" },
      }),
    );
    const ro = await as(org.advisor, (ctx) => checkIn(ctx, { siteId: org.siteA.id, kind: "INTERNAL", vehicleId: vehicle.id, mileageIn: 60_010, fuelLevelPct: 10, concern: "Pre-sale service" }));
    const job = await db.roJob.findFirstOrThrow({ where: { roId: ro.id } });
    expect(job.payer).toBe("INTERNAL");
    await as(org.advisor, (ctx) => addLabourLine(ctx, ro.id, job.id, { operationCode: "BRK-PADS-F" }));
    await as(org.advisor, (ctx) => addPartLine(ctx, ro.id, job.id, { partNumber: "1609438180", qty: 1 }));
    const labour = 120 * 60; // 1.2 h at the internal 60 €/h
    const parts = 6_500 - 1_950; // internal price class: −30 %
    expect((await db.repairOrder.findUniqueOrThrow({ where: { id: ro.id } })).totalExclVatCents).toBe(labour + parts);
    await makeReady(ro.id);
    const saved = await as(org.advisor, (ctx) => invoiceRepairOrder(ctx, ro.id));
    expect(saved.customerInvoiceId).toBeNull();
    expect(saved.internalEntryId).toBeTruthy();

    const car = await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(car.stockValueCents).toBe(1_000_000 + labour + parts);
    expect(await db.vehicleCostLine.findFirstOrThrow({ where: { vehicleId: vehicle.id, sourceType: "REPAIR_ORDER" } })).toMatchObject({ amountCents: labour + parts, sourceId: ro.id });
    expect(await balanceOf("706400")).toBe(-labour);
    expect(await balanceOf("707500")).toBe(-parts);
    const reconditioning = await db.journalLine.findFirstOrThrow({ where: { accountCode: "604000", entry: { sourceType: "REPAIR_ORDER" } } });
    expect(reconditioning).toMatchObject({ debitCents: labour + parts, departmentCode: "VO" });
    expect((await as(org.advisor, (ctx) => closeRepairOrder(ctx, ro.id))).status).toBe("CLOSED");
    await expectBooksMatchSubLedgers();
  });
});

describe("clocking, productivity and efficiency", () => {
  it("measures clocked against available and billed against clocked hours", async () => {
    const { ro, job } = await checkedIn();
    await as(org.advisor, (ctx) => addLabourLine(ctx, ro.id, job.id, { operationCode: "BRK-PADS-F" })); // 1.20 h billed
    const second = await as(org.advisor, (ctx) => addJob(ctx, ro.id, { description: "Oil service" }));
    await as(org.advisor, (ctx) => addLabourLine(ctx, ro.id, second.id, { operationCode: "OIL-SVC" })); // 0.80 h billed

    await as(org.technician, (ctx) => clockOn(ctx, { jobId: job.id, time: "08:00" }));
    await as(org.technician, (ctx) => clockOn(ctx, { jobId: second.id, time: "09:00" })); // switching closes the first
    await expect(as(org.technician, (ctx) => clockOff(ctx, { time: "08:30" }))).rejects.toThrow(ValidationError);
    await as(org.technician, (ctx) => clockOff(ctx, { time: "09:36" }));
    const clockings = await db.clocking.findMany({ where: { roId: ro.id }, orderBy: { startMinute: "asc" } });
    expect(clockings.map((c) => c.centiHours)).toEqual([100, 60]);
    // A technician cannot clock for a colleague; the workshop manager can.
    await expect(as(org.technician, (ctx) => clockOn(ctx, { jobId: job.id, technicianId: org.workshopManager.userId, time: "10:00" }))).rejects.toThrow(ForbiddenError);

    await makeReady(ro.id);
    await as(org.advisor, (ctx) => invoiceRepairOrder(ctx, ro.id, { paymentMethod: "CASH" }));
    const kpis = await as(org.workshopManager, (ctx) => getProductivity(ctx, { siteId: org.siteA.id, from: "2026-03-16", to: "2026-03-20" }));
    const me = kpis.rows.find((r) => r.id === org.technician.userId)!;
    expect(me).toMatchObject({ availableCentiHours: 780 * 5, clockedCentiHours: 160, billedCentiHours: 200, efficiencyBp: 12_500, productivityBp: 410 });
  });
});
