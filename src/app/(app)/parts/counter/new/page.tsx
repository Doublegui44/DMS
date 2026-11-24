import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { getCounterFormData } from "@/modules/parts";
import { PageHeader, Section } from "@/components/shared/page-header";
import { SpecForm } from "@/components/shared/spec-form";
import { createCounterSaleAction } from "../../actions";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("newCounterSale");

export default async function NewCounterSalePage() {
  const t = await getTranslations("parts");
  const { siteId } = await getRequestContext();
  const form = await query((ctx) => getCounterFormData(ctx), { resource: "parts.counter_sale", action: "create" });
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("newCounterSale")} subtitle={t("newCounterSaleHint")} backHref="/parts/counter" />
      <Section>
        <SpecForm
          action={createCounterSaleAction}
          submitLabel={t("createQuote")}
          cancelHref="/parts/counter"
          fields={[
            { name: "siteId", label: t("site"), type: "select", options: form.sites, defaultValue: form.sites.find((s) => s.value === siteId)?.value ?? form.sites[0]?.value },
            { name: "customerId", label: t("customer"), type: "select", options: form.customers, empty: "—", testId: "counter-customer" },
            {
              name: "priceClass",
              label: t("priceClass"),
              type: "select",
              empty: t("customerDefault"),
              options: form.priceClasses.map((c) => ({ value: c, label: t(`priceClasses.${c}`) })),
              hint: t("priceClassHint"),
            },
            { name: "reference", label: t("reference"), placeholder: t("optional") },
          ]}
        />
      </Section>
    </div>
  );
}
