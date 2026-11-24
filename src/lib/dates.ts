import { formatLocale } from "./format-locale";

/** Date-only helpers. Business dates are stored as UTC midnight (`@db.Date`). */

export function toDateOnly(d: Date | string): Date {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Today's calendar date in local time, as a UTC-midnight date. */
export function localToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function addDays(d: Date, days: number): Date {
  const r = toDateOnly(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((toDateOnly(to).getTime() - toDateOnly(from).getTime()) / 86_400_000);
}

export function isoDate(d: Date | null | undefined): string {
  if (!d) return "";
  return toDateOnly(d).toISOString().slice(0, 10);
}

export function formatDate(d: Date | string | null | undefined, locale = formatLocale()): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function formatDateTime(d: Date | string | null | undefined, locale = formatLocale()): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(date);
}
