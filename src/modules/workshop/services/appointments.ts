/** Workshop appointments: booked against a technician's daily capacity. */
import type { ServiceContext } from "@/lib/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { nextDocumentNumber } from "@/modules/core";
import { fitsCapacity } from "../domain/productivity";
import { formatHours } from "../domain/time";
import { appointmentInputSchema, type AppointmentInput } from "../schemas/workshop";
import { siteCode } from "./shared";

declare module "@/lib/events" {
  interface DomainEventMap {
    AppointmentBooked: { appointmentId: string; number: string; date: string; technicianId: string | null };
  }
}

/** Hours already booked for a technician on a day (live appointments). */
export async function bookedCentiHours(ctx: ServiceContext, technicianId: string, date: Date, exceptId?: string) {
  const agg = await ctx.tx.appointment.aggregate({
    where: { technicianId, date, status: { in: ["BOOKED", "ARRIVED"] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    _sum: { plannedCentiHours: true },
  });
  return agg._sum.plannedCentiHours ?? 0;
}

export async function bookAppointment(ctx: ServiceContext, input: AppointmentInput) {
  const data = parseInput(appointmentInputSchema, input);
  ctx.require("workshop.appointment", "create", data.siteId);
  if (data.date.getTime() < ctx.businessDate.getTime()) throw new ValidationError("The date has passed", { date: ["Today or later"] });
  const vehicle = await ctx.tx.vehicle.findUnique({ where: { id: data.vehicleId } });
  if (!vehicle) throw new ValidationError("Unknown vehicle", { vehicleId: ["Choose a vehicle"] });
  const customer = await ctx.tx.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) throw new ValidationError("Unknown customer", { customerId: ["Choose a customer"] });
  if (data.technicianId) {
    const tech = await ctx.tx.technician.findUnique({ where: { userId: data.technicianId } });
    if (!tech || !tech.active || tech.siteId !== data.siteId) throw new ValidationError("Not a technician of this workshop", { technicianId: ["Choose a technician"] });
    const booked = await bookedCentiHours(ctx, data.technicianId, data.date);
    if (!fitsCapacity({ capacityCentiHours: tech.dailyCapacityCentiHours, bookedCentiHours: booked, addCentiHours: data.plannedCentiHours })) {
      const left = Math.max(0, tech.dailyCapacityCentiHours - booked);
      throw new ValidationError("The technician is fully booked that day", { technicianId: [`${formatHours(left)} free that day`] });
    }
  }
  if (data.bayId) {
    const bay = await ctx.tx.workshopBay.findUnique({ where: { id: data.bayId } });
    if (!bay || bay.siteId !== data.siteId || !bay.active) throw new ValidationError("Unknown bay", { bayId: ["Choose a bay of this workshop"] });
  }
  const number = await nextDocumentNumber(ctx, { docType: "APPOINTMENT", scope: data.siteId, sitePrefix: await siteCode(ctx.tx, data.siteId) });
  const appt = await ctx.tx.appointment.create({
    data: {
      number,
      siteId: data.siteId,
      customerId: customer.id,
      vehicleId: vehicle.id,
      technicianId: data.technicianId ?? null,
      bayId: data.bayId ?? null,
      date: data.date,
      startMinute: data.startMinute,
      plannedCentiHours: data.plannedCentiHours,
      concern: data.concern,
      createdById: ctx.actor.userId,
    },
  });
  await ctx.audit({ action: "appointment.book", entityType: "Appointment", entityId: appt.id, after: appt, siteId: data.siteId });
  await ctx.emit({
    type: "AppointmentBooked",
    aggregateType: "Vehicle",
    aggregateId: vehicle.id,
    siteId: data.siteId,
    payload: { appointmentId: appt.id, number, date: data.date.toISOString().slice(0, 10), technicianId: appt.technicianId },
  });
  return appt;
}

export async function cancelAppointment(ctx: ServiceContext, id: string, noShow = false) {
  const appt = await ctx.tx.appointment.findUnique({ where: { id } });
  if (!appt) throw new NotFoundError("Appointment", id);
  ctx.require("workshop.appointment", "edit", appt.siteId);
  if (appt.status !== "BOOKED") throw new ConflictError(`Appointment ${appt.number} is ${appt.status.toLowerCase()}`);
  const status = noShow ? "NO_SHOW" : "CANCELLED";
  const saved = await ctx.tx.appointment.update({ where: { id }, data: { status } });
  await ctx.audit({ action: `appointment.${status.toLowerCase()}`, entityType: "Appointment", entityId: id, before: { status: appt.status }, after: { status }, siteId: appt.siteId });
  return saved;
}
