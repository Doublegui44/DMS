"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActionForm, Field, NativeSelect, TextInput, inputClass, type FormState } from "@/components/shared/form";

export interface CustomerFormValues {
  kind: "INDIVIDUAL" | "COMPANY" | "OEM";
  title?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  siren?: string | null;
  vatNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  countryCode?: string;
  priceClass?: string;
  paymentTermsDays?: number;
  consentEmail?: boolean;
  consentSms?: boolean;
  consentPhone?: boolean;
  homeSiteId?: string | null;
  notes?: string | null;
}

export function CustomerForm({
  action,
  initial,
  sites,
  submitLabel,
  cancelHref,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  initial?: CustomerFormValues;
  sites: { id: string; name: string }[];
  submitLabel: string;
  cancelHref: string;
}) {
  const t = useTranslations("customer");
  const [kind, setKind] = useState(initial?.kind ?? "INDIVIDUAL");
  const isIndividual = kind === "INDIVIDUAL";

  return (
    <ActionForm action={action} submitLabel={submitLabel} cancelHref={cancelHref} successMessage="Saved">
      {(e) => (
        <div className="grid gap-6 lg:grid-cols-2">
          <fieldset className="space-y-3 rounded-lg border bg-card p-4">
            <legend className="px-1 text-sm font-semibold">{t("details")}</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("kind")} name="kind" error={e.kind}>
                <NativeSelect
                  name="kind"
                  defaultValue={kind}
                  onChange={(ev) => setKind(ev.target.value as typeof kind)}
                  options={(["INDIVIDUAL", "COMPANY", "OEM"] as const).map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
                />
              </Field>
              <Field label={t("priceClass")} name="priceClass" error={e.priceClass}>
                <NativeSelect
                  name="priceClass"
                  defaultValue={initial?.priceClass ?? "RETAIL"}
                  options={(["RETAIL", "TRADE", "INTERNAL", "WARRANTY"] as const).map((k) => ({
                    value: k,
                    label: t(`priceClasses.${k}`),
                  }))}
                />
              </Field>
            </div>
            {isIndividual ? (
              <div className="grid grid-cols-[80px_1fr_1fr] gap-3">
                <Field label={t("title_")} name="title" error={e.title}>
                  <NativeSelect name="title" defaultValue={initial?.title} placeholder="" options={["M.", "Mme"].map((v) => ({ value: v, label: v }))} />
                </Field>
                <Field label={t("firstName")} name="firstName" error={e.firstName}>
                  <TextInput name="firstName" defaultValue={initial?.firstName ?? ""} invalid={!!e.firstName} />
                </Field>
                <Field label={t("lastName")} name="lastName" error={e.lastName}>
                  <TextInput name="lastName" defaultValue={initial?.lastName ?? ""} invalid={!!e.lastName} />
                </Field>
              </div>
            ) : (
              <>
                <Field label={t("companyName")} name="companyName" error={e.companyName}>
                  <TextInput name="companyName" defaultValue={initial?.companyName ?? ""} invalid={!!e.companyName} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("siren")} name="siren" error={e.siren}>
                    <TextInput name="siren" defaultValue={initial?.siren ?? ""} inputMode="numeric" invalid={!!e.siren} />
                  </Field>
                  <Field label={t("vatNumber")} name="vatNumber" error={e.vatNumber}>
                    <TextInput name="vatNumber" defaultValue={initial?.vatNumber ?? ""} invalid={!!e.vatNumber} />
                  </Field>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("homeSite")} name="homeSiteId" error={e.homeSiteId}>
                <NativeSelect name="homeSiteId" defaultValue={initial?.homeSiteId} placeholder="—" options={sites.map((s) => ({ value: s.id, label: s.name }))} />
              </Field>
              <Field label={t("paymentTerms")} name="paymentTermsDays" error={e.paymentTermsDays}>
                <TextInput
                  name="paymentTermsDays"
                  type="number"
                  min={0}
                  max={120}
                  defaultValue={initial?.paymentTermsDays ?? (isIndividual ? 0 : 30)}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border bg-card p-4">
            <legend className="px-1 text-sm font-semibold">Contact</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("email")} name="email" error={e.email}>
                <TextInput name="email" type="email" defaultValue={initial?.email ?? ""} invalid={!!e.email} />
              </Field>
              <Field label={t("phone")} name="phone" error={e.phone}>
                <TextInput name="phone" defaultValue={initial?.phone ?? ""} />
              </Field>
            </div>
            <Field label={t("address")} name="address" error={e.address}>
              <TextInput name="address" defaultValue={initial?.address ?? ""} />
            </Field>
            <div className="grid grid-cols-[120px_1fr_80px] gap-3">
              <Field label={t("postalCode")} name="postalCode" error={e.postalCode}>
                <TextInput name="postalCode" defaultValue={initial?.postalCode ?? ""} />
              </Field>
              <Field label={t("city")} name="city" error={e.city}>
                <TextInput name="city" defaultValue={initial?.city ?? ""} />
              </Field>
              <Field label={t("country")} name="countryCode" error={e.countryCode}>
                <TextInput name="countryCode" defaultValue={initial?.countryCode ?? "FR"} maxLength={2} />
              </Field>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">{t("consents")}</div>
              <div className="flex flex-wrap gap-4 text-[13px]">
                {(["consentEmail", "consentSms", "consentPhone"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <input type="checkbox" name={k} defaultChecked={initial?.[k] ?? false} className="size-3.5" />
                    {t(k)}
                  </label>
                ))}
              </div>
            </div>
            <Field label={t("notes")} name="notes">
              <textarea name="notes" id="notes" defaultValue={initial?.notes ?? ""} rows={2} className={`${inputClass} h-auto py-1.5`} />
            </Field>
          </fieldset>
        </div>
      )}
    </ActionForm>
  );
}
