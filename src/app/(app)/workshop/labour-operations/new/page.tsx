import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { parseListParams } from "@/lib/list";
import { listLabourOperations } from "@/modules/workshop";
import { PageHeader, Section } from "@/components/shared/page-header";
import { SpecForm } from "@/components/shared/spec-form";
import { createLabourOperationAction } from "../../actions";
import { operationFields } from "../fields";

export const metadata = { title: "New labour operation" };

export default async function NewOperationPage() {
  const t = await getTranslations("workshop");
  const d = await query((ctx) => listLabourOperations(ctx, parseListParams({}, { pageSize: 5 })), { resource: "workshop.labour_catalogue", action: "create" });
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("newOperation")} backHref="/workshop/labour-operations" />
      <Section>
        <SpecForm action={createLabourOperationAction} submitLabel={t("save")} cancelHref="/workshop/labour-operations" fields={operationFields(t, d.brands)} />
      </Section>
    </div>
  );
}
