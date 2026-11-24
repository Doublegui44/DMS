import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { listPartyOptions, listVatRates, REVENUE_KEYS } from "@/modules/accounting";
import { PageHeader, Section } from "@/components/shared/page-header";
import { InvoiceForm } from "./invoice-form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("newInvoice");

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations("accounting");
  const { actor, sites, siteId } = await getRequestContext();
  const parties = await query((ctx) => listPartyOptions(ctx), { resource: "accounting.invoice", action: "create" });
  const vatRates = await query((ctx) => listVatRates(ctx));
  return (
    <div>
      <PageHeader title={t("newInvoice")} backHref="/accounting/invoices" />
      <Section>
        <InvoiceForm
          defaultSiteId={siteId ?? sites[0]?.id ?? ""}
          defaultCustomerId={sp.customer ?? ""}
          canIssue={can(actor.permissions, "accounting.invoice", "validate")}
          sites={sites.map((s) => ({ value: s.id, label: s.name }))}
          customers={parties.customers}
          vatRates={vatRates.map((r) => ({ value: r.code, label: r.label, bp: r.rateBp }))}
          revenueKeys={REVENUE_KEYS.map((r) => ({ value: r.key, label: r.label }))}
        />
      </Section>
    </div>
  );
}
