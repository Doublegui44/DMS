"use client";

import { useTranslations } from "next-intl";
import { ActionForm, Field, NativeSelect, TextInput } from "@/components/shared/form";
import { changeVehicleStatusAction } from "../actions";

export function StatusChangeForm({ vehicleId, options }: { vehicleId: string; options: { value: string; label: string }[] }) {
  const t = useTranslations("vehicle");
  return (
    <ActionForm
      action={changeVehicleStatusAction.bind(null, vehicleId)}
      submitLabel={t("changeStatus")}
      successMessage="Status updated"
      className="flex flex-wrap items-end gap-3 space-y-0 [&>div:last-child]:pt-0"
    >
      {(e) => (
        <>
          <Field label={t("status")} name="status" error={e.status} className="w-48">
            <NativeSelect name="status" options={options} />
          </Field>
          <Field label={t("reason")} name="reason" className="min-w-48 flex-1">
            <TextInput name="reason" placeholder="e.g. Delivered by transporter" />
          </Field>
        </>
      )}
    </ActionForm>
  );
}
