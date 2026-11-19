import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getPayment } from "@/modules/accounting";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("accounting");
  const p = await query((ctx) => getPayment(ctx, id));
  const party = p.customer
    ? <Link className="text-primary hover:underline" href={`/customers/${p.customer.id}`}>{p.customer.displayName}</Link>
    : p.supplier && <Link className="text-primary hover:underline" href={`/accounting/ledgers/supplier/${p.supplier.id}`}>{p.supplier.name}</Link>;
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t(`directions.${p.direction}`)} ${p.number}`}
        subtitle={formatMoney(p.amountCents)}
        backHref="/accounting/payments"
        badges={<StatusBadge status={p.direction} label={t(`directions.${p.direction}`)} />}
      />
      <Section title={t("payment")}>
        <Fields
          items={[
            { label: t("date"), value: formatDate(p.businessDate) },
            { label: t("party"), value: party },
            { label: t("method"), value: t(`methods.${p.method}`) },
            { label: t("journal"), value: `${p.journalCode} — ${t(`journals.${p.journalCode}`)}` },
            { label: t("amount"), value: formatMoney(p.amountCents) },
            { label: t("allocated"), value: formatMoney(p.allocatedCents) },
            { label: t("reference"), value: p.reference },
            { label: t("site"), value: p.site.name },
            { label: t("journalEntry"), value: p.entry ? <Link className="text-primary hover:underline" href={`/accounting/entries/${p.entry.id}`}>{p.entry.number}</Link> : null },
          ]}
        />
      </Section>
      {p.allocations.length > 0 && (
        <Section title={t("allocations")}>
          <ul className="divide-y text-[13px]">
            {p.allocations.map((a) => (
              <li key={a.id} className="flex justify-between py-1.5">
                <Link href={`/accounting/invoices/${a.invoice.id}`} className="text-primary hover:underline">
                  {t(`kinds.${a.invoice.kind}`)} {a.invoice.number}
                </Link>
                <span className="tabular-nums">{formatMoney(a.amountCents)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
