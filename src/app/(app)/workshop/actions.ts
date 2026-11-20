"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { command } from "@/lib/session";
import { formDataToObject } from "@/lib/validation";
import {
  addJob,
  addLabourLine,
  addPartLine,
  addSubletLine,
  bookAppointment,
  cancelAppointment,
  cancelRepairOrder,
  checkIn,
  clockOff,
  clockOn,
  closeRepairOrder,
  completeJob,
  createLabourOperation,
  decideJob,
  decideWarrantyClaim,
  invoiceRepairOrder,
  qualityCheck,
  recordRoPayment,
  recordWarrantyRemittance,
  removeLabourLine,
  removePartLine,
  removeSubletLine,
  reopenJob,
  updateLabourOperation,
  type AppointmentInput,
  type CheckInInput,
  type ClaimDecisionInput,
  type ClockOffInput,
  type ClockOnInput,
  type JobDecisionInput,
  type JobInput,
  type LabourLineInput,
  type LabourOperationInput,
  type QualityCheckInput,
  type RoInvoiceInput,
  type RoPartLineInput,
  type RoPaymentInput,
  type SubletLineInput,
  type WarrantyRemittanceInput,
} from "@/modules/workshop";
import type { FormState } from "@/components/shared/form";

const ok = (id: string, redirectTo?: string): FormState => ({ ok: true, data: { id, redirectTo } });

function revalidateWorkshop() {
  revalidatePath("/workshop", "layout");
  revalidatePath("/dashboard");
}
function revalidateMoney() {
  revalidatePath("/accounting", "layout");
  revalidatePath("/parts", "layout");
  revalidatePath("/sales", "layout");
}

// ── Appointments and check-in ───────────────────────────────

export async function bookAppointmentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => bookAppointment(ctx, formDataToObject(fd) as AppointmentInput));
  if (!res.ok) return res;
  revalidateWorkshop();
  return ok(res.data.id, `/workshop/planner?site=${res.data.siteId}&week=${res.data.date.toISOString().slice(0, 10)}`);
}

export async function cancelAppointmentAction(id: string, noShow: boolean): Promise<FormState> {
  const res = await command((ctx) => cancelAppointment(ctx, id, noShow));
  if (!res.ok) return res;
  revalidateWorkshop();
  return ok(id);
}

export async function checkInAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => checkIn(ctx, formDataToObject(fd) as CheckInInput));
  if (!res.ok) return res;
  revalidateWorkshop();
  revalidatePath("/vehicles", "layout");
  return ok(res.data.id, `/workshop/repair-orders/${res.data.id}`);
}

// ── Jobs and lines ──────────────────────────────────────────

async function done(roId: string, res: { ok: boolean }, money = false): Promise<FormState> {
  if (!res.ok) return res as FormState;
  revalidateWorkshop();
  if (money) revalidateMoney();
  return ok(roId);
}

export async function addJobAction(roId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return done(roId, await command((ctx) => addJob(ctx, roId, formDataToObject(fd) as JobInput)));
}
export async function addLabourLineAction(roId: string, jobId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return done(roId, await command((ctx) => addLabourLine(ctx, roId, jobId, formDataToObject(fd) as LabourLineInput)));
}
export async function removeLabourLineAction(roId: string, lineId: string): Promise<FormState> {
  return done(roId, await command((ctx) => removeLabourLine(ctx, roId, lineId)));
}
export async function addPartLineAction(roId: string, jobId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return done(roId, await command((ctx) => addPartLine(ctx, roId, jobId, formDataToObject(fd) as RoPartLineInput)), true);
}
export async function removePartLineAction(roId: string, lineId: string): Promise<FormState> {
  return done(roId, await command((ctx) => removePartLine(ctx, roId, lineId)), true);
}
export async function addSubletLineAction(roId: string, jobId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return done(roId, await command((ctx) => addSubletLine(ctx, roId, jobId, formDataToObject(fd) as SubletLineInput)));
}
export async function removeSubletLineAction(roId: string, lineId: string): Promise<FormState> {
  return done(roId, await command((ctx) => removeSubletLine(ctx, roId, lineId)));
}
export async function decideJobAction(roId: string, jobId: string, approve: boolean): Promise<FormState> {
  return done(roId, await command((ctx) => decideJob(ctx, roId, jobId, { approve } as JobDecisionInput)), true);
}
export async function completeJobAction(roId: string, jobId: string): Promise<FormState> {
  return done(roId, await command((ctx) => completeJob(ctx, roId, jobId)));
}
export async function reopenJobAction(roId: string, jobId: string): Promise<FormState> {
  return done(roId, await command((ctx) => reopenJob(ctx, roId, jobId)));
}

// ── Quality check, invoicing, hand-over ─────────────────────

export async function qualityCheckAction(roId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const input = { ...formDataToObject(fd), pass: fd.get("result") === "pass" } as QualityCheckInput;
  return done(roId, await command((ctx) => qualityCheck(ctx, roId, input)));
}

export async function invoiceRepairOrderAction(roId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => invoiceRepairOrder(ctx, roId, formDataToObject(fd) as RoInvoiceInput));
  if (!res.ok) return res;
  revalidateWorkshop();
  revalidateMoney();
  redirect(`/workshop/repair-orders/${roId}`);
}

export async function recordRoPaymentAction(roId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return done(roId, await command((ctx) => recordRoPayment(ctx, roId, formDataToObject(fd) as RoPaymentInput)), true);
}

export async function closeRepairOrderAction(roId: string): Promise<FormState> {
  return done(roId, await command((ctx) => closeRepairOrder(ctx, roId)));
}

export async function cancelRepairOrderAction(roId: string): Promise<FormState> {
  return done(roId, await command((ctx) => cancelRepairOrder(ctx, roId)), true);
}

// ── Clocking ────────────────────────────────────────────────

export async function clockOnAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => clockOn(ctx, formDataToObject(fd) as ClockOnInput));
  if (!res.ok) return res;
  revalidateWorkshop();
  return ok(res.data.id);
}

export async function clockOffAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => clockOff(ctx, formDataToObject(fd) as ClockOffInput));
  if (!res.ok) return res;
  revalidateWorkshop();
  return ok(res.data.id);
}

// ── Warranty ────────────────────────────────────────────────

export async function decideClaimAction(claimId: string, decision: "ACCEPTED" | "REJECTED"): Promise<FormState> {
  const res = await command((ctx) => decideWarrantyClaim(ctx, claimId, { decision } as ClaimDecisionInput));
  if (!res.ok) return res;
  revalidateWorkshop();
  revalidateMoney();
  return ok(claimId);
}

export async function warrantyRemittanceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => recordWarrantyRemittance(ctx, formDataToObject(fd) as WarrantyRemittanceInput));
  if (!res.ok) return res;
  revalidateWorkshop();
  revalidateMoney();
  return ok(res.data.id);
}

// ── Labour catalogue ────────────────────────────────────────

export async function createLabourOperationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => createLabourOperation(ctx, formDataToObject(fd) as LabourOperationInput));
  if (!res.ok) return res;
  revalidateWorkshop();
  return ok(res.data.id, "/workshop/labour-operations");
}

export async function updateLabourOperationAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => updateLabourOperation(ctx, id, formDataToObject(fd) as LabourOperationInput));
  if (!res.ok) return res;
  revalidateWorkshop();
  return ok(id, "/workshop/labour-operations");
}
