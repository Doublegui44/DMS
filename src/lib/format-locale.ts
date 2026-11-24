import { cache } from "react";

/**
 * The locale numbers and dates are formatted in (D-081). Server components read it per request
 * (React `cache`), set by `getRequestContext` and the next-intl request config. In the browser,
 * and while client components render on the server, it is the value `<FormatLocale>` set last.
 * Route handlers (PDF, CSV) pass their locale explicitly.
 */
const DEFAULT = "en-GB";
const requestStore = cache((): { locale: string | null } => ({ locale: null }));
let fallback = DEFAULT;

export function setFormatLocale(locale: string) {
  fallback = locale;
  requestStore().locale = locale;
}

export function formatLocale(): string {
  return requestStore().locale ?? fallback;
}

/** A plain number in the current locale, e.g. 12345.5 → "12,345.5" / "12 345,5". */
export function formatNumber(n: number, opts?: Intl.NumberFormatOptions & { locale?: string }): string {
  const { locale, ...o } = opts ?? {};
  return n.toLocaleString(locale ?? formatLocale(), o);
}

/** A mileage, e.g. "45,000 km" / "45 000 km". */
export const formatKm = (km: number, locale?: string) => `${formatNumber(km, { locale })} km`;
