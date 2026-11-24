import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { getLeadFormData, LEAD_SOURCES } from "@/modules/sales";
import { PageHeader, Section } from "@/components/shared/page-header";
import { SpecForm } from "@/components/shared/spec-form";
import { createLeadAction } from "../../actions";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("newLead");

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<{ customer?: string; interest?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations("sales");
  const { sites, siteId } = await getRequestContext();
  const data = await query((ctx) => getLeadFormData(ctx), { resource: "sales.lead", action: "create" });
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("newLead")} subtitle={t("newLeadHint")} backHref="/sales/pipeline" />
      <Section>
        <SpecForm
          action={createLeadAction}
          submitLabel={t("createLead")}
          successMessage={t("leadCreated")}
          cancelHref="/sales/pipeline"
          fields={[
            { name: "customerId", label: t("customer"), type: "select", options: data.customers, defaultValue: sp.customer, empty: t("chooseCustomer"), wide: true, testId: "lead-customer" },
            { name: "siteId", label: t("site"), type: "select", options: sites.map((s) => ({ value: s.id, label: s.name })), defaultValue: siteId ?? sites[0]?.id },
            { name: "salespersonId", label: t("salesperson"), type: "select", options: data.salespeople, empty: t("me") },
            { name: "interest", label: t("interest"), type: "select", options: [{ value: "VN", label: t("interests.VN") }, { value: "VO", label: t("interests.VO") }], defaultValue: sp.interest === "VO" ? "VO" : "VN" },
            { name: "source", label: t("source"), type: "select", options: LEAD_SOURCES.map((s) => ({ value: s, label: t(`sources.${s}`) })), defaultValue: "WALK_IN" },
            { name: "description", label: t("need"), type: "textarea", placeholder: t("needPlaceholder"), wide: true },
          ]}
        />
      </Section>
    </div>
  );
}
