import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { getTransferFormData } from "@/modules/parts";
import { PageHeader, Section } from "@/components/shared/page-header";
import { TableForm } from "../../../table-form";
import { transferStockAction } from "../../../actions";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("newTransfer");

export default async function NewTransferPage() {
  const t = await getTranslations("parts");
  const { siteId } = await getRequestContext();
  const form = await query((ctx) => getTransferFormData(ctx), { resource: "parts.stock", action: "view" });
  const from = form.from.find((s) => s.value === siteId)?.value ?? form.from[0]?.value ?? "";
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("newTransfer")} subtitle={t("newTransferHint")} backHref="/parts/stock/transfers" />
      <Section>
        <TableForm
          action={transferStockAction}
          submitLabel={t("transfer")}
          fields={[
            { name: "fromSiteId", label: t("fromSite"), type: "select", options: form.from, defaultValue: from },
            { name: "toSiteId", label: t("toSite"), type: "select", options: form.to.filter((s) => s.value !== from), testId: "transfer-to" },
            { name: "notes", label: t("notes"), placeholder: t("optional") },
          ]}
          headers={[t("line")]}
          inputHeaders={[t("partNumber"), t("qty")]}
          rows={Array.from({ length: 8 }, (_, i) => ({
            id: `l${i + 1}`,
            cells: [String(i + 1)],
            inputs: [
              { name: "partNumber", wide: true, testId: `transfer-part-${i + 1}` },
              { name: "qty", testId: `transfer-qty-${i + 1}` },
            ],
          }))}
        />
      </Section>
    </div>
  );
}
