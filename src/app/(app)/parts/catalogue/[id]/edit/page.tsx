import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { getPart, getPartFormData } from "@/modules/parts";
import { PageHeader, Section } from "@/components/shared/page-header";
import { SpecForm } from "@/components/shared/spec-form";
import { updatePartAction } from "../../../actions";
import { partFields } from "../../part-fields";

export const metadata = { title: "Edit part" };

export default async function EditPartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("parts");
  const [{ part }, form] = await Promise.all([query((ctx) => getPart(ctx, id), { resource: "parts.part", action: "edit" }), query((ctx) => getPartFormData(ctx))]);
  return (
    <div className="max-w-3xl">
      <PageHeader title={`${t("editPart")} ${part.partNumber}`} subtitle={t("partNumberFixed")} backHref={`/parts/catalogue/${id}`} />
      <Section>
        <SpecForm action={updatePartAction.bind(null, id)} submitLabel={t("save")} cancelHref={`/parts/catalogue/${id}`} fields={partFields(t, form, part)} />
      </Section>
    </div>
  );
}
