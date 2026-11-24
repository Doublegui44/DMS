import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { getPurchaseOrderFormData } from "@/modules/parts";
import { PageHeader, Section } from "@/components/shared/page-header";
import { SpecForm } from "@/components/shared/spec-form";
import { createPurchaseOrderAction } from "../../actions";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("newPurchaseOrder");

export default async function NewPurchaseOrderPage() {
  const t = await getTranslations("parts");
  const { siteId } = await getRequestContext();
  const form = await query((ctx) => getPurchaseOrderFormData(ctx), { resource: "parts.purchase_order", action: "create" });
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("newOrder")} subtitle={t("newOrderHint")} backHref="/parts/purchasing" />
      <Section>
        <SpecForm
          action={createPurchaseOrderAction}
          submitLabel={t("createOrder")}
          cancelHref="/parts/purchasing"
          fields={[
            { name: "siteId", label: t("site"), type: "select", options: form.sites, defaultValue: form.sites.find((s) => s.value === siteId)?.value ?? form.sites[0]?.value },
            { name: "supplierId", label: t("supplier"), type: "select", options: form.suppliers, empty: "—", testId: "po-supplier" },
            { name: "kind", label: t("kind"), type: "select", options: ["STOCK", "EMERGENCY"].map((k) => ({ value: k, label: t(`poKinds.${k}`) })), defaultValue: "STOCK", hint: t("kindHint") },
            { name: "expectedOn", label: t("expectedOn"), type: "date", hint: t("expectedOnHint") },
            { name: "notes", label: t("notes"), type: "textarea", wide: true },
          ]}
        />
      </Section>
    </div>
  );
}
