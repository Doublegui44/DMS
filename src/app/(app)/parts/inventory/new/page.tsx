import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { getCycleCountFormData } from "@/modules/parts";
import { PageHeader, Section } from "@/components/shared/page-header";
import { SpecForm } from "@/components/shared/spec-form";
import { createCycleCountAction } from "../../actions";

export const metadata = { title: "New cycle count" };

export default async function NewCycleCountPage() {
  const t = await getTranslations("parts");
  const { siteId } = await getRequestContext();
  const form = await query((ctx) => getCycleCountFormData(ctx), { resource: "parts.inventory", action: "create" });
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("newCount")} subtitle={t("newCountHint")} backHref="/parts/inventory" />
      <Section>
        <SpecForm
          action={createCycleCountAction}
          submitLabel={t("createCount")}
          cancelHref="/parts/inventory"
          columns={2}
          fields={[
            { name: "siteId", label: t("site"), type: "select", options: form.sites, defaultValue: form.sites.find((s) => s.value === siteId)?.value ?? form.sites[0]?.value },
            { name: "label", label: t("label"), placeholder: t("countLabelPlaceholder"), testId: "count-label" },
            { name: "family", label: t("family"), type: "select", empty: t("allFamilies"), options: form.families.map((f) => ({ value: f, label: f })) },
            { name: "binPrefix", label: t("binPrefix"), placeholder: "A1", hint: t("binPrefixHint"), testId: "count-bin" },
            { name: "limit", label: t("maxItems"), type: "number", defaultValue: "25", hint: t("maxItemsHint") },
          ]}
        />
      </Section>
    </div>
  );
}
