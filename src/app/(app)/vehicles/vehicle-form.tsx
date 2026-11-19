"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActionForm, Field, NativeSelect, TextInput, type FormState } from "@/components/shared/form";

const FUELS = ["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "ELECTRIC", "LPG"] as const;
const INITIAL: Record<string, string[]> = {
  VN: ["ORDERED", "IN_TRANSIT", "IN_STOCK"],
  VO: ["INTAKE", "RECONDITIONING", "FOR_SALE"],
  NONE: ["CUSTOMER"],
};

export interface VehicleFormValues {
  vin?: string;
  registration?: string | null;
  brandId?: string | null;
  make?: string;
  model?: string;
  version?: string;
  firstRegistration?: string | null; // yyyy-mm-dd
  mileage?: number;
  fuel?: string;
  co2?: number | null;
  powerHp?: number | null;
  colour?: string | null;
  stockType?: "VN" | "VO" | "NONE";
  status?: string;
  siteId?: string | null;
  ownerCustomerId?: string | null;
  listPriceEuros?: string;
  stockValueEuros?: string;
  stockInDate?: string | null;
  vatRegime?: string;
}

export function VehicleForm({
  action,
  initial,
  sites,
  brands,
  customers,
  isEdit,
  submitLabel,
  cancelHref,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  initial: VehicleFormValues;
  sites: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  customers: { id: string; label: string }[];
  isEdit: boolean;
  submitLabel: string;
  cancelHref: string;
}) {
  const t = useTranslations("vehicle");
  const [stockType, setStockType] = useState(initial.stockType ?? "VN");
  const inStock = stockType !== "NONE";

  return (
    <ActionForm action={action} submitLabel={submitLabel} cancelHref={cancelHref} successMessage="Saved">
      {(e) => (
        <div className="grid gap-6 lg:grid-cols-2">
          <fieldset className="space-y-3 rounded-lg border bg-card p-4">
            <legend className="px-1 text-sm font-semibold">Identification</legend>
            <div className="grid grid-cols-[1fr_160px] gap-3">
              <Field label={t("vin")} name="vin" error={e.vin}>
                <TextInput name="vin" defaultValue={initial.vin} maxLength={17} className="font-mono" invalid={!!e.vin} />
              </Field>
              <Field label={t("registration")} name="registration" error={e.registration}>
                <TextInput name="registration" defaultValue={initial.registration ?? ""} placeholder="AB-123-CD" invalid={!!e.registration} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("brand")} name="brandId" error={e.brandId}>
                <NativeSelect name="brandId" defaultValue={initial.brandId} placeholder="— (other make)" options={brands.map((b) => ({ value: b.id, label: b.name }))} />
              </Field>
              <Field label={t("make")} name="make" error={e.make}>
                <TextInput name="make" defaultValue={initial.make} invalid={!!e.make} />
              </Field>
              <Field label={t("model")} name="model" error={e.model}>
                <TextInput name="model" defaultValue={initial.model} invalid={!!e.model} />
              </Field>
              <Field label={t("version")} name="version" error={e.version}>
                <TextInput name="version" defaultValue={initial.version} invalid={!!e.version} />
              </Field>
              <Field label={t("fuel")} name="fuel" error={e.fuel}>
                <NativeSelect name="fuel" defaultValue={initial.fuel ?? "PETROL"} options={FUELS.map((f) => ({ value: f, label: t(`fuels.${f}`) }))} />
              </Field>
              <Field label={t("colour")} name="colour">
                <TextInput name="colour" defaultValue={initial.colour ?? ""} />
              </Field>
              <Field label={t("firstRegistration")} name="firstRegistration" error={e.firstRegistration}>
                <TextInput name="firstRegistration" type="date" defaultValue={initial.firstRegistration ?? ""} />
              </Field>
              <Field label={t("mileage")} name="mileage" error={e.mileage}>
                <TextInput name="mileage" type="number" min={0} defaultValue={initial.mileage ?? 0} />
              </Field>
              <Field label={t("co2")} name="co2" error={e.co2}>
                <TextInput name="co2" type="number" min={0} defaultValue={initial.co2 ?? ""} />
              </Field>
              <Field label={t("power")} name="powerHp" error={e.powerHp}>
                <TextInput name="powerHp" type="number" min={0} defaultValue={initial.powerHp ?? ""} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border bg-card p-4">
            <legend className="px-1 text-sm font-semibold">{t("stockType")}</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("stockType")} name="stockType" error={e.stockType}>
                <NativeSelect
                  name="stockType"
                  defaultValue={stockType}
                  disabled={isEdit}
                  onChange={(ev) => setStockType(ev.target.value as typeof stockType)}
                  options={(["VN", "VO", "NONE"] as const).map((s) => ({ value: s, label: t(`stockTypes.${s}`) }))}
                />
                {isEdit && <input type="hidden" name="stockType" value={stockType} />}
              </Field>
              <Field label={t("status")} name="status" error={e.status}>
                {isEdit ? (
                  <>
                    <TextInput name="statusLabel" disabled defaultValue={t(`statuses.${initial.status}`)} />
                    <input type="hidden" name="status" value={initial.status} />
                  </>
                ) : (
                  <NativeSelect
                    key={stockType}
                    name="status"
                    defaultValue={INITIAL[stockType].includes(initial.status ?? "") ? initial.status : INITIAL[stockType][0]}
                    options={INITIAL[stockType].map((s) => ({ value: s, label: t(`statuses.${s}`) }))}
                  />
                )}
              </Field>
              <Field label={t("site")} name="siteId" error={e.siteId}>
                <NativeSelect name="siteId" defaultValue={initial.siteId} placeholder="—" options={sites.map((s) => ({ value: s.id, label: s.name }))} />
              </Field>
              <Field label={t("owner")} name="ownerCustomerId" error={e.ownerCustomerId}>
                <NativeSelect name="ownerCustomerId" defaultValue={initial.ownerCustomerId} placeholder="—" options={customers.map((c) => ({ value: c.id, label: c.label }))} />
              </Field>
            </div>
            {inStock && (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("listPrice")} name="listPriceCents" error={e.listPriceCents}>
                  <TextInput name="listPriceCents" inputMode="decimal" defaultValue={initial.listPriceEuros ?? ""} placeholder="0,00 €" />
                </Field>
                <Field label={t("stockValue")} name="stockValueCents" error={e.stockValueCents}>
                  <TextInput
                    name="stockValueCents"
                    inputMode="decimal"
                    defaultValue={initial.stockValueEuros ?? ""}
                    placeholder="0,00 €"
                    disabled={isEdit}
                    title={isEdit ? "Stock value changes only through purchases and reconditioning" : undefined}
                  />
                </Field>
                {!isEdit && (
                  <Field label={t("stockInDate")} name="stockInDate" error={e.stockInDate}>
                    <TextInput name="stockInDate" type="date" defaultValue={initial.stockInDate ?? ""} />
                  </Field>
                )}
                <Field label={t("vatRegime")} name="vatRegime" error={e.vatRegime}>
                  <NativeSelect
                    name="vatRegime"
                    defaultValue={initial.vatRegime ?? "STANDARD"}
                    options={(["STANDARD", "MARGIN"] as const).map((v) => ({ value: v, label: t(`vatRegimes.${v}`) }))}
                  />
                </Field>
              </div>
            )}
          </fieldset>
        </div>
      )}
    </ActionForm>
  );
}
