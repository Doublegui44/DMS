/** Workshop time: clock times as minutes after midnight, durations in centi-hours (pure). */

export const MINUTES_PER_DAY = 1_440;

/** "08:30" → 510. Throws on anything that is not a valid time of day. */
export function parseHhmm(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new RangeError(`Not a time: ${value}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new RangeError(`Not a time: ${value}`);
  return h * 60 + min;
}

/** 510 → "08:30". */
export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  return `${String(h).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** Minutes → centi-hours, rounded to the nearest (45 min → 75). */
export function minutesToCentiHours(minutes: number): number {
  if (minutes < 0) throw new RangeError("Negative duration");
  return Math.round((minutes * 100) / 60);
}

/** Clocked time between two minutes of the same day. */
export function clockedCentiHours(startMinute: number, endMinute: number): number {
  if (endMinute < startMinute) throw new RangeError("Clock-off before clock-on");
  return minutesToCentiHours(endMinute - startMinute);
}

/** 150 → "1.50 h". */
export function formatHours(centiHours: number): string {
  return `${(centiHours / 100).toFixed(2)} h`;
}

/** "1.5" or "1,5" hours → 150 centi-hours (two decimals at most). */
export function hoursToCentiHours(value: string | number): number {
  const n = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(n)) throw new RangeError(`Not a number of hours: ${value}`);
  return Math.round(n * 100);
}
