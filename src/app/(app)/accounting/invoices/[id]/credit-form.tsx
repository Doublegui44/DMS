"use client";

import { useTranslations } from "next-intl";
import { ActionForm, Field, TextInput } from "@/components/shared/form";
import { creditInvoiceAction } from "../../actions";

export function CreditForm({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("accounting");
  return (
    <ActionForm
      action={creditInvoiceAction.bind(null, invoiceId)}
      submitLabel={t("createCreditNote")}
      successMessage="Credit note issued"
      className="flex flex-wrap items-end gap-3 space-y-0 [&>div:last-child]:pt-0"
    >
      {(e) => (
        <Field label={t("creditReason")} name="reason" error={e.reason} className="min-w-64 flex-1">
          <TextInput name="reason" />
        </Field>
      )}
    </ActionForm>
  );
}
