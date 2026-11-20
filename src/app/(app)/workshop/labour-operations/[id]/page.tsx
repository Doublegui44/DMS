import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { parseListParams } from "@/lib/list";
import { getLabourOperation, listLabourOperations } from "@/modules/workshop";
import { PageHeader, Section } from "@/components/shared/page-header";
import { SpecForm } from "@/components/shared/spec-form";
import { updateLabourOperationAction } from "../../actions";
import { operationFields } from "../fields";

export const metadata = { title: "Labour operation" };

export default async function OperationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("workshop");
  const [op, d] = await Promise.all([
    query((ctx) => getLabourOperation(ctx, id), { resource: "workshop.labour_catalogue", action: "edit" }),
    query((ctx) => listLabourOperations(ctx, parseListParams({}, { pageSize: 5 }))),
  ]);
  if (!op) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader title={`${op.code} — ${op.label}`} backHref="/workshop/labour-operations" />
      <Section>
        <SpecForm action={updateLabourOperationAction.bind(null, id)} submitLabel={t("save")} cancelHref="/workshop/labour-operations" fields={operationFields(t, d.brands, op)} />
      </Section>
    </div>
  );
}
