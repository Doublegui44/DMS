/** UI languages (D-081). Messages live in `messages/<locale>.json`; `en` is the reference file. */
export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "dms_locale";

/** Number and date conventions per UI language (en → day-month-year, € after the amount in fr). */
export const FORMAT_LOCALES: Record<Locale, string> = { en: "en-GB", fr: "fr-FR" };

/** Each language named in itself, for the switcher. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", fr: "Français" };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);
