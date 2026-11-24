import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { getQuote, getQuoteFormData } from "@/modules/sales";
import { PageHeader } from "@/components/shared/page-header";
import { QuoteBuilder } from "../../quote-builder";
import { draftFromQuote, toBuilderData } from "../../draft";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("editQuote");

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("sales");
  const { actor } = await getRequestContext();
  const quote = await query((ctx) => getQuote(ctx, id), { resource: "sales.quote", action: "edit" });
  // Only drafts change; a sent quote is revised first (back to draft).
  if (quote.status !== "DRAFT") redirect(`/sales/quotes/${id}`);
  const data = await query((ctx) => getQuoteFormData(ctx, quote.leadId));
  return (
    <div>
      <PageHeader title={t("editQuote", { number: quote.number })} subtitle={t("quoteFor", { customer: quote.customer.displayName, lead: quote.lead.number })} backHref={`/sales/quotes/${id}`} />
      <QuoteBuilder data={toBuilderData(data)} quoteId={quote.id} initial={draftFromQuote(quote)} canSend={can(actor.permissions, "sales.quote", "edit", quote.siteId)} />
    </div>
  );
}
