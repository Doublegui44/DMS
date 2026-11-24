import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { getCustomer } from "@/modules/core";
import { PageHeader } from "@/components/shared/page-header";
import { saveCustomerAction } from "../../actions";
import { CustomerForm } from "../../customer-form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("editCustomer");

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const { sites } = await getRequestContext();
  const c = await query((ctx) => getCustomer(ctx, id), { resource: "customer", action: "edit" });
  return (
    <div>
      <PageHeader title={`${t("customer.edit")} · ${c.displayName}`} backHref={`/customers/${id}`} />
      <CustomerForm
        action={saveCustomerAction.bind(null, id)}
        initial={c}
        sites={sites}
        submitLabel={t("common.save")}
        cancelHref={`/customers/${id}`}
      />
    </div>
  );
}
