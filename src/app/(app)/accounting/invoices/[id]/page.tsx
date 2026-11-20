import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Banknote } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatBp, formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getInvoice, invoiceTotals } from "@/modules/accounting";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { Button } from "@/components/ui/button";
import { deleteDraftInvoiceAction, issueInvoiceAction } from "../../actions";
import { CreditForm } from "./credit-form";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("accounting");
  const { actor } = await getRequestContext();
  const inv = await query((ctx) => getInvoice(ctx, id));
  const today = await query(async (ctx) => ctx.businessDate);
  const totals = invoiceTotals(inv.lines);
  const isDraft = inv.status === "DRAFT";
  const due = inv.totalInclVatCents - inv.paidCents;
  const overdue = inv.kind === "INVOICE" && !isDraft && due > 0 && inv.dueDate && inv.dueDate < today;
  const canValidate = can(actor.permissions, "accounting.invoice", "validate", inv.siteId);
  const canCreate = can(actor.permissions, "accounting.invoice", "create", inv.siteId);
  const canPay = can(actor.permissions, "accounting.payment", "create", inv.siteId);
  const title = inv.number ? `${t(`kinds.${inv.kind}`)} ${inv.number}` : `${t(`kinds.${inv.kind}`)} (${t("statuses.DRAFT")})`;

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        subtitle={inv.customer.displayName}
        backHref="/accounting/invoices"
        badges={
          <>
            <StatusBadge status={inv.status} label={t(`statuses.${inv.status}`)} />
            {overdue && <StatusBadge status="overdue" label={t("overdue")} />}
            {inv.vatRegime === "MARGIN" && <StatusBadge status="VO" label={t("regimes.MARGIN")} />}
          </>
        }
        actions={
          <>
            {isDraft && canValidate && <ActionButton action={issueInvoiceAction.bind(null, inv.id)} label={t("issue")} successMessage="Invoice issued" />}
            {isDraft && canCreate && (
              <ActionButton action={deleteDraftInvoiceAction.bind(null, inv.id)} label={t("deleteDraft")} variant="outline" confirm="Delete this draft?" />
            )}
            {!isDraft && inv.kind === "INVOICE" && due > 0 && canPay && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/accounting/payments/new?customer=${inv.customerId}&invoice=${inv.id}&site=${inv.siteId}`}>
                  <Banknote /> {t("recordPayment")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Section title={t("lines")}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-3">{t("label")}</th>
                    <th className="py-1.5 pr-3">{t("department")}</th>
                    <th className="py-1.5 pr-3 text-right">{t("quantity")}</th>
                    <th className="py-1.5 pr-3 text-right">{t("unitPrice")}</th>
                    <th className="py-1.5 pr-3 text-right">{t("discount")}</th>
                    <th className="py-1.5 pr-3 text-right">{t("vatRate")}</th>
                    <th className="py-1.5 text-right">{t("totalExcl")}</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{l.label}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{t(`departments.${l.departmentCode}`)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{Number(l.quantity)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.unitPriceExclVatCents)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{l.discountBp ? formatBp(l.discountBp, 1) : ""}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatBp(l.vatRateBp, 1)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatMoney(l.lineExclVatCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap justify-between gap-6">
              <table className="text-[13px]">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pr-4">{t("vatBreakdown")}</th>
                    <th className="pr-4 text-right">{t("base")}</th>
                    <th className="text-right">{t("vat")}</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.vatByRate.map((r) => (
                    <tr key={r.vatRateCode}>
                      <td className="pr-4">{inv.vatRegime === "MARGIN" ? t("regimes.MARGIN") : formatBp(r.vatRateBp, 1)}</td>
                      <td className="pr-4 text-right tabular-nums">{formatMoney(r.baseCents)}</td>
                      <td className="text-right tabular-nums">{formatMoney(r.vatCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t("totalExcl")}</dt>
                <dd className="text-right tabular-nums">{formatMoney(inv.totalExclVatCents)}</dd>
                <dt className="text-muted-foreground">{t("vat")}</dt>
                <dd className="text-right tabular-nums">{formatMoney(inv.vatCents)}</dd>
                <dt className="font-semibold">{t("totalIncl")}</dt>
                <dd className="text-right font-semibold tabular-nums">{formatMoney(inv.totalInclVatCents)}</dd>
                {!isDraft && (
                  <>
                    <dt className="text-muted-foreground">{t("paid")}</dt>
                    <dd className="text-right tabular-nums">{formatMoney(inv.paidCents)}</dd>
                    <dt className="font-semibold">{t("due")}</dt>
                    <dd className="text-right font-semibold tabular-nums" data-testid="invoice-due">
                      {formatMoney(due)}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          </Section>
          {inv.allocations.length > 0 && (
            <Section title={t("allocations")}>
              <ul className="divide-y text-[13px]">
                {inv.allocations.map((a) => (
                  <li key={a.id} className="flex justify-between py-1.5">
                    <Link href={`/accounting/payments/${a.payment.id}`} className="text-primary hover:underline">
                      {a.payment.number} · {t(`methods.${a.payment.method}`)} · {formatDate(a.payment.businessDate)}
                    </Link>
                    <span className="tabular-nums">{formatMoney(a.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {inv.kind === "INVOICE" && !isDraft && inv.creditNotes.length === 0 && canValidate && (
            <Section title={t("createCreditNote")}>
              <CreditForm invoiceId={inv.id} />
            </Section>
          )}
        </div>
        <Section title={t("invoice")}>
          <Fields
            items={[
              { label: t("customer"), value: <Link className="text-primary hover:underline" href={`/customers/${inv.customerId}`}>{inv.customer.displayName}</Link> },
              { label: t("site"), value: inv.site.name },
              { label: t("issueDate"), value: formatDate(inv.issueDate) },
              { label: t("dueDate"), value: formatDate(inv.dueDate) },
              { label: t("vatRegime"), value: t(`regimes.${inv.vatRegime}`) },
              { label: t("source"), value: inv.sourceType && t.has(`sources.${inv.sourceType}`) ? t(`sources.${inv.sourceType}`) : inv.sourceType },
              { label: t("journalEntry"), value: inv.entry ? <Link className="text-primary hover:underline" href={`/accounting/entries/${inv.entry.id}`}>{inv.entry.number}</Link> : null },
              ...(inv.creditedInvoice ? [{ label: t("creditedInvoice"), value: <Link className="text-primary hover:underline" href={`/accounting/invoices/${inv.creditedInvoice.id}`}>{inv.creditedInvoice.number}</Link> }] : []),
              ...inv.creditNotes.map((c) => ({ label: t("creditNote"), value: <Link className="text-primary hover:underline" href={`/accounting/invoices/${c.id}`}>{c.number}</Link> })),
              ...(inv.notes ? [{ label: t("notes"), value: inv.notes }] : []),
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
