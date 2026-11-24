"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { setLocale } from "@/app/(app)/shell-actions";
import { LOCALE_NAMES, LOCALES } from "@/i18n/locales";

/** Picks the UI language (cookie, D-081). */
export function LanguageSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Languages className="size-3.5" aria-hidden />
      <select
        aria-label={t("language")}
        data-testid="language-switcher"
        className="h-7 rounded-md border bg-background px-1.5 text-[13px] text-foreground"
        value={locale}
        disabled={pending}
        onChange={(e) =>
          startTransition(async () => {
            await setLocale(e.target.value);
            router.refresh();
          })
        }
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
