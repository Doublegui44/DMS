import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getTimeline } from "@/modules/core";
import { getLead } from "@/modules/sales";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { SpecForm } from "@/components/shared/spec-form";
import { Timeline } from "@/components/shared/timeline";
import { Button } from "@/components/ui/button";
import { contactLeadAction, loseLeadAction } from "../../actions";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("sales");
  const { actor } = await getRequestContext();
  const [lead, timeline] = await Promise.all([query((ctx) => getLead(ctx, id)), query((ctx) => getTimeline(ctx, "Lead", id))]);
  const open = lead.stage !== "WON" && lead.stage !== "LOST";
  const canEdit = can(actor.permissions, "sales.lead", "edit", lead.siteId);
  const canQuote = can(actor.permissions, "sales.quote", "create", lead.siteId);
  const vehicleOf = (q: (typeof lead.quotes)[number]) =>
    q.vehicle ? `${q.vehicle.make} ${q.vehicle.model} ${q.vehicle.version}` : q.catalogueVersion ? `${q.catalogueVersion.model.brand.name} ${q.catalogueVersion.model.name} ${q.catalogueVersion.name} (${t("factoryOrder").toLowerCase()})` : "—";

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t("lead")} ${lead.number}`}
        subtitle={lead.customer.displayName}
        backHref="/sales/pipeline"
        badges={
          <>
            <StatusBadge status={lead.stage} label={t(`leadStages.${lead.stage}`)} />
            <StatusBadge status={lead.interest} label={t(`interests.${lead.interest}`)} />
          </>
        }
        actions={
          <>
            {lead.stage === "NEW" && canEdit && <ActionButton action={contactLeadAction.bind(null, lead.id)} label={t("markContacted")} variant="outline" successMessage={t("leadContacted")} />}
            {open && canQuote && (
              <Button asChild size="sm">
                <Link href={`/sales/quotes/new?lead=${lead.id}`}>
                  <FileText /> {t("newQuote")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Section title={t("quotes")}>
            {lead.quotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noQuotes")}</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-3 font-medium">{t("quote")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("vehicle")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("date")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("status")}</th>
                    <th className="py-1.5 text-right font-medium">{t("totalIncl")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lead.quotes.map((q) => (
                    <tr key={q.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">
                        <Link href={`/sales/quotes/${q.id}`} className="font-medium text-primary hover:underline">
                          {q.number}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3">{vehicleOf(q)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{formatDate(q.createdOn)}</td>
                      <td className="py-1.5 pr-3">
                        <StatusBadge status={q.status} label={t(`quoteStatuses.${q.status}`)} />
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatMoney(q.totalInclVatCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
          {lead.salesOrders.length > 0 && (
            <Section title={t("orders")}>
              <ul className="divide-y text-[13px]">
                {lead.salesOrders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-1.5">
                    <Link href={`/sales/orders/${o.id}`} className="font-medium text-primary hover:underline">
                      {o.number}
                    </Link>
                    <span className="flex items-center gap-3">
                      <StatusBadge status={o.status} label={t(`orderStatuses.${o.status}`)} />
                      <span className="tabular-nums">{formatMoney(o.totalInclVatCents)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {open && canEdit && (
            <Section title={t("markLost")}>
              <SpecForm action={loseLeadAction.bind(null, lead.id)} submitLabel={t("markLost")} inline fields={[{ name: "reason", label: t("lostReason"), placeholder: t("lostReasonPlaceholder") }]} />
            </Section>
          )}
          <Section title={t("activity")}>
            <Timeline items={timeline} />
          </Section>
        </div>
        <Section title={t("lead")}>
          <Fields
            items={[
              { label: t("customer"), value: <Link className="text-primary hover:underline" href={`/customers/${lead.customerId}`}>{lead.customer.displayName}</Link> },
              { label: t("site"), value: lead.site.name },
              { label: t("salesperson"), value: lead.salesperson ? `${lead.salesperson.firstName} ${lead.salesperson.lastName}` : null },
              { label: t("source"), value: t(`sources.${lead.source}`) },
              { label: t("openedOn"), value: formatDate(lead.openedOn) },
              { label: t("closedOn"), value: lead.closedOn ? formatDate(lead.closedOn) : null },
              ...(lead.description ? [{ label: t("need"), value: lead.description }] : []),
              ...(lead.lostReason ? [{ label: t("lostReason"), value: lead.lostReason }] : []),
              { label: t("phone"), value: lead.customer.phone },
              { label: t("email"), value: lead.customer.email },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
