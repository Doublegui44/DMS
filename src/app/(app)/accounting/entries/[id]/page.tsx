import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getEntry, periodLabel } from "@/modules/accounting";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ReverseForm } from "./reverse-form";

const SOURCE_LINKS: Record<string, string> = { INVOICE: "/accounting/invoices/", PAYMENT: "/accounting/payments/", REVERSAL: "/accounting/entries/" };

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("accounting");
  const { actor } = await getRequestContext();
  const e = await query((ctx) => getEntry(ctx, id));
  const debit = e.lines.reduce((s, l) => s + l.debitCents, 0);
  const credit = e.lines.reduce((s, l) => s + l.creditCents, 0);
  const reversible =
    !e.reversedBy && (e.sourceType === "MANUAL" || e.sourceType === "OPENING") && can(actor.permissions, "accounting.entry", "validate", e.siteId);
  const sourceHref = e.sourceType && e.sourceId && SOURCE_LINKS[e.sourceType] ? `${SOURCE_LINKS[e.sourceType]}${e.sourceId}` : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t("entry")} ${e.number}`}
        subtitle={e.label}
        backHref="/accounting/entries"
        badges={
          <>
            {e.sourceType && <StatusBadge status={e.sourceType} label={t.has(`sources.${e.sourceType}`) ? t(`sources.${e.sourceType}`) : e.sourceType} />}
            <StatusBadge status={e.period.status} label={t(`statuses.${e.period.status}`)} />
          </>
        }
      />
      <Section title={t("entry")}>
        <Fields
          items={[
            { label: t("date"), value: formatDate(e.entryDate) },
            { label: t("journal"), value: `${e.journalCode} — ${t(`journals.${e.journalCode}`)}` },
            { label: t("period"), value: periodLabel(e.period) },
            { label: t("site"), value: e.site.name },
            {
              label: t("source"),
              value: sourceHref ? (
                <Link className="text-primary hover:underline" href={sourceHref}>
                  {t.has(`sources.${e.sourceType}`) ? t(`sources.${e.sourceType}`) : e.sourceType}
                </Link>
              ) : (
                e.sourceType
              ),
            },
            { label: t("createdBy"), value: `${e.createdBy ? `${e.createdBy.firstName} ${e.createdBy.lastName}` : "System"} · ${formatDateTime(e.createdAt)}` },
            ...(e.reversalOf ? [{ label: t("reversalOf"), value: <Link className="text-primary hover:underline" href={`/accounting/entries/${e.reversalOf.id}`}>{e.reversalOf.number}</Link> }] : []),
            ...(e.reversedBy ? [{ label: t("reversedBy"), value: <Link className="text-primary hover:underline" href={`/accounting/entries/${e.reversedBy.id}`}>{e.reversedBy.number}</Link> }] : []),
          ]}
        />
      </Section>
      <Section title={t("lines")}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" data-testid="entry-lines">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-3">#</th>
                <th className="py-1.5 pr-3">{t("account")}</th>
                <th className="py-1.5 pr-3">{t("label")}</th>
                <th className="py-1.5 pr-3">{t("department")}</th>
                <th className="py-1.5 pr-3">{t("party")}</th>
                <th className="py-1.5 pr-3 text-right">{t("debit")}</th>
                <th className="py-1.5 pr-3 text-right">{t("credit")}</th>
                <th className="py-1.5">{t("lettering")}</th>
              </tr>
            </thead>
            <tbody>
              {e.lines.map((l) => {
                const party = l.partyId ? e.parties.get(l.partyId) : null;
                return (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 text-muted-foreground">{l.lineNo}</td>
                    <td className="py-1.5 pr-3">
                      <Link href={`/accounting/chart/${l.accountCode}`} className="font-mono text-xs text-primary hover:underline">
                        {l.accountCode}
                      </Link>{" "}
                      <span className="text-muted-foreground">{l.account.label}</span>
                    </td>
                    <td className="py-1.5 pr-3">{l.label}</td>
                    <td className="py-1.5 pr-3">{l.departmentCode ? t(`departments.${l.departmentCode}`) : ""}</td>
                    <td className="py-1.5 pr-3">
                      {party && (
                        <Link href={`/accounting/ledgers/${party.type.toLowerCase()}/${l.partyId}`} className="text-primary hover:underline">
                          {party.name} <span className="font-mono text-xs text-muted-foreground">{party.accountCode}</span>
                        </Link>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{l.debitCents ? formatMoney(l.debitCents) : ""}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{l.creditCents ? formatMoney(l.creditCents) : ""}</td>
                    <td className="py-1.5 font-mono text-xs">{l.letteringCode}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={5} className="py-1.5 pr-3 text-right">{t("total")}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(debit)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(credit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>
      {reversible && (
        <Section title={t("reverse")}>
          <ReverseForm entryId={e.id} />
        </Section>
      )}
    </div>
  );
}
