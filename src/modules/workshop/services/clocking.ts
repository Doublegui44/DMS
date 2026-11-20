/** Technicians clock on and off jobs (minutes of the business day); clocked time drives efficiency. */
import type { ServiceContext } from "@/lib/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { clockedCentiHours, formatMinute } from "../domain/time";
import { isWorkable, jobMayProceed } from "../domain/workflow";
import { clockOffInputSchema, clockOnInputSchema, type ClockOffInput, type ClockOnInput } from "../schemas/workshop";
import { completeJob } from "./repair-orders";

declare module "@/lib/events" {
  interface DomainEventMap {
    ClockedOff: { clockingId: string; roId: string; jobId: string; technicianId: string; centiHours: number };
  }
}

/** Clocking for oneself needs `create`; for another technician, the workshop manager's `validate`. */
function requireClockingRight(ctx: ServiceContext, technicianId: string, siteId: string) {
  ctx.require("workshop.clocking", "create", siteId);
  if (technicianId !== ctx.actor.userId) ctx.require("workshop.clocking", "validate", siteId);
}

async function closeOpen(ctx: ServiceContext, open: { id: string; roId: string; jobId: string; technicianId: string; startMinute: number; businessDate: Date }, endMinute: number) {
  if (endMinute < open.startMinute) throw new ValidationError(`Clocked on at ${formatMinute(open.startMinute)}`, { time: [`After ${formatMinute(open.startMinute)}`] });
  const centiHours = clockedCentiHours(open.startMinute, endMinute);
  const saved = await ctx.tx.clocking.update({ where: { id: open.id }, data: { endMinute, centiHours } });
  await ctx.emit({
    type: "ClockedOff",
    aggregateType: "RepairOrder",
    aggregateId: open.roId,
    payload: { clockingId: open.id, roId: open.roId, jobId: open.jobId, technicianId: open.technicianId, centiHours },
  });
  return saved;
}

/** Start work on a job. A clocking still open today is closed at the same minute (switching jobs). */
export async function clockOn(ctx: ServiceContext, input: ClockOnInput) {
  const data = parseInput(clockOnInputSchema, input);
  const job = await ctx.tx.roJob.findUnique({ where: { id: data.jobId }, include: { ro: true } });
  if (!job) throw new NotFoundError("RoJob", data.jobId);
  const technicianId = data.technicianId ?? ctx.actor.userId;
  if (!technicianId) throw new ValidationError("Choose a technician", { technicianId: ["Required"] });
  requireClockingRight(ctx, technicianId, job.ro.siteId);
  const tech = await ctx.tx.technician.findUnique({ where: { userId: technicianId } });
  if (!tech || !tech.active || tech.siteId !== job.ro.siteId) throw new ValidationError("Not a technician of this workshop", { technicianId: ["Choose a technician"] });
  if (!isWorkable(job.ro.status)) throw new ConflictError(`Repair order ${job.ro.number} is ${job.ro.status.toLowerCase().replace("_", " ")}`);
  if (job.status !== "OPEN" || !jobMayProceed(job)) throw new ConflictError(`Job ${job.lineNo} cannot be worked on (${job.approval === "PENDING" ? "awaiting approval" : job.status.toLowerCase()})`);

  const open = await ctx.tx.clocking.findFirst({ where: { technicianId, endMinute: null } });
  if (open) {
    if (open.businessDate.getTime() !== ctx.businessDate.getTime()) throw new ConflictError("Clock off the job left open on a previous day first");
    if (open.jobId === job.id) throw new ConflictError("Already clocked on this job");
    await closeOpen(ctx, open, data.time);
  }
  const clocking = await ctx.tx.clocking.create({
    data: { siteId: job.ro.siteId, roId: job.roId, jobId: job.id, technicianId, businessDate: ctx.businessDate, startMinute: data.time },
  });
  if (!job.technicianId) await ctx.tx.roJob.update({ where: { id: job.id }, data: { technicianId } });
  if (job.ro.status === "CHECKED_IN") await ctx.tx.repairOrder.update({ where: { id: job.roId }, data: { status: "IN_PROGRESS" } });
  await ctx.audit({ action: "clocking.on", entityType: "RepairOrder", entityId: job.roId, after: { job: job.lineNo, technicianId, at: formatMinute(data.time) }, siteId: job.ro.siteId });
  return clocking;
}

/** Stop the open clocking; `jobDone` also marks the job finished. */
export async function clockOff(ctx: ServiceContext, input: ClockOffInput) {
  const data = parseInput(clockOffInputSchema, input);
  const technicianId = data.technicianId ?? ctx.actor.userId;
  if (!technicianId) throw new ValidationError("Choose a technician", { technicianId: ["Required"] });
  const open = await ctx.tx.clocking.findFirst({ where: { technicianId, endMinute: null } });
  if (!open) throw new ConflictError("Not clocked on any job");
  requireClockingRight(ctx, technicianId, open.siteId);
  const saved = await closeOpen(ctx, open, data.time);
  await ctx.audit({ action: "clocking.off", entityType: "RepairOrder", entityId: open.roId, after: { technicianId, at: formatMinute(data.time), centiHours: saved.centiHours }, siteId: open.siteId });
  if (data.jobDone) await completeJob(ctx, open.roId, open.jobId);
  return saved;
}
