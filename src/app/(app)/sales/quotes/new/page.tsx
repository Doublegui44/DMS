import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { getQuoteFormData } from "@/modules/sales";
import { PageHeader } from "@/components/shared/page-header";
import { QuoteBuilder } from "../quote-builder";
import { emptyDraft, toBuilderData } from "../draft";

export const metadata = { title: "New quote" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const { lead: leadId } = await searchParams;
  if (!leadId) redirect("/sales/pipeline");
  const t = await getTranslations("sales");
  const { actor } = await getRequestContext();
  const data = await query((ctx) => getQuoteFormData(ctx, leadId), { resource: "sales.quote", action: "create" });
  return (
    <div>
      <PageHeader title={t("newQuote")} subtitle={t("quoteFor", { customer: data.lead.customer.displayName, lead: data.lead.number })} backHref={`/sales/leads/${leadId}`} />
      <QuoteBuilder data={toBuilderData(data)} quoteId={null} initial={emptyDraft()} canSend={can(actor.permissions, "sales.quote", "edit", data.lead.siteId)} />
    </div>
  );
}
