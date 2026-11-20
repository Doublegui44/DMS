/** Technician productivity and efficiency, workshop capacity (pure). */
import { ratioBp } from "@/lib/money";
import { addDays } from "@/lib/dates";

/** Working days Monday–Friday between two dates, both included. */
export function workingDays(from: Date, to: Date): number {
  let n = 0;
  for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/**
 * - productivity = clocked on jobs ÷ hours available (how much of their time technicians spend on cars);
 * - efficiency = billed (standard) hours ÷ clocked hours (how fast against the standard times).
 */
export function technicianKpis(a: { availableCentiHours: number; clockedCentiHours: number; billedCentiHours: number }) {
  return {
    productivityBp: a.availableCentiHours > 0 ? ratioBp(a.clockedCentiHours, a.availableCentiHours) : 0,
    efficiencyBp: a.clockedCentiHours > 0 ? ratioBp(a.billedCentiHours, a.clockedCentiHours) : 0,
    utilisedBp: a.availableCentiHours > 0 ? ratioBp(a.billedCentiHours, a.availableCentiHours) : 0,
  };
}

/** Does a booking fit in a technician's day? */
export function fitsCapacity(a: { capacityCentiHours: number; bookedCentiHours: number; addCentiHours: number }): boolean {
  return a.bookedCentiHours + a.addCentiHours <= a.capacityCentiHours;
}

/** The Monday of the week of a date, and the six working days (Mon–Sat) of that week. */
export function weekOf(date: Date): Date[] {
  const wd = date.getUTCDay();
  const monday = addDays(date, wd === 0 ? -6 : 1 - wd);
  return Array.from({ length: 6 }, (_, i) => addDays(monday, i));
}
