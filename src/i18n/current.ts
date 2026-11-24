import { cache } from "react";
import { cookies } from "next/headers";
import { setFormatLocale } from "@/lib/format-locale";
import { DEFAULT_LOCALE, FORMAT_LOCALES, isLocale, LOCALE_COOKIE, type Locale } from "./locales";

/** The UI language of this request (cookie set by the switcher; English by default). */
export const getUiLocale = cache(async (): Promise<Locale> => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(value) ? value : DEFAULT_LOCALE;
  setFormatLocale(FORMAT_LOCALES[locale]);
  return locale;
});
