/** Small display helpers for the workshop screens. */
export function hours(centiHours: number | null | undefined): string {
  if (centiHours === null || centiHours === undefined) return "—";
  return `${(centiHours / 100).toFixed(2)} h`;
}

export function clock(minute: number | null | undefined): string {
  if (minute === null || minute === undefined) return "—";
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** The time on the wall clock, as the default of clocking forms (services never read it). */
export function nowHhmm(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function vehicleName(v: { make: string; model: string; registration?: string | null; vin?: string }): string {
  return `${v.make} ${v.model}${v.registration ? ` · ${v.registration}` : v.vin ? ` · ${v.vin}` : ""}`;
}

export const RO_STATUSES = ["CHECKED_IN", "IN_PROGRESS", "QUALITY_CHECK", "READY", "INVOICED", "CLOSED", "CANCELLED"] as const;
