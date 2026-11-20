/** Repair order and job rules (pure): what may happen in which state. */

export type RoStatus = "CHECKED_IN" | "IN_PROGRESS" | "QUALITY_CHECK" | "READY" | "INVOICED" | "CLOSED" | "CANCELLED";
export type JobApproval = "NOT_REQUIRED" | "PENDING" | "APPROVED" | "DECLINED";
export type JobStatus = "OPEN" | "DONE" | "DECLINED";

/** Lines can be added and jobs worked on until the car passes quality control. */
export function isWorkable(status: RoStatus): boolean {
  return status === "CHECKED_IN" || status === "IN_PROGRESS";
}

/** A job may be worked on (clocked, parts issued) unless it waits for, or was refused, approval. */
export function jobMayProceed(job: { approval: JobApproval; status: JobStatus }): boolean {
  return job.status !== "DECLINED" && (job.approval === "NOT_REQUIRED" || job.approval === "APPROVED");
}

/** Jobs that end up on an invoice: everything not declined. Pending jobs block invoicing. */
export function invoiceableJobs<T extends { approval: JobApproval; status: JobStatus }>(jobs: readonly T[]): T[] {
  return jobs.filter((j) => j.status !== "DECLINED" && j.approval !== "DECLINED");
}

export function readyForQualityCheck(jobs: readonly { approval: JobApproval; status: JobStatus }[]): { ok: boolean; reason?: string } {
  const live = invoiceableJobs(jobs);
  if (!live.length) return { ok: false, reason: "The repair order has no job to check" };
  if (live.some((j) => j.approval === "PENDING")) return { ok: false, reason: "A job is still waiting for the customer's approval" };
  if (live.some((j) => j.status !== "DONE")) return { ok: false, reason: "Every job must be finished first" };
  return { ok: true };
}

/**
 * The car can leave once invoiced, if the customer's part is settled or the customer has
 * payment terms (assumption 11: individuals pay at collection, companies on account).
 */
export function canHandOver(a: { status: RoStatus; customerBalanceCents: number; customerTermsDays: number }): { ok: boolean; reason?: string } {
  if (a.status !== "INVOICED") return { ok: false, reason: "Invoice the repair order first" };
  if (a.customerBalanceCents > 0 && a.customerTermsDays === 0) return { ok: false, reason: "The customer must pay before collecting the car" };
  return { ok: true };
}

/** New mileage at check-in: whole kilometres, never below what the car already showed. */
export function checkMileage(mileageIn: number, known: number): { ok: boolean; reason?: string } {
  if (!Number.isInteger(mileageIn) || mileageIn < 0) return { ok: false, reason: "Enter the odometer reading in km" };
  if (mileageIn < known) return { ok: false, reason: `Lower than the last known mileage (${known} km)` };
  return { ok: true };
}
