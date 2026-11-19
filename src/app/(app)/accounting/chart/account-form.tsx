"use client";

import { useTranslations } from "next-intl";
import { ActionForm, Field, NativeSelect, TextInput } from "@/components/shared/form";
import { saveAccountAction } from "../actions";

export interface AccountFormValues {
  code: string;
  label: string;
  type: string;
  postable: boolean;
  requiresAnalytic: boolean;
  isReceivable: boolean;
  isPayable: boolean;
  active: boolean;
}

export function AccountForm({ initial }: { initial?: AccountFormValues }) {
  const t = useTranslations("accounting");
  const check = (name: keyof AccountFormValues, label: string, def: boolean) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={(initial?.[name] as boolean | undefined) ?? def} /> {label}
    </label>
  );
  return (
    <ActionForm
      action={saveAccountAction.bind(null, initial?.code ?? null)}
      submitLabel={initial ? "Save" : "Create"}
      successMessage="Account saved"
      cancelHref={initial ? `/accounting/chart/${initial.code}` : "/accounting/chart"}
    >
      {(e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("code")} name="code" error={e.code}>
              <TextInput name="code" defaultValue={initial?.code} disabled={!!initial} placeholder="706150" />
            </Field>
            <Field label={t("label")} name="label" error={e.label} className="sm:col-span-2">
              <TextInput name="label" defaultValue={initial?.label} />
            </Field>
            <Field label={t("type")} name="type" error={e.type}>
              <NativeSelect
                name="type"
                defaultValue={initial?.type ?? "INCOME"}
                options={["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"].map((x) => ({ value: x, label: t(`types.${x}`) }))}
              />
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {check("postable", t("postable"), true)}
            {check("active", t("active"), true)}
            {check("requiresAnalytic", t("requiresAnalytic"), false)}
            {check("isReceivable", t("isReceivable"), false)}
            {check("isPayable", t("isPayable"), false)}
          </div>
        </>
      )}
    </ActionForm>
  );
}
