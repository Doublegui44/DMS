import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Check, FileText, Receipt } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getTimeline, isPhysicallyInStock, type StockType, type VehicleStatus } from "@/modules/core";
import { canCancelOrder, canDeliverOrder, canInvoiceOrder, getOrder, MONEY_METHODS } from "@/modules/sales";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { SpecForm } from "@/components/shared/spec-form";
import { Timeline } from "@/components/shared/timeline";
import { Button } from "@/components/ui/button";
import { PdfButton } from "@/components/shared/pdf-button";
import { cn } from "@/lib/utils";
import { cancelOrderAction, deliverOrderAction, invoiceOrderAction, orderPaymentAction } from "../../actions";
import { centsToInput } from "../../quotes/draft";

function Steps({ steps }: { steps: { label: string; date: string | null; done: boolean; hint?: string }[] }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-4" data-testid="order-steps">
      {steps.map((s, i) => (
        <li key={s.label} data-done={s.done} className={cn("flex items-start gap-2 rounded-lg border p-3", s.done ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/5" : "bg-card")}>
          <span
            className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
              s.done ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground",
            )}
          >
            {s.done ? <Check className="size-3" /> : i + 1}
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">{s.label}</span>
            <span className="block text-xs text-muted-foreground">{s.date ?? s.hint ?? "—"}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("sales");
  const { actor } = await getRequestContext();
  const [o, timeline] = await Promise.all([query((ctx) => getOrder(ctx, id)), query((ctx) => getTimeline(ctx, "SalesOrder", id))]);
  const v = o.vehicle;
  const inStock = isPhysicallyInStock({ stockType: v.stockType as StockType, status: v.status as VehicleStatus, stockInDate: v.stockInDate });
  const fo = o.factoryOrder ?? (v.factoryOrder && v.factoryOrder.salesOrderId === o.id ? v.factoryOrder : null);
  const invoiceGuard = canInvoiceOrder({ status: o.status, vehicleInStock: inStock || o.status !== "CONFIRMED" });
  const deliverGuard = canDeliverOrder({ status: o.status, invoiceTotalCents: o.invoice?.totalInclVatCents ?? 0, invoicePaidCents: o.invoice?.paidCents ?? 0 });
  const cancelGuard = canCancelOrder({ status: o.status });
  const canEdit = can(actor.permissions, "sales.order", "edit", o.siteId);
  const canPay = canEdit && can(actor.permissions, "accounting.payment", "create", o.siteId);
  const cashDue = o.totalInclVatCents - o.tradeInCents - o.financedCents;
  const deposits = o.payments.filter((p) => p.direction === "IN" && (MONEY_METHODS as readonly string[]).includes(p.method)).reduce((s, p) => s + p.amountCents, 0);
  const due = o.invoice ? o.invoice.totalInclVatCents - o.invoice.paidCents : Math.max(0, cashDue - deposits);
  const quote = o.quote;
  const name = (u: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}` : null);
  const vehicleLabel = `${v.make} ${v.model} ${v.version}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t("order")} ${o.number}`}
        subtitle={`${o.customer.displayName} · ${vehicleLabel}`}
        backHref="/sales/orders"
        badges={
          <>
            <StatusBadge status={o.status} label={t(`orderStatuses.${o.status}`)} />
            <StatusBadge status={o.stockType} />
          </>
        }
        actions={
          <>
            <PdfButton kind="order" id={o.id} />
            <Button asChild size="sm" variant="outline">
              <Link href={`/sales/quotes/${o.quoteId}`}>
                <FileText /> {t("quote")}
              </Link>
            </Button>
            {o.invoice && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/accounting/invoices/${o.invoice.id}`} data-testid="order-invoice">
                  <Receipt /> {o.invoice.number}
                </Link>
              </Button>
            )}
            {o.status === "CONFIRMED" && can(actor.permissions, "sales.order", "validate", o.siteId) && invoiceGuard.ok && (
              <ActionButton action={invoiceOrderAction.bind(null, o.id)} label={t("invoiceOrder")} confirm={t("invoiceConfirm", { total: formatMoney(o.totalInclVatCents) })} successMessage={t("orderInvoiced")} />
            )}
          </>
        }
      />

      <Steps
        steps={[
          { label: t("stepOrdered"), date: formatDate(o.orderDate), done: true },
          {
            label: t("stepInStock"),
            date: inStock || o.status === "INVOICED" || o.status === "DELIVERED" ? (v.stockInDate ? formatDate(v.stockInDate) : t("yes")) : null,
            done: inStock || o.status === "INVOICED" || o.status === "DELIVERED",
            hint: fo ? t("etaOn", { date: formatDate(fo.expectedOn) }) : undefined,
          },
          { label: t("stepInvoiced"), date: o.invoicedOn ? formatDate(o.invoicedOn) : null, done: !!o.invoicedOn },
          { label: t("stepDelivered"), date: o.deliveredOn ? formatDate(o.deliveredOn) : null, done: !!o.deliveredOn, hint: o.expectedDeliveryDate ? t("plannedOn", { date: formatDate(o.expectedDeliveryDate) }) : undefined },
        ]}
      />

      {o.status === "CANCELLED" && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {t("cancelledOn", { date: o.cancelledOn ? formatDate(o.cancelledOn) : "—", reason: o.cancelReason ?? "—" })}
        </p>
      )}
      {o.status === "CONFIRMED" && !invoiceGuard.ok && <p className="text-sm text-muted-foreground">{invoiceGuard.reason}</p>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Section title={t("dealLines")}>
            <table className="w-full text-[13px]">
              <tbody>
                {quote.lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">{l.label}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(l.lineInclVatCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td className="pt-2 font-medium">{t("totalIncl")}</td>
                  <td className="pt-2 text-right font-semibold tabular-nums" data-testid="order-total">
                    {formatMoney(o.totalInclVatCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </Section>

          <Section title={t("payments")}>
            <dl className="mb-3 grid gap-x-6 gap-y-1 text-[13px] sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-3">
              {[
                [t("totalIncl"), formatMoney(o.totalInclVatCents)],
                [t("tradeIn"), formatMoney(o.tradeInCents)],
                [t("financed"), formatMoney(o.financedCents)],
                [t("customerPays"), formatMoney(cashDue)],
                [t("receivedFromCustomer"), formatMoney(deposits)],
                [o.invoice ? t("dueOnInvoice") : t("leftToPay"), formatMoney(due)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums" data-testid={label === t("dueOnInvoice") || label === t("leftToPay") ? "order-due" : undefined}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {o.payments.length > 0 && (
              <table className="mb-3 w-full text-[13px]">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-3 font-medium">{t("date")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("payment")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("method")}</th>
                    <th className="py-1.5 text-right font-medium">{t("amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {o.payments.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 tabular-nums">{formatDate(p.businessDate)}</td>
                      <td className="py-1.5 pr-3">
                        <Link href={`/accounting/payments/${p.id}`} className="text-primary hover:underline">
                          {p.number}
                        </Link>
                        {p.reference && <span className="ml-1.5 text-xs text-muted-foreground">{p.reference}</span>}
                      </td>
                      <td className="py-1.5 pr-3">{t(`paymentMethods.${p.method}`)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatMoney(p.direction === "OUT" ? -p.amountCents : p.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canPay && (o.status === "CONFIRMED" || o.status === "INVOICED") && due > 0 && (
              <SpecForm
                action={orderPaymentAction.bind(null, o.id)}
                submitLabel={o.invoice ? t("recordPayment") : t("recordDeposit")}
                inline
                fields={[
                  { name: "amountCents", label: t("amount"), type: "money", defaultValue: centsToInput(due), testId: "payment-amount" },
                  { name: "method", label: t("method"), type: "select", options: MONEY_METHODS.map((m) => ({ value: m, label: t(`paymentMethods.${m}`) })), defaultValue: "TRANSFER" },
                  { name: "reference", label: t("reference"), placeholder: t("optional") },
                ]}
              />
            )}
          </Section>

          {o.status === "INVOICED" && canEdit && (
            <Section title={t("delivery")}>
              {deliverGuard.ok ? (
                <SpecForm
                  action={deliverOrderAction.bind(null, o.id)}
                  submitLabel={t("deliverVehicle")}
                  inline
                  fields={[
                    { name: "mileage", label: t("mileageAtDelivery"), type: "number", defaultValue: String(v.mileage), testId: "delivery-mileage" },
                    { name: "registration", label: t("registration"), defaultValue: v.registration ?? "", placeholder: t("registrationPlaceholder"), testId: "delivery-registration" },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{deliverGuard.reason}</p>
              )}
            </Section>
          )}

          {cancelGuard.ok && can(actor.permissions, "sales.order", "delete", o.siteId) && (
            <Section title={t("cancelOrder")}>
              <p className="mb-3 text-xs text-muted-foreground">{t("cancelOrderHint")}</p>
              <SpecForm action={cancelOrderAction.bind(null, o.id)} submitLabel={t("cancelOrder")} inline fields={[{ name: "reason", label: t("reason"), placeholder: t("cancelReasonPlaceholder") }]} />
            </Section>
          )}

          <Section title={t("activity")}>
            <Timeline items={timeline} />
          </Section>
        </div>

        <div className="space-y-4">
          <Section title={t("order")}>
            <Fields
              items={[
                { label: t("customer"), value: <Link className="text-primary hover:underline" href={`/customers/${o.customerId}`}>{o.customer.displayName}</Link> },
                { label: t("lead"), value: <Link className="text-primary hover:underline" href={`/sales/leads/${o.leadId}`}>{o.lead.number}</Link> },
                { label: t("site"), value: o.site.name },
                { label: t("salesperson"), value: name(o.salesperson) },
                { label: t("orderDate"), value: formatDate(o.orderDate) },
                { label: t("expectedDelivery"), value: o.expectedDeliveryDate ? formatDate(o.expectedDeliveryDate) : null },
                { label: t("vehicle"), value: <Link className="text-primary hover:underline" href={o.stockType === "VO" ? `/sales/vo-stock/${v.id}` : `/sales/vn-stock/${v.id}`}>{vehicleLabel}</Link> },
                { label: "VIN", value: <span className="font-mono text-xs">{v.vin}</span> },
                { label: t("registration"), value: v.registration },
                { label: t("vehicleStatus"), value: <StatusBadge status={v.status} label={t(`vehicleStatuses.${v.status}`)} /> },
                ...(o.deliveryMileage !== null ? [{ label: t("mileageAtDelivery"), value: `${o.deliveryMileage.toLocaleString("en-GB")} km` }] : []),
              ]}
            />
          </Section>

          {fo && (
            <Section title={t("factoryOrder")}>
              <Fields
                items={[
                  { label: t("number"), value: fo.number },
                  { label: t("oemReference"), value: <span className="font-mono text-xs">{fo.oemReference}</span> },
                  { label: t("status"), value: <StatusBadge status={fo.status} label={t(`factoryStatuses.${fo.status}`)} /> },
                  { label: t("orderedOn"), value: formatDate(fo.orderedOn) },
                  { label: t("eta"), value: formatDate(fo.expectedOn) },
                  { label: t("shippedOn"), value: fo.shippedOn ? formatDate(fo.shippedOn) : null },
                  { label: t("arrivedOn"), value: fo.arrivedOn ? formatDate(fo.arrivedOn) : null },
                ]}
              />
            </Section>
          )}

          {o.voPurchases.length > 0 && (
            <Section title={t("tradeIn")}>
              <ul className="space-y-1.5 text-[13px]">
                {o.voPurchases.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <Link href={`/sales/vo-stock/${p.vehicle.id}`} className="text-primary hover:underline">
                      {`${p.vehicle.make} ${p.vehicle.model} ${p.vehicle.version}`.trim()}
                    </Link>
                    <span className="flex items-center gap-2">
                      {p.cancelledOn ? <StatusBadge status="CANCELLED" label={t("handedBack")} /> : <StatusBadge status={p.vehicle.status} label={t(`vehicleStatuses.${p.vehicle.status}`)} />}
                      <span className="tabular-nums">{formatMoney(p.priceCents)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={t("dealerView")}>
            <dl className="space-y-1 text-[13px]">
              {[
                [t("frontEndMargin"), formatMoney(o.frontEndMarginCents)],
                [t("backEndMargin"), formatMoney(o.backEndMarginCents)],
                ...(quote.financing ? [[t("financeCommission"), formatMoney(quote.financing.dealerCommissionCents)]] : []),
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {o.commission && (
              <div className="mt-3 border-t pt-3 text-[13px]" data-testid="order-commission">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{t("commissionFor", { name: name(o.commission.user) ?? "—" })}</span>
                  <span className="font-semibold tabular-nums">{formatMoney(o.commission.amountCents)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("commissionSplit", { front: formatMoney(o.commission.frontEndCents), addOns: formatMoney(o.commission.addOnCents), finance: formatMoney(o.commission.financeCents) })}
                </div>
              </div>
            )}
            {o.incentiveInvoices.length > 0 && (
              <div className="mt-3 border-t pt-3 text-[13px]">
                <div className="mb-1 text-xs text-muted-foreground">{t("oemClaims")}</div>
                {o.incentiveInvoices.map((inv) => (
                  <div key={inv.id} className="flex items-baseline justify-between gap-3">
                    <Link href={`/accounting/invoices/${inv.id}`} className="text-primary hover:underline">
                      {inv.number}
                    </Link>
                    <span className="tabular-nums">{formatMoney(inv.totalInclVatCents)}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
