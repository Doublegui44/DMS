"use client";

import { useTranslations } from "next-intl";
import { ActionForm, Field, TextInput } from "@/components/shared/form";
import { reverseEntryAction } from "../../actions";

export function ReverseForm({ entryId }: { entryId: string }) {
  const t = useTranslations("accounting");
  const tu = useTranslations("ui");
  return (
    <ActionForm
      action={reverseEntryAction.bind(null, entryId)}
      submitLabel={t("reverse")}
      successMessage={tu("reversalPosted")}
      className="flex flex-wrap items-end gap-3 space-y-0 [&>div:last-child]:pt-0"
    >
      {(e) => (
        <Field label={t("reverseReason")} name="reason" error={e.reason} className="min-w-64 flex-1">
          <TextInput name="reason" required />
        </Field>
      )}
    </ActionForm>
  );
}
