import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { EntryLink } from "../../../entry-link";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { CASH_METHODS } from "@/modules/accounting";
import { getSupplierInvoice } from "@/modules/parts";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { SpecForm } from "@/components/shared/spec-form";
import { decideSupplierInvoiceAction, paySupplierInvoiceAction } from "../../../actions";
import { fmtQty } from "../../../format";

export const metadata = { title: "Supplier invoice" };

export default async function SupplierInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("parts");
  const d = await query((ctx) => getSupplierInvoice(ctx, id));
  const inv = d.invoice;
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t("supplierInvoice")} ${inv.number}`}
        subtitle={`${inv.supplier.name} · ${inv.supplierReference} · ${inv.site.name}`}
        backHref="/parts/purchasing/invoices"
        badges={<StatusBadge status={inv.status} label={t(`invoiceStatuses.${inv.status}`)} />}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Section title={t("lines")}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" data-testid="si-lines">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-3 font-medium">{t("receipt")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("order")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("partNumber")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("qty")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("receiptCost")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("invoicedPrice")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("amount")}</th>
                    <th className="py-1.5 text-right font-medium">{t("variance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{l.receiptLine.receipt.number}</td>
                      <td className="py-1.5 pr-3">
                        <Link className="text-primary hover:underline" href={`/parts/purchasing/${l.receiptLine.receipt.purchaseOrder.id}`}>
                          {l.receiptLine.receipt.purchaseOrder.number}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3">
                        <Link className="text-primary hover:underline" href={`/parts/catalogue/${l.receiptLine.poLine.part.id}`}>
                          {l.receiptLine.poLine.part.partNumber}
                        </Link>{" "}
                        <span className="text-muted-foreground">{l.receiptLine.poLine.part.description}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmtQty(l.qty)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.receiptLine.unitCostCents)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.unitCostCents)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.amountCents)}</td>
                      <td className={`py-1.5 text-right tabular-nums ${l.varianceCents !== 0 ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}>{formatMoney(l.varianceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {inv.status === "VARIANCE" && (
            <Section title={t("varianceReview")}>
              <p className="mb-3 text-[13px] text-muted-foreground">
                {t("varianceExplain", { variance: formatMoney(inv.varianceCents), tolerance: formatMoney(d.tolerance.amountCents), percent: d.tolerance.rateBp / 100 })}
              </p>
              {d.canDecide ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <SpecForm
                    action={decideSupplierInvoiceAction.bind(null, inv.id, "APPROVE")}
                    submitLabel={t("approveVariance")}
                    fields={[{ name: "notes", label: t("notes"), placeholder: t("optional"), testId: "si-approve-notes" }]}
                  />
                  <SpecForm
                    action={decideSupplierInvoiceAction.bind(null, inv.id, "REJECT")}
                    submitLabel={t("rejectInvoice")}
                    fields={[{ name: "notes", label: t("rejectReason"), testId: "si-reject-notes" }]}
                  />
                </div>
              ) : (
                <p className="text-[13px]">{t("awaitingApproval")}</p>
              )}
            </Section>
          )}

          {inv.status === "MATCHED" && d.canPay && (
            <Section title={t("paySupplier")}>
              <SpecForm
                action={paySupplierInvoiceAction.bind(null, inv.id)}
                submitLabel={t("payAmount", { amount: formatMoney(inv.totalInclVatCents) })}
                inline
                fields={[{ name: "method", label: t("method"), type: "select", defaultValue: "TRANSFER", options: CASH_METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) })), testId: "si-pay-method" }]}
              />
            </Section>
          )}
        </div>

        <Section title={t("supplierInvoice")}>
          <Fields
            items={[
              { label: t("supplier"), value: inv.supplier.name },
              { label: t("supplierReference"), value: inv.supplierReference },
              { label: t("invoiceDate"), value: formatDate(inv.invoiceDate) },
              { label: t("dueDate"), value: formatDate(inv.dueDate) },
              { label: t("receiptValue"), value: formatMoney(inv.receiptValueCents) },
              { label: t("variance"), value: <span data-testid="si-variance">{formatMoney(inv.varianceCents)}</span> },
              { label: t("totalExcl"), value: formatMoney(inv.totalExclVatCents) },
              { label: t("vat"), value: formatMoney(inv.vatCents) },
              { label: t("totalIncl"), value: <span className="font-semibold" data-testid="si-total">{formatMoney(inv.totalInclVatCents)}</span> },
              {
                label: t("entry"),
                value: d.entry ? (
                  <EntryLink id={d.entry.id} number={d.entry.number} testId="si-entry" />
                ) : null,
              },
              {
                label: t("payment"),
                value: d.payment ? (
                  <Link className="text-primary hover:underline" href={`/accounting/payments/${d.payment.id}`}>
                    {d.payment.number} · {formatDate(d.payment.businessDate)}
                  </Link>
                ) : null,
              },
              { label: t("decidedBy"), value: d.decidedBy ? `${d.decidedBy}${inv.decidedOn ? ` · ${formatDate(inv.decidedOn)}` : ""}` : null },
              { label: t("notes"), value: inv.notes },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
