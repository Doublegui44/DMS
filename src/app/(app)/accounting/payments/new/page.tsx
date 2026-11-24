import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { listOpenItems, listPartyOptions } from "@/modules/accounting";
import { PageHeader, Section } from "@/components/shared/page-header";
import { PaymentForm } from "./payment-form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("newPayment");

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ customer?: string; invoice?: string; site?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations("accounting");
  const { sites, siteId } = await getRequestContext();
  const parties = await query((ctx) => listPartyOptions(ctx), { resource: "accounting.payment", action: "create" });
  const openItems = sp.customer ? await query((ctx) => listOpenItems(ctx, sp.customer!)) : [];
  return (
    <div>
      <PageHeader title={t("newPayment")} backHref="/accounting/payments" />
      <Section>
        <PaymentForm
          key={sp.customer ?? "none"}
          defaultSiteId={sp.site ?? siteId ?? sites[0]?.id ?? ""}
          customerId={sp.customer ?? ""}
          preselectInvoiceId={sp.invoice ?? null}
          sites={sites.map((s) => ({ value: s.id, label: s.name }))}
          customers={parties.customers}
          suppliers={parties.suppliers}
          openItems={openItems.map((i) => ({
            id: i.id,
            number: i.number ?? "",
            kind: i.kind,
            dueDate: i.dueDate ? isoDate(i.dueDate) : null,
            dueCents: i.totalInclVatCents - i.paidCents,
          }))}
        />
      </Section>
    </div>
  );
}
