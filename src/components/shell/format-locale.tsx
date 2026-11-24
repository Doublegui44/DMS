"use client";

import { setFormatLocale } from "@/lib/format-locale";

/** Sets the number/date locale for client components before they render (D-081). */
export function FormatLocale({ locale }: { locale: string }) {
  setFormatLocale(locale);
  return null;
}
