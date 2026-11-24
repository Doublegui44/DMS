import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Check, X } from "lucide-react";
import { query } from "@/lib/session";
import { EntryLink } from "../../entry-link";
import { formatBp, formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { CASH_METHODS } from "@/modules/accounting";
import { getCounterSale } from "@/modules/parts";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { SpecForm } from "@/components/shared/spec-form";
import { ActionButton } from "@/components/shared/action-button";
import { addCounterLineAction, cancelCounterSaleAction, confirmCounterSaleAction, invoiceCounterSaleAction, removeCounterLineAction } from "../../actions";
import { bpToPercent, fmtQty } from "../../format";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("counterSale");

export default async function CounterSalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("parts");
  const d = await query((ctx) => getCounterSale(ctx, id));
  const { sale } = d;
  const quote = sale.status === "QUOTE";
  const open = quote || sale.status === "CONFIRMED";
  const short = d.lines.some((l) => l.short);
  const payOptions = [
    { value: "ACCOUNT", label: t("onAccount") },
    ...(d.canTakePayment ? CASH_METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) })) : []),
  ];
  // Individuals pay at the counter; companies with terms default to their account.
  const defaultPay = sale.customer.kind === "COMPANY" && sale.customer.paymentTermsDays > 0 ? "ACCOUNT" : d.canTakePayment ? "CARD" : "ACCOUNT";
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t("counterSale")} ${sale.number}`}
        subtitle={`${sale.customer.displayName} · ${sale.site.name}`}
        backHref="/parts/counter"
        badges={
          <>
            <StatusBadge status={sale.status} label={t(`counterStatuses.${sale.status}`)} />
            <StatusBadge status={sale.priceClass} label={t(`priceClasses.${sale.priceClass}`)} />
          </>
        }
        actions={
          d.canEdit &&
          open && (
            <>
              {quote && d.lines.length > 0 && (
                <ActionButton action={confirmCounterSaleAction.bind(null, sale.id)} label={t("confirmSale")} icon={<Check />} successMessage={t("saleConfirmed")} variant="outline" />
              )}
              <ActionButton action={cancelCounterSaleAction.bind(null, sale.id)} label={t("cancelSale")} variant="outline" icon={<X />} confirm={t("cancelSaleConfirm")} />
            </>
          )
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Section title={t("lines")}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" data-testid="counter-lines">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-3 font-medium">{t("partNumber")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("description")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("bin")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("qty")}</th>
                    {open && <th className="py-1.5 pr-3 text-right font-medium">{t("available")}</th>}
                    <th className="py-1.5 pr-3 text-right font-medium">{t("listPrice")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("discount")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("amount")}</th>
                    {sale.status === "INVOICED" && <th className="py-1.5 pr-3 text-right font-medium">{t("cost")}</th>}
                    {quote && d.canEdit && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {d.lines.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-3 text-center text-muted-foreground">
                        {t("noLines")}
                      </td>
                    </tr>
                  )}
                  {d.lines.map((l) => (
                    <tr key={l.id} className="border-b last:border-0" data-part={l.part.partNumber}>
                      <td className="py-1.5 pr-3">
                        <Link className="text-primary hover:underline" href={`/parts/catalogue/${l.part.id}`}>
                          {l.part.partNumber}
                        </Link>
                        {l.requestedNumber && <div className="text-xs text-muted-foreground">{t("replaces", { number: l.requestedNumber })}</div>}
                      </td>
                      <td className="py-1.5 pr-3">{l.part.description}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{l.bin ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmtQty(l.qty)}</td>
                      {open && (
                        <td className={`py-1.5 pr-3 text-right tabular-nums ${l.short ? "font-medium text-red-600 dark:text-red-400" : ""}`}>
                          {l.stockItemId ? <Link href={`/parts/stock/${l.stockItemId}`}>{fmtQty(l.available)}</Link> : "0"}
                        </td>
                      )}
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.unitPriceCents)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{l.discountBp ? bpToPercent(l.discountBp) : "—"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.lineExclVatCents)}</td>
                      {sale.status === "INVOICED" && <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.costCents)}</td>}
                      {quote && d.canEdit && (
                        <td className="py-1 text-right">
                          <ActionButton action={removeCounterLineAction.bind(null, sale.id, l.id)} label="" icon={<X />} variant="ghost" />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {short && <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">{t("shortStock")}</p>}
            {quote && d.canEdit && (
              <div className="mt-4 border-t pt-4">
                <SpecForm
                  action={addCounterLineAction.bind(null, sale.id)}
                  submitLabel={t("addLine")}
                  inline
                  fields={[
                    { name: "partNumber", label: t("partNumber"), placeholder: "1609438180", testId: "counter-line-part" },
                    { name: "qty", label: t("qty"), type: "number", defaultValue: "1", testId: "counter-line-qty" },
                  ]}
                />
              </div>
            )}
          </Section>

          {open && d.canEdit && d.lines.length > 0 && (
            <Section title={t("invoiceSale")}>
              <p className="mb-3 text-xs text-muted-foreground">{t("invoiceSaleHint")}</p>
              <SpecForm
                action={invoiceCounterSaleAction.bind(null, sale.id)}
                submitLabel={t("issueInvoice")}
                inline
                fields={[{ name: "paymentMethod", label: t("payment"), type: "select", options: payOptions, defaultValue: defaultPay, testId: "counter-pay" }]}
              />
            </Section>
          )}
        </div>

        <Section title={t("counterSale")}>
          <Fields
            items={[
              { label: t("customer"), value: <Link className="text-primary hover:underline" href={`/customers/${sale.customer.id}`}>{sale.customer.displayName}</Link> },
              { label: t("priceClass"), value: t(`priceClasses.${sale.priceClass}`) },
              { label: t("reference"), value: sale.reference },
              { label: t("date"), value: formatDate(sale.createdOn) },
              { label: t("confirmedOn"), value: sale.confirmedOn ? formatDate(sale.confirmedOn) : null },
              { label: t("totalExcl"), value: <span className="font-semibold" data-testid="counter-total">{formatMoney(sale.totalExclVatCents)}</span> },
              { label: t("cost"), value: sale.status === "INVOICED" ? formatMoney(sale.costCents) : null },
              { label: t("margin"), value: d.margin ? `${formatMoney(d.margin.marginCents)} · ${formatBp(d.margin.marginBp, 1)}` : null },
              {
                label: t("invoice"),
                value: sale.invoice ? (
                  <Link className="text-primary hover:underline" href={`/accounting/invoices/${sale.invoice.id}`} data-testid="counter-invoice">
                    {sale.invoice.number} · {formatMoney(sale.invoice.totalInclVatCents)}
                  </Link>
                ) : null,
              },
              { label: t("paid"), value: sale.invoice ? formatMoney(sale.invoice.paidCents) : null },
              {
                label: t("entries"),
                value: d.entries.length
                  ? d.entries.map((e, i) => (
                      <span key={e.id}>
                        {i > 0 && ", "}
                        <EntryLink id={e.id} number={e.number} />
                      </span>
                    ))
                  : null,
              },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
