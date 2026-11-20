/**
 * Repair orders: check-in → jobs (labour, parts from stock, sublet) → additional work approved by
 * the customer → quality check → invoice per payer → hand-over. Parts leave stock as soon as a job
 * may go ahead; sublet purchases and revenue are booked at invoicing.
 */
import type { ServiceContext } from "@/lib/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { applyRate, sumCents } from "@/lib/money";
import { parseInput } from "@/lib/validation";
import { buildInternalWorkEntry, buildPurchaseEntry, createAndIssueInvoice, postEntry, recordPayment, type InvoiceInput } from "@/modules/accounting";
import { nextDocumentNumber, patchVehicle } from "@/modules/core";
import { issuePartsToRepairOrder, pricePartForWorkshop, returnPartsFromRepairOrder } from "@/modules/parts";
import { capitaliseRepairOrder } from "@/modules/sales";
import { Decimal } from "decimal.js";
import { jobTotal, labourAmount, labourRateFor, partAmount, partsPriceClassFor, revenueKeysFor, type JobPayer } from "../domain/pricing";
import { canHandOver, checkMileage, invoiceableJobs, isWorkable, jobMayProceed, readyForQualityCheck } from "../domain/workflow";
import {
  checkInInputSchema,
  jobDecisionInputSchema,
  jobInputSchema,
  labourLineInputSchema,
  qualityCheckInputSchema,
  roInvoiceInputSchema,
  roPartLineInputSchema,
  roPaymentInputSchema,
  subletLineInputSchema,
  type CheckInInput,
  type JobDecisionInput,
  type JobInput,
  type LabourLineInput,
  type QualityCheckInput,
  type RoInvoiceInput,
  type RoPartLineInput,
  type RoPaymentInput,
  type SubletLineInput,
} from "../schemas/workshop";
import { labourRates, loadRo, refreshTotals, requireRoStatus, siteCode, standardRateBp, type LoadedJob, type LoadedRo } from "./shared";

declare module "@/lib/events" {
  interface DomainEventMap {
    RepairOrderOpened: { roId: string; number: string; vehicleId: string; kind: "CUSTOMER" | "INTERNAL"; mileageIn: number };
    RepairOrderInvoiced: { roId: string; number: string; invoiceIds: string[]; claimIds: string[]; internalCents: number; costCents: number };
    RepairOrderClosed: { roId: string; number: string };
    JobDecided: { roId: string; jobId: string; approved: boolean; estimateCents: number };
  }
}

const OPEN_STATUSES = ["CHECKED_IN", "IN_PROGRESS", "QUALITY_CHECK", "READY"] as const;
const IN_STOCK = ["INTAKE", "RECONDITIONING", "FOR_SALE", "RESERVED"];

// ── Check-in ────────────────────────────────────────────────

/**
 * The car arrives: odometer, fuel, damages and the customer's signature are recorded and the RO
 * opens with a first job (the appointment's concern). An internal RO is for a used car in stock.
 */
export async function checkIn(ctx: ServiceContext, input: CheckInInput) {
  const data = parseInput(checkInInputSchema, input);
  ctx.require("workshop.repair_order", "create", data.siteId);
  const vehicle = await ctx.tx.vehicle.findUnique({ where: { id: data.vehicleId } });
  if (!vehicle) throw new ValidationError("Unknown vehicle", { vehicleId: ["Choose a vehicle"] });
  const mileage = checkMileage(data.mileageIn, vehicle.mileage);
  if (!mileage.ok) throw new ValidationError(mileage.reason!, { mileageIn: [mileage.reason!] });
  if (data.kind === "INTERNAL") {
    if (vehicle.stockType !== "VO" || vehicle.siteId !== data.siteId || !IN_STOCK.includes(vehicle.status)) {
      throw new ValidationError("Internal repair orders are for used cars in this site's stock", { vehicleId: ["Not a used car in stock here"] });
    }
  } else if (!(await ctx.tx.customer.findUnique({ where: { id: data.customerId! } }))) {
    throw new ValidationError("Unknown customer", { customerId: ["Choose a customer"] });
  }
  const open = await ctx.tx.repairOrder.findFirst({ where: { vehicleId: vehicle.id, status: { in: [...OPEN_STATUSES] } } });
  if (open) throw new ConflictError(`The car is already in the workshop on ${open.number}`);

  let appointment = null;
  if (data.appointmentId) {
    appointment = await ctx.tx.appointment.findUnique({ where: { id: data.appointmentId } });
    if (!appointment || appointment.siteId !== data.siteId || appointment.vehicleId !== vehicle.id) throw new ValidationError("Appointment does not match", { appointmentId: ["Another car or site"] });
    if (appointment.status !== "BOOKED") throw new ConflictError(`Appointment ${appointment.number} is ${appointment.status.toLowerCase()}`);
    await ctx.tx.appointment.update({ where: { id: appointment.id }, data: { status: "ARRIVED" } });
  }

  const number = await nextDocumentNumber(ctx, { docType: "REPAIR_ORDER", scope: data.siteId, sitePrefix: await siteCode(ctx.tx, data.siteId) });
  const ro = await ctx.tx.repairOrder.create({
    data: {
      number,
      siteId: data.siteId,
      kind: data.kind,
      appointmentId: appointment?.id ?? null,
      customerId: data.kind === "INTERNAL" ? null : data.customerId!,
      vehicleId: vehicle.id,
      advisorId: ctx.actor.userId,
      openedOn: ctx.businessDate,
      promisedOn: data.promisedOn ?? null,
      mileageIn: data.mileageIn,
      fuelLevelPct: data.fuelLevelPct,
      damages: data.damages,
      signedBy: data.signedBy ?? null,
      signatureDataUrl: data.signatureDataUrl ?? null,
      notes: data.notes ?? null,
    },
  });
  if (data.mileageIn > vehicle.mileage) await patchVehicle(ctx, vehicle.id, { mileage: data.mileageIn }, { trusted: true });
  const concern = data.concern ?? appointment?.concern;
  if (concern) {
    await ctx.tx.roJob.create({
      data: { roId: ro.id, lineNo: 1, description: concern.slice(0, 200), payer: data.kind === "INTERNAL" ? "INTERNAL" : "CUSTOMER", technicianId: appointment?.technicianId ?? null },
    });
  }
  await ctx.audit({ action: "repair_order.check_in", entityType: "RepairOrder", entityId: ro.id, after: { ...ro, signatureDataUrl: ro.signatureDataUrl ? "(signed)" : null }, siteId: ro.siteId });
  await ctx.emit({
    type: "RepairOrderOpened",
    aggregateType: "RepairOrder",
    aggregateId: ro.id,
    siteId: ro.siteId,
    payload: { roId: ro.id, number, vehicleId: vehicle.id, kind: data.kind, mileageIn: data.mileageIn },
  });
  return ro;
}

// ── Jobs ────────────────────────────────────────────────────

function findJob(ro: LoadedRo, jobId: string): LoadedJob {
  const job = ro.jobs.find((j) => j.id === jobId);
  if (!job) throw new NotFoundError("RoJob", jobId);
  return job;
}

/** Lines can change while the job is open and the car is still being worked on. */
function requireEditableJob(ro: LoadedRo, job: LoadedJob) {
  if (!isWorkable(ro.status)) requireRoStatus(ro, "CHECKED_IN", "IN_PROGRESS");
  if (job.status !== "OPEN" || job.approval === "DECLINED") throw new ConflictError(`Job ${job.lineNo} is ${job.status === "OPEN" ? "declined" : job.status.toLowerCase()}`);
}

async function checkPayer(ctx: ServiceContext, ro: LoadedRo, payer: JobPayer, payerCustomerId: string | null | undefined) {
  if (ro.kind === "INTERNAL" && payer !== "INTERNAL") throw new ValidationError("An internal repair order is paid internally", { payer: ["Internal only"] });
  if (ro.kind === "CUSTOMER" && payer === "INTERNAL") throw new ValidationError("Internal work is for used cars in stock", { payer: ["Customer, warranty or insurance"] });
  if (payer === "WARRANTY") {
    const brand = ro.vehicle.brandId ? await ctx.tx.brand.findUnique({ where: { id: ro.vehicle.brandId } }) : null;
    if (!brand?.oemCustomerId) throw new ValidationError("Warranty is claimed from the car's make, which has no manufacturer account", { payer: ["No warranty for this make"] });
  }
  if (payer === "INSURANCE") {
    const insurer = await ctx.tx.customer.findUnique({ where: { id: payerCustomerId! } });
    if (!insurer || insurer.kind === "INDIVIDUAL") throw new ValidationError("Choose the insurance company", { payerCustomerId: ["A company"] });
  }
}

export async function addJob(ctx: ServiceContext, roId: string, input: JobInput) {
  const data = parseInput(jobInputSchema, input);
  const ro = await loadRo(ctx, roId);
  requireRoStatus(ro, "CHECKED_IN", "IN_PROGRESS", "QUALITY_CHECK");
  await checkPayer(ctx, ro, data.payer, data.payerCustomerId);
  if (data.technicianId && !(await ctx.tx.technician.findFirst({ where: { userId: data.technicianId, siteId: ro.siteId, active: true } }))) {
    throw new ValidationError("Not a technician of this workshop", { technicianId: ["Choose a technician"] });
  }
  // Work found once the car is in needs the customer's go-ahead; nobody approves internal work.
  const needsApproval = data.isAdditional && data.payer === "CUSTOMER";
  const job = await ctx.tx.roJob.create({
    data: {
      roId,
      lineNo: Math.max(0, ...ro.jobs.map((j) => j.lineNo)) + 1,
      description: data.description,
      payer: data.payer,
      payerCustomerId: data.payer === "INSURANCE" ? data.payerCustomerId! : null,
      technicianId: data.technicianId ?? null,
      isAdditional: data.isAdditional,
      approval: needsApproval ? "PENDING" : "NOT_REQUIRED",
      estimateCents: needsApproval ? 0 : null,
    },
  });
  if (ro.status === "QUALITY_CHECK") await ctx.tx.repairOrder.update({ where: { id: roId }, data: { status: "IN_PROGRESS" } });
  await ctx.audit({ action: "repair_order.add_job", entityType: "RepairOrder", entityId: roId, after: job, siteId: ro.siteId });
  return job;
}

async function priceContext(ctx: ServiceContext, ro: LoadedRo, job: LoadedJob) {
  const rates = await labourRates(ctx.tx, ro.siteId, ro.vehicle.brandId);
  const customerClass = ro.customer?.priceClass ?? "RETAIL";
  return { rateCents: labourRateFor(job.payer, rates), priceClass: partsPriceClassFor(job.payer, customerClass) };
}

export async function addLabourLine(ctx: ServiceContext, roId: string, jobId: string, input: LabourLineInput) {
  const data = parseInput(labourLineInputSchema, input);
  const ro = await loadRo(ctx, roId);
  const job = findJob(ro, jobId);
  requireEditableJob(ro, job);
  let op = null;
  if (data.operationCode) {
    op = await ctx.tx.labourOperation.findUnique({ where: { code: data.operationCode } });
    if (!op || !op.active) throw new ValidationError("Unknown operation", { operationCode: ["Not in the labour catalogue"] });
    if (op.brandId && op.brandId !== ro.vehicle.brandId) throw new ValidationError("This operation is for another make", { operationCode: ["Another make"] });
  }
  const { rateCents } = await priceContext(ctx, ro, job);
  const centiHours = data.centiHours ?? op!.standardCentiHours;
  const line = await ctx.tx.roLabourLine.create({
    data: {
      jobId,
      operationId: op?.id ?? null,
      label: (data.label ?? op!.label).slice(0, 120),
      billedCentiHours: centiHours,
      rateCents,
      discountBp: data.discountBp,
      amountCents: labourAmount({ centiHours, rateCents, discountBp: data.discountBp }),
    },
  });
  await refreshTotals(ctx, roId);
  await ctx.audit({ action: "repair_order.add_labour", entityType: "RepairOrder", entityId: roId, after: { job: job.lineNo, ...line }, siteId: ro.siteId });
  return line;
}

export async function removeLabourLine(ctx: ServiceContext, roId: string, lineId: string) {
  const ro = await loadRo(ctx, roId);
  const job = ro.jobs.find((j) => j.labourLines.some((l) => l.id === lineId));
  if (!job) throw new NotFoundError("RoLabourLine", lineId);
  requireEditableJob(ro, job);
  const line = job.labourLines.find((l) => l.id === lineId)!;
  await ctx.tx.roLabourLine.delete({ where: { id: lineId } });
  await refreshTotals(ctx, roId);
  await ctx.audit({ action: "repair_order.remove_labour", entityType: "RepairOrder", entityId: roId, before: line, siteId: ro.siteId });
}

/** A part on a job, priced for its payer; it leaves stock now unless the job awaits approval. */
export async function addPartLine(ctx: ServiceContext, roId: string, jobId: string, input: RoPartLineInput) {
  const data = parseInput(roPartLineInputSchema, input);
  const ro = await loadRo(ctx, roId);
  const job = findJob(ro, jobId);
  requireEditableJob(ro, job);
  const { priceClass } = await priceContext(ctx, ro, job);
  const priced = await pricePartForWorkshop(ctx, { partNumber: data.partNumber, qty: data.qty, priceClass });
  const line = await ctx.tx.roPartLine.create({
    data: {
      jobId,
      partId: priced.part.id,
      requestedNumber: priced.requestedNumber,
      qty: priced.qty.toFixed(3),
      unitPriceCents: priced.unitPriceCents,
      discountBp: priced.discountBp,
      amountCents: partAmount({ qty: priced.qty.toNumber(), unitPriceCents: priced.unitPriceCents, discountBp: priced.discountBp }),
    },
  });
  if (jobMayProceed(job)) await issueLine(ctx, ro, { id: line.id, partId: priced.part.id, partNumber: priced.part.partNumber, qty: priced.qty });
  await refreshTotals(ctx, roId);
  await ctx.audit({
    action: "repair_order.add_part",
    entityType: "RepairOrder",
    entityId: roId,
    after: { job: job.lineNo, partNumber: priced.part.partNumber, requestedNumber: priced.requestedNumber, qty: data.qty, discountBp: priced.discountBp },
    siteId: ro.siteId,
  });
  return line;
}

async function issueLine(ctx: ServiceContext, ro: Pick<LoadedRo, "id" | "number" | "siteId">, l: { id: string; partId: string; partNumber: string; qty: Decimal }) {
  const out = await issuePartsToRepairOrder(ctx, { siteId: ro.siteId, partId: l.partId, partNumber: l.partNumber, qty: l.qty, roId: ro.id, roNumber: ro.number });
  await ctx.tx.roPartLine.update({ where: { id: l.id }, data: { issued: true, unitCostCents: out.unitCostCents.toFixed(4), costCents: out.costCents } });
}

async function returnLine(ctx: ServiceContext, ro: Pick<LoadedRo, "id" | "number" | "siteId">, l: LoadedJob["partLines"][number]) {
  if (!l.issued) return;
  await returnPartsFromRepairOrder(ctx, {
    siteId: ro.siteId,
    partId: l.partId,
    partNumber: l.part.partNumber,
    qty: new Decimal(l.qty.toString()),
    costCents: l.costCents ?? 0,
    roId: ro.id,
    roNumber: ro.number,
  });
}

export async function removePartLine(ctx: ServiceContext, roId: string, lineId: string) {
  const ro = await loadRo(ctx, roId);
  const job = ro.jobs.find((j) => j.partLines.some((l) => l.id === lineId));
  if (!job) throw new NotFoundError("RoPartLine", lineId);
  requireEditableJob(ro, job);
  const line = job.partLines.find((l) => l.id === lineId)!;
  await returnLine(ctx, ro, line);
  await ctx.tx.roPartLine.delete({ where: { id: lineId } });
  await refreshTotals(ctx, roId);
  await ctx.audit({ action: "repair_order.remove_part", entityType: "RepairOrder", entityId: roId, before: { partNumber: line.part.partNumber, qty: line.qty, returned: line.issued }, siteId: ro.siteId });
}

export async function addSubletLine(ctx: ServiceContext, roId: string, jobId: string, input: SubletLineInput) {
  const data = parseInput(subletLineInputSchema, input);
  const ro = await loadRo(ctx, roId);
  const job = findJob(ro, jobId);
  requireEditableJob(ro, job);
  if (!(await ctx.tx.supplier.findUnique({ where: { id: data.supplierId } }))) throw new ValidationError("Unknown supplier", { supplierId: ["Choose a supplier"] });
  if (data.costCents <= 0) throw new ValidationError("Enter the sublet cost", { costCents: ["Must be positive"] });
  const line = await ctx.tx.roSubletLine.create({ data: { jobId, ...data, supplierReference: data.supplierReference ?? null } });
  await refreshTotals(ctx, roId);
  await ctx.audit({ action: "repair_order.add_sublet", entityType: "RepairOrder", entityId: roId, after: { job: job.lineNo, ...line }, siteId: ro.siteId });
  return line;
}

export async function removeSubletLine(ctx: ServiceContext, roId: string, lineId: string) {
  const ro = await loadRo(ctx, roId);
  const job = ro.jobs.find((j) => j.subletLines.some((l) => l.id === lineId));
  if (!job) throw new NotFoundError("RoSubletLine", lineId);
  requireEditableJob(ro, job);
  const line = job.subletLines.find((l) => l.id === lineId)!;
  await ctx.tx.roSubletLine.delete({ where: { id: lineId } });
  await refreshTotals(ctx, roId);
  await ctx.audit({ action: "repair_order.remove_sublet", entityType: "RepairOrder", entityId: roId, before: line, siteId: ro.siteId });
}

/** The customer answers the estimate for additional work: approved parts are issued, declined work is dropped. */
export async function decideJob(ctx: ServiceContext, roId: string, jobId: string, input: JobDecisionInput) {
  const data = parseInput(jobDecisionInputSchema, input);
  const ro = await loadRo(ctx, roId);
  const job = findJob(ro, jobId);
  if (job.approval !== "PENDING") throw new ConflictError(`Job ${job.lineNo} is not waiting for approval`);
  requireRoStatus(ro, "CHECKED_IN", "IN_PROGRESS", "QUALITY_CHECK");
  const estimateCents = jobTotal({ labour: job.labourLines, parts: job.partLines, sublet: job.subletLines });
  if (data.approve) {
    for (const l of job.partLines.filter((l) => !l.issued)) {
      await issueLine(ctx, ro, { id: l.id, partId: l.partId, partNumber: l.part.partNumber, qty: new Decimal(l.qty.toString()) });
    }
  }
  await ctx.tx.roJob.update({
    where: { id: jobId },
    data: {
      approval: data.approve ? "APPROVED" : "DECLINED",
      status: data.approve ? "OPEN" : "DECLINED",
      estimateCents,
      approvalNote: data.note ?? null,
      decidedOn: ctx.businessDate,
    },
  });
  await refreshTotals(ctx, roId);
  if (!data.approve) await advanceIfDone(ctx, roId);
  await ctx.audit({ action: data.approve ? "repair_order.approve_job" : "repair_order.decline_job", entityType: "RepairOrder", entityId: roId, after: { job: job.lineNo, estimateCents, note: data.note }, siteId: ro.siteId });
  await ctx.emit({ type: "JobDecided", aggregateType: "RepairOrder", aggregateId: roId, siteId: ro.siteId, payload: { roId, jobId, approved: data.approve, estimateCents } });
}

/** All work finished → the car waits for quality control. */
async function advanceIfDone(ctx: ServiceContext, roId: string) {
  const ro = await ctx.tx.repairOrder.findUniqueOrThrow({ where: { id: roId }, include: { jobs: true } });
  if (ro.status !== "IN_PROGRESS" && ro.status !== "CHECKED_IN") return;
  if (readyForQualityCheck(ro.jobs).ok) await ctx.tx.repairOrder.update({ where: { id: roId }, data: { status: "QUALITY_CHECK" } });
}

export async function completeJob(ctx: ServiceContext, roId: string, jobId: string) {
  const ro = await loadRo(ctx, roId);
  const job = findJob(ro, jobId);
  requireRoStatus(ro, "CHECKED_IN", "IN_PROGRESS");
  if (job.status !== "OPEN" || !jobMayProceed(job)) throw new ConflictError(`Job ${job.lineNo} cannot be finished (${job.approval === "PENDING" ? "awaiting approval" : job.status.toLowerCase()})`);
  const open = await ctx.tx.clocking.findFirst({ where: { jobId, endMinute: null } });
  if (open) throw new ConflictError("A technician is still clocked on this job");
  await ctx.tx.roJob.update({ where: { id: jobId }, data: { status: "DONE", completedOn: ctx.businessDate } });
  if (ro.status === "CHECKED_IN") await ctx.tx.repairOrder.update({ where: { id: roId }, data: { status: "IN_PROGRESS" } });
  await advanceIfDone(ctx, roId);
  await ctx.audit({ action: "repair_order.complete_job", entityType: "RepairOrder", entityId: roId, after: { job: job.lineNo }, siteId: ro.siteId });
}

export async function reopenJob(ctx: ServiceContext, roId: string, jobId: string) {
  const ro = await loadRo(ctx, roId);
  const job = findJob(ro, jobId);
  requireRoStatus(ro, "IN_PROGRESS", "QUALITY_CHECK");
  if (job.status !== "DONE") throw new ConflictError(`Job ${job.lineNo} is not finished`);
  await ctx.tx.roJob.update({ where: { id: jobId }, data: { status: "OPEN", completedOn: null } });
  await ctx.tx.repairOrder.update({ where: { id: roId }, data: { status: "IN_PROGRESS" } });
  await ctx.audit({ action: "repair_order.reopen_job", entityType: "RepairOrder", entityId: roId, after: { job: job.lineNo }, siteId: ro.siteId });
}

/** Quality control by the workshop manager: the car is ready, or goes back to the technicians. */
export async function qualityCheck(ctx: ServiceContext, roId: string, input: QualityCheckInput) {
  const data = parseInput(qualityCheckInputSchema, input);
  const ro = await loadRo(ctx, roId, "validate");
  requireRoStatus(ro, "QUALITY_CHECK");
  const status = data.pass ? "READY" : "IN_PROGRESS";
  const saved = await ctx.tx.repairOrder.update({
    where: { id: roId },
    data: { status, qcById: ctx.actor.userId, qcOn: ctx.businessDate, qcNotes: data.notes ?? null, readyOn: data.pass ? ctx.businessDate : null },
  });
  await ctx.audit({ action: data.pass ? "repair_order.qc_pass" : "repair_order.qc_fail", entityType: "RepairOrder", entityId: roId, before: { status: ro.status }, after: { status, notes: data.notes }, siteId: ro.siteId });
  return saved;
}

// ── Invoicing ───────────────────────────────────────────────

function invoiceLines(job: LoadedJob): InvoiceInput["lines"] {
  const keys = revenueKeysFor(job.payer);
  const prefix = `${job.lineNo}. `;
  return [
    ...job.labourLines.map((l) => ({
      label: `${prefix}${l.label}`.slice(0, 200),
      quantity: l.billedCentiHours / 100,
      unitPriceExclVatCents: l.rateCents,
      discountBp: l.discountBp,
      vatRateCode: "STANDARD",
      departmentCode: "WORKSHOP" as const,
      revenueKey: keys.labour,
    })),
    ...job.partLines.map((p) => ({
      label: `${prefix}${p.part.partNumber} ${p.part.description}`.slice(0, 200),
      quantity: Number(p.qty.toString()),
      unitPriceExclVatCents: p.unitPriceCents,
      discountBp: p.discountBp,
      vatRateCode: p.part.vatRateCode,
      departmentCode: "PARTS" as const,
      revenueKey: keys.parts,
    })),
    ...job.subletLines.map((s) => ({
      label: `${prefix}${s.label}`.slice(0, 200),
      quantity: 1,
      unitPriceExclVatCents: s.priceCents,
      discountBp: 0,
      vatRateCode: "STANDARD",
      departmentCode: "WORKSHOP" as const,
      revenueKey: keys.sublet,
    })),
  ];
}

const hasLines = (j: LoadedJob) => j.labourLines.length + j.partLines.length + j.subletLines.length > 0;

/**
 * Invoice a ready car, one document per payer:
 * - customer jobs → one invoice to the RO's customer (paid at the desk or on account);
 * - insurance jobs → one invoice per insurer;
 * - warranty jobs → one invoice per job to the make's OEM account (411100) and a warranty claim;
 * - internal jobs → an internal sale (OD) to used-car reconditioning, added to the car's stock value.
 * Sublet work is bought from its supplier at the same time (Dr 604000 + VAT / Cr 401).
 */
export async function invoiceRepairOrder(ctx: ServiceContext, roId: string, input: RoInvoiceInput = {}) {
  const data = parseInput(roInvoiceInputSchema, input);
  const ro = await loadRo(ctx, roId, "validate");
  requireRoStatus(ro, "READY");
  const jobs = invoiceableJobs(ro.jobs).filter(hasLines);
  if (!jobs.length) throw new ConflictError("Nothing to invoice on this repair order");
  if (jobs.some((j) => j.approval === "PENDING")) throw new ConflictError("A job is still waiting for the customer's approval");
  const reg = ro.vehicle.registration ?? ro.vehicle.vin;
  const notes = `Repair order ${ro.number} — ${ro.vehicle.make} ${ro.vehicle.model} ${reg} — ${ro.mileageIn} km`;
  const invoiceIds: string[] = [];
  const claimIds: string[] = [];
  let customerInvoice: { id: string; totalInclVatCents: number } | null = null;

  async function issue(customerId: string, list: LoadedJob[]) {
    const invoice = await createAndIssueInvoice(
      ctx,
      { siteId: ro.siteId, customerId, sourceType: "REPAIR_ORDER", sourceId: ro.id, notes, lines: list.flatMap(invoiceLines) },
      { trusted: true },
    );
    await ctx.tx.roJob.updateMany({ where: { id: { in: list.map((j) => j.id) } }, data: { invoiceId: invoice.id } });
    invoiceIds.push(invoice.id);
    return invoice;
  }

  const customerJobs = jobs.filter((j) => j.payer === "CUSTOMER");
  if (customerJobs.length) customerInvoice = await issue(ro.customerId!, customerJobs);
  const insurers = new Map<string, LoadedJob[]>();
  for (const j of jobs.filter((j) => j.payer === "INSURANCE")) insurers.set(j.payerCustomerId!, [...(insurers.get(j.payerCustomerId!) ?? []), j]);
  for (const [insurerId, list] of insurers) await issue(insurerId, list);

  const warrantyJobs = jobs.filter((j) => j.payer === "WARRANTY");
  if (warrantyJobs.length) {
    const brand = await ctx.tx.brand.findUniqueOrThrow({ where: { id: ro.vehicle.brandId! } });
    const prefix = await siteCode(ctx.tx, ro.siteId);
    for (const job of warrantyJobs) {
      const invoice = await issue(brand.oemCustomerId!, [job]);
      const number = await nextDocumentNumber(ctx, { docType: "WARRANTY_CLAIM", scope: ro.siteId, sitePrefix: prefix });
      const claim = await ctx.tx.warrantyClaim.create({
        data: { number, siteId: ro.siteId, roId: ro.id, jobId: job.id, brandId: brand.id, invoiceId: invoice.id, claimedCents: invoice.totalInclVatCents, submittedOn: ctx.businessDate },
      });
      claimIds.push(claim.id);
      await ctx.audit({ action: "warranty_claim.submit", entityType: "WarrantyClaim", entityId: claim.id, after: claim, siteId: ro.siteId });
    }
  }

  let internalCents = 0;
  let internalEntryId: string | null = null;
  const internalJobs = jobs.filter((j) => j.payer === "INTERNAL");
  if (internalJobs.length) {
    const labour = sumCents(internalJobs.flatMap((j) => j.labourLines.map((l) => l.amountCents)));
    const parts = sumCents(internalJobs.flatMap((j) => j.partLines.map((l) => l.amountCents)));
    const sublet = sumCents(internalJobs.flatMap((j) => j.subletLines.map((l) => l.priceCents)));
    internalCents = labour + parts + sublet;
    if (internalCents > 0) {
      const label = `Internal repair order ${ro.number} — ${ro.vehicle.make} ${ro.vehicle.model} ${reg}`;
      const entry = await postEntry(
        ctx,
        buildInternalWorkEntry({
          siteId: ro.siteId,
          date: ctx.businessDate,
          label,
          sourceType: "REPAIR_ORDER",
          sourceId: ro.id,
          debit: { account: { key: "PURCHASE_RECONDITIONING" }, departmentCode: "VO" },
          credits: [
            { account: { key: "REVENUE_INTERNAL_LABOUR" }, amountCents: labour, departmentCode: "WORKSHOP" },
            { account: { key: "REVENUE_INTERNAL_PARTS" }, amountCents: parts, departmentCode: "PARTS" },
            { account: { key: "REVENUE_SUBLET" }, amountCents: sublet, departmentCode: "WORKSHOP" },
          ],
        }),
        { brandId: ro.vehicle.brandId },
      );
      internalEntryId = entry.id;
      await capitaliseRepairOrder(ctx, { vehicleId: ro.vehicleId, roId: ro.id, amountCents: internalCents, label: `Repair order ${ro.number}` }, { trusted: true });
    }
  }

  // Sublet work is bought now, for every job that is invoiced.
  const sublets = jobs.flatMap((j) => j.subletLines);
  if (sublets.length) {
    const rate = await standardRateBp(ctx.tx, ro.siteId, ctx.businessDate);
    for (const s of sublets) {
      await postEntry(
        ctx,
        buildPurchaseEntry({
          siteId: ro.siteId,
          date: ctx.businessDate,
          label: `${ro.number} — sublet: ${s.label}${s.supplierReference ? ` (${s.supplierReference})` : ""}`,
          sourceType: "REPAIR_ORDER",
          sourceId: ro.id,
          lines: [{ account: { key: "PURCHASE_SUBLET" }, amountCents: s.costCents, departmentCode: "WORKSHOP" }],
          vatCents: applyRate(s.costCents, rate),
          credit: { account: { key: "PAYABLE_SUPPLIER" }, partyType: "SUPPLIER", partyId: s.supplierId },
        }),
        { brandId: ro.vehicle.brandId },
      );
    }
  }

  if (data.paymentMethod && customerInvoice) {
    await recordPayment(
      ctx,
      {
        siteId: ro.siteId,
        direction: "IN",
        method: data.paymentMethod,
        customerId: ro.customerId!,
        amountCents: customerInvoice.totalInclVatCents,
        reference: `Repair order ${ro.number}`,
        allocations: [{ invoiceId: customerInvoice.id, amountCents: customerInvoice.totalInclVatCents }],
      },
      { trusted: true },
    );
  }

  const costCents =
    sumCents(jobs.flatMap((j) => j.partLines.map((l) => l.costCents ?? 0))) + sumCents(sublets.map((s) => s.costCents));
  const saved = await ctx.tx.repairOrder.update({
    where: { id: roId },
    data: { status: "INVOICED", invoicedOn: ctx.businessDate, customerInvoiceId: customerInvoice?.id ?? null, internalEntryId, costCents },
  });
  await ctx.audit({
    action: "repair_order.invoice",
    entityType: "RepairOrder",
    entityId: roId,
    before: { status: ro.status },
    after: { status: "INVOICED", invoiceIds, claimIds, internalCents, costCents, paid: data.paymentMethod ?? null },
    siteId: ro.siteId,
  });
  await ctx.emit({
    type: "RepairOrderInvoiced",
    aggregateType: "RepairOrder",
    aggregateId: roId,
    siteId: ro.siteId,
    payload: { roId, number: ro.number, invoiceIds, claimIds, internalCents, costCents },
  });
  return saved;
}

/** The customer pays what is still due on the RO's invoice. */
export async function recordRoPayment(ctx: ServiceContext, roId: string, input: RoPaymentInput) {
  const data = parseInput(roPaymentInputSchema, input);
  const ro = await loadRo(ctx, roId, "validate");
  requireRoStatus(ro, "INVOICED", "CLOSED");
  if (!ro.customerInvoiceId) throw new ConflictError("Nothing is due from the customer");
  const invoice = await ctx.tx.invoice.findUniqueOrThrow({ where: { id: ro.customerInvoiceId } });
  const due = invoice.totalInclVatCents - invoice.paidCents;
  if (due <= 0) throw new ConflictError(`Invoice ${invoice.number} is already paid`);
  const payment = await recordPayment(
    ctx,
    {
      siteId: ro.siteId,
      direction: "IN",
      method: data.method,
      customerId: invoice.customerId,
      amountCents: due,
      reference: `Repair order ${ro.number}`,
      allocations: [{ invoiceId: invoice.id, amountCents: due }],
    },
    { trusted: true },
  );
  await ctx.audit({ action: "repair_order.payment", entityType: "RepairOrder", entityId: roId, after: { method: data.method, amountCents: due }, siteId: ro.siteId });
  return payment;
}

/** The customer collects the car: paid, or on account for customers with payment terms. */
export async function closeRepairOrder(ctx: ServiceContext, roId: string) {
  const ro = await loadRo(ctx, roId);
  let balance = 0;
  if (ro.customerInvoiceId) {
    const inv = await ctx.tx.invoice.findUniqueOrThrow({ where: { id: ro.customerInvoiceId } });
    balance = inv.totalInclVatCents - inv.paidCents;
  }
  const check = canHandOver({ status: ro.status, customerBalanceCents: balance, customerTermsDays: ro.customer?.paymentTermsDays ?? 0 });
  if (!check.ok) throw new ConflictError(check.reason!);
  const saved = await ctx.tx.repairOrder.update({ where: { id: roId }, data: { status: "CLOSED", closedOn: ctx.businessDate } });
  await ctx.audit({ action: "repair_order.close", entityType: "RepairOrder", entityId: roId, before: { status: ro.status }, after: { status: "CLOSED" }, siteId: ro.siteId });
  await ctx.emit({ type: "RepairOrderClosed", aggregateType: "RepairOrder", aggregateId: roId, siteId: ro.siteId, payload: { roId, number: ro.number } });
  return saved;
}

/** Cancel before invoicing: parts go back to the shelf; work already clocked must be invoiced instead. */
export async function cancelRepairOrder(ctx: ServiceContext, roId: string, reason?: string) {
  const ro = await loadRo(ctx, roId, "validate");
  requireRoStatus(ro, "CHECKED_IN", "IN_PROGRESS", "QUALITY_CHECK", "READY");
  if (await ctx.tx.clocking.count({ where: { roId } })) throw new ConflictError("Technicians have clocked time on this repair order: invoice it instead");
  for (const job of ro.jobs) for (const l of job.partLines) await returnLine(ctx, ro, l);
  await ctx.tx.roPartLine.updateMany({ where: { job: { roId } }, data: { issued: false } });
  const saved = await ctx.tx.repairOrder.update({ where: { id: roId }, data: { status: "CANCELLED", cancelledOn: ctx.businessDate, notes: [ro.notes, reason].filter(Boolean).join(" — ") || null } });
  await ctx.audit({ action: "repair_order.cancel", entityType: "RepairOrder", entityId: roId, before: { status: ro.status }, after: { status: "CANCELLED", reason }, siteId: ro.siteId });
  return saved;
}
