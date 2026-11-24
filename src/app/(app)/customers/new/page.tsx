import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { PageHeader } from "@/components/shared/page-header";
import { saveCustomerAction } from "../actions";
import { CustomerForm } from "../customer-form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("newCustomer");

export default async function NewCustomerPage() {
  const t = await getTranslations();
  const { sites, siteId } = await getRequestContext();
  await query(async () => null, { resource: "customer", action: "create" });
  return (
    <div>
      <PageHeader title={t("customer.new")} backHref="/customers" />
      <CustomerForm
        action={saveCustomerAction.bind(null, null)}
        initial={{ kind: "INDIVIDUAL", homeSiteId: siteId }}
        sites={sites}
        submitLabel={t("common.create")}
        cancelHref="/customers"
      />
    </div>
  );
}
