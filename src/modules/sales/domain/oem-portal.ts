import { addDays, daysBetween } from "@/lib/dates";

/**
 * The manufacturer's view of a factory order (OEM portal mock, D-084). The dealer only knows
 * ordered / in transit / arrived; the portal shows where the car is in the plant, derived from
 * the order date and the promised date, so it needs no data of its own.
 */
export const OEM_STAGES = ["RECEIVED", "SCHEDULED", "IN_PRODUCTION", "BUILT", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
export type OemStage = (typeof OEM_STAGES)[number];

/** Days a built car waits for its truck, then travels: the end of the lead time. */
export const TRANSIT_DAYS = 4;

export interface OemOrderState {
  stage: OemStage;
  /** Day the car enters the assembly line. */
  buildOn: Date;
  progressPct: number;
  /** The promised date has passed and the car has not reached the dealer. */
  late: boolean;
  /** The plant has finished the car: the OEM can ship it. */
  readyToShip: boolean;
}

export function oemOrderState(
  fo: { status: "ORDERED" | "IN_TRANSIT" | "ARRIVED" | "CANCELLED"; orderedOn: Date; expectedOn: Date },
  today: Date,
): OemOrderState {
  const lead = Math.max(1, daysBetween(fo.orderedOn, fo.expectedOn));
  const buildOn = addDays(fo.orderedOn, Math.round(lead * 0.5));
  const late = (fo.status === "ORDERED" || fo.status === "IN_TRANSIT") && daysBetween(fo.expectedOn, today) > 0;
  if (fo.status === "CANCELLED") return { stage: "CANCELLED", buildOn, progressPct: 0, late: false, readyToShip: false };
  if (fo.status === "ARRIVED") return { stage: "DELIVERED", buildOn, progressPct: 100, late: false, readyToShip: false };
  if (fo.status === "IN_TRANSIT") return { stage: "SHIPPED", buildOn, progressPct: 100, late, readyToShip: false };
  const elapsed = daysBetween(fo.orderedOn, today);
  const share = elapsed / lead;
  const builtBy = Math.max(1, lead - TRANSIT_DAYS);
  const stage: OemStage = elapsed >= builtBy ? "BUILT" : share >= 0.5 ? "IN_PRODUCTION" : share >= 0.15 ? "SCHEDULED" : "RECEIVED";
  return { stage, buildOn, progressPct: Math.max(0, Math.min(100, Math.round((100 * elapsed) / builtBy))), late, readyToShip: stage === "BUILT" };
}
