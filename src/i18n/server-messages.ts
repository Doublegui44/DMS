import type { ActionResult } from "@/lib/errors";
import fr from "../../messages/server/fr.json";
import type { Locale } from "./locales";

/**
 * Business-rule and validation messages are written in English in the services (CLI, logs and
 * tests read them). Server actions translate them on the way out (D-082): each catalogue maps an
 * English template, with `{}` for every interpolated value, to its translation. A message with
 * no template is shown as it is. `tests/unit/i18n.test.ts` fails when a service message has no
 * French template.
 */
const CATALOGUES: Partial<Record<Locale, Record<string, string>>> = { fr };

type Compiled = { re: RegExp; to: string[] };
const compiled = new Map<Locale, Compiled[]>();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compile(locale: Locale): Compiled[] {
  let list = compiled.get(locale);
  if (!list) {
    // Longest templates first, so "Only {} is due on {}" wins over "Only {} is due".
    list = Object.entries(CATALOGUES[locale] ?? {})
      .sort((a, b) => b[0].length - a[0].length)
      .map(([en, tr]) => ({ re: new RegExp(`^${en.split("{}").map(escape).join("(.+?)")}$`, "s"), to: tr.split("{}") }));
    compiled.set(locale, list);
  }
  return list;
}

/** One message in the UI language (unchanged in English or when no template matches). */
export function translateServerMessage(message: string, locale: Locale): string {
  if (locale === "en") return message;
  for (const { re, to } of compile(locale)) {
    const m = re.exec(message);
    if (m) return to.reduce((acc, part, i) => acc + (i > 0 ? m[i] : "") + part, "");
  }
  // Several messages joined ("… · …", e.g. the failed checks of a period close): one by one.
  if (message.includes(" · ")) return message.split(" · ").map((part) => translateServerMessage(part, locale)).join(" · ");
  return message;
}

/** An action error with its message and field errors in the UI language. */
export function translateActionResult<T>(result: ActionResult<T>, locale: Locale): ActionResult<T> {
  if (result.ok || locale === "en") return result;
  const { message, fieldErrors, ...rest } = result.error;
  return {
    ok: false,
    error: {
      ...rest,
      message: translateServerMessage(message, locale),
      ...(fieldErrors && {
        fieldErrors: Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v?.map((m) => translateServerMessage(m, locale))])),
      }),
    },
  };
}
