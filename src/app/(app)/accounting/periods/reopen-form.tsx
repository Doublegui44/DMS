"use client";

import { useTranslations } from "next-intl";
import { ActionForm, Field, TextInput } from "@/components/shared/form";
import { reopenPeriodAction } from "../actions";

export function ReopenForm({ periodId }: { periodId: string }) {
  const t = useTranslations("accounting");
  const tu = useTranslations("ui");
  return (
    <ActionForm action={reopenPeriodAction.bind(null, periodId)} submitLabel={t("reopen")} successMessage={tu("periodReopened")}>
      {(e) => (
        <Field label={t("reopenReason")} name="reason" error={e.reason}>
          <TextInput name="reason" required />
        </Field>
      )}
    </ActionForm>
  );
}
