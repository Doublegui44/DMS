"use client";

import { useTranslations } from "next-intl";
import { ActionForm, Field, NativeSelect, TextInput } from "@/components/shared/form";
import { runSimulationAction } from "./actions";

const SHARES = new Set(["privateVoShare", "insuranceJobRate", "supplierVarianceRate", "vnShare", "lostEarlyRate", "conversionRate", "tradeInRate", "financingRate", "cancellationRate", "bookedShare", "additionalWorkRate", "latePaymentRate"]);

export function RunForm({ sites, defaults }: { sites: { slug: string; name: string }[]; defaults: Record<string, number> }) {
  const t = useTranslations("simulation");
  return (
    <ActionForm action={runSimulationAction} submitLabel={t("submit")} successMessage={t("started")}>
      {(e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("days")} name="days" error={e.days}>
              <NativeSelect name="days" defaultValue="7" options={["1", "7", "14", "30"].map((d) => ({ value: d, label: d }))} />
            </Field>
            <Field label={t("site")} name="site" error={e.site}>
              <NativeSelect name="site" placeholder={t("allSites")} options={sites.map((s) => ({ value: s.slug, label: s.name }))} />
            </Field>
          </div>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">{t("ratesHint")}</p>
            <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(defaults).map(([key, value]) => (
                <Field key={key} label={t(`rate.${key}`)} name={key} error={e[`rates.${key}`] ?? e[key]}>
                  <TextInput name={key} type="number" inputMode="decimal" step={SHARES.has(key) ? "0.01" : key === "seed" || key === "vnStockTarget" ? "1" : "0.1"} min={0} max={SHARES.has(key) ? 1 : undefined} defaultValue={value} />
                </Field>
              ))}
            </div>
          </div>
        </>
      )}
    </ActionForm>
  );
}
