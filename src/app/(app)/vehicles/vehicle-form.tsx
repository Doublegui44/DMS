"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ActionForm, Field, NativeSelect, TextInput, type FormState } from "@/components/shared/form";

const FUELS = ["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "ELECTRIC", "LPG"] as const;

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
  vatRegime?: string;
}

/**
 * Creates a customer's car, or edits any car. Stock cars enter through sales (factory order, purchase,
 * trade-in), and their site, brand, owner, price and VAT regime are shown read-only here (D-048).
 */
export function VehicleForm({
  action,
  initial,
  sites,
  brands,
  customers,
  isEdit,
  submitLabel,
  cancelHref,
  stockLinks,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  initial: VehicleFormValues;
  sites: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  customers: { id: string; label: string }[];
  isEdit: boolean;
  submitLabel: string;
  cancelHref: string;
  /** New car only: the sales screens this user may open to bring a car into stock. */
  stockLinks?: { vn: boolean; vo: boolean };
}) {
  const t = useTranslations("vehicle");
  const ts = useTranslations("sales");
  const tu = useTranslations("ui");
  const stockType = isEdit ? (initial.stockType ?? "NONE") : "NONE";
  const status = isEdit ? (initial.status ?? "CUSTOMER") : "CUSTOMER";
  const stockCar = stockType !== "NONE";

  return (
    <ActionForm action={action} submitLabel={submitLabel} cancelHref={cancelHref} successMessage={tu("saved")}>
      {(e) => (
        <div className="grid gap-6 lg:grid-cols-2">
          <fieldset className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
            <legend className="px-1 text-sm font-semibold">{tu("identification")}</legend>
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
                <NativeSelect
                  name="brandId"
                  defaultValue={initial.brandId}
                  placeholder={tu("otherMake")}
                  disabled={stockCar}
                  options={brands.map((b) => ({ value: b.id, label: b.name }))}
                />
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

          <fieldset className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
            <legend className="px-1 text-sm font-semibold">{isEdit ? t("stockType") : t("owner")}</legend>
            <input type="hidden" name="stockType" value={stockType} />
            <input type="hidden" name="status" value={status} />
            <div className="grid grid-cols-2 gap-3">
              {isEdit && (
                <>
                  <Field label={t("stockType")} name="stockTypeLabel" error={e.stockType}>
                    <TextInput name="stockTypeLabel" disabled defaultValue={t(`stockTypes.${stockType}`)} />
                  </Field>
                  <Field label={t("status")} name="statusLabel" error={e.status}>
                    <TextInput name="statusLabel" disabled defaultValue={t(`statuses.${status}`)} />
                  </Field>
                </>
              )}
              <Field label={t("owner")} name="ownerCustomerId" error={e.ownerCustomerId}>
                <NativeSelect
                  name="ownerCustomerId"
                  defaultValue={initial.ownerCustomerId}
                  placeholder="—"
                  disabled={stockCar}
                  options={customers.map((c) => ({ value: c.id, label: c.label }))}
                />
              </Field>
              <Field label={t("site")} name="siteId" error={e.siteId}>
                <NativeSelect name="siteId" defaultValue={initial.siteId} placeholder="—" disabled={stockCar} options={sites.map((s) => ({ value: s.id, label: s.name }))} />
              </Field>
            </div>
            {stockCar && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("listPrice")} name="listPriceCents">
                    <TextInput name="listPriceCents" disabled defaultValue={initial.listPriceEuros ?? ""} />
                  </Field>
                  <Field label={t("stockValue")} name="stockValueCents">
                    <TextInput name="stockValueCents" disabled defaultValue={initial.stockValueEuros ?? ""} />
                  </Field>
                  <Field label={t("vatRegime")} name="vatRegime">
                    <TextInput name="vatRegime" disabled defaultValue={t(`vatRegimes.${initial.vatRegime ?? "STANDARD"}`)} />
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">{t("stockCarLocked")}</p>
              </>
            )}
            {!isEdit && (
              <p className="text-xs text-muted-foreground" data-testid="stock-entry-hint">
                {t("stockEntersThroughSales")}
                {stockLinks?.vn && (
                  <>
                    {" "}
                    <Link href="/sales/vn-stock/order" className="text-primary hover:underline">
                      {ts("orderForStock")}
                    </Link>
                  </>
                )}
                {stockLinks?.vn && stockLinks.vo && " · "}
                {stockLinks?.vo && (
                  <>
                    {!stockLinks.vn && " "}
                    <Link href="/sales/vo-stock/purchase" className="text-primary hover:underline">
                      {ts("buyUsedCar")}
                    </Link>
                  </>
                )}
              </p>
            )}
          </fieldset>
        </div>
      )}
    </ActionForm>
  );
}
