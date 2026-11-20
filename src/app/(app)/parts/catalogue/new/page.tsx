import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { getPartFormData } from "@/modules/parts";
import { PageHeader, Section } from "@/components/shared/page-header";
import { SpecForm } from "@/components/shared/spec-form";
import { createPartAction } from "../../actions";
import { partFields } from "../part-fields";

export const metadata = { title: "New part" };

export default async function NewPartPage() {
  const t = await getTranslations("parts");
  const form = await query((ctx) => getPartFormData(ctx), { resource: "parts.part", action: "create" });
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("newPart")} backHref="/parts/catalogue" />
      <Section>
        <SpecForm action={createPartAction} submitLabel={t("createPart")} cancelHref="/parts/catalogue" fields={partFields(t, form)} />
      </Section>
    </div>
  );
}
