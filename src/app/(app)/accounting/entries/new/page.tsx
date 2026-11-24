import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { listJournals, listPartyOptions, listPostableAccounts } from "@/modules/accounting";
import { PageHeader, Section } from "@/components/shared/page-header";
import { EntryForm } from "./entry-form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("newJournalEntry");

export default async function NewEntryPage() {
  const t = await getTranslations("accounting");
  const { sites, siteId } = await getRequestContext();
  const [accounts, journals, parties, businessDate] = await Promise.all([
    query((ctx) => listPostableAccounts(ctx), { resource: "accounting.entry", action: "create" }),
    query((ctx) => listJournals(ctx)),
    query((ctx) => listPartyOptions(ctx)),
    query(async (ctx) => ctx.businessDate),
  ]);
  return (
    <div>
      <PageHeader title={t("newEntry")} backHref="/accounting/entries" />
      <Section>
        <EntryForm
          defaultDate={isoDate(businessDate)}
          defaultSiteId={siteId ?? sites[0]?.id ?? ""}
          sites={sites.map((s) => ({ value: s.id, label: s.name }))}
          journals={journals.filter((j) => !["VE", "AN"].includes(j.code)).map((j) => ({ value: j.code, label: `${j.code} — ${t(`journals.${j.code}`)}` }))}
          accounts={accounts.map((a) => ({ code: a.code, label: a.label, analytic: a.requiresAnalytic, receivable: a.isReceivable, payable: a.isPayable }))}
          customers={parties.customers}
          suppliers={parties.suppliers}
        />
      </Section>
    </div>
  );
}
