import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, Pencil, Undo2 } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatBp, formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getTimeline } from "@/modules/core";
import { getQuote } from "@/modules/sales";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { SpecForm } from "@/components/shared/spec-form";
import { Timeline } from "@/components/shared/timeline";
import { Button } from "@/components/ui/button";
import {
  acceptQuoteAction,
  decideApprovalAction,
  declineQuoteAction,
  releaseReservationAction,
  reserveQuoteVehicleAction,
  reviseQuoteAction,
  submitQuoteAction,
} from "../../actions";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("sales");
  const { actor } = await getRequestContext();
  const [q, timeline] = await Promise.all([query((ctx) => getQuote(ctx, id)), query((ctx) => getTimeline(ctx, "Quote", id))]);
  const canEdit = can(actor.permissions, "sales.quote", "edit", q.siteId);
  const canValidate = can(actor.permissions, "sales.quote", "validate", q.siteId);
  const canOrder = can(actor.permissions, "sales.order", "create", q.siteId);
  const pending = q.approvals.find((a) => a.status === "PENDING");
  const reservation = q.reservations[0] ?? null;
  const open = q.status === "DRAFT" || q.status === "PENDING_APPROVAL" || q.status === "SENT";
  const vehicle = q.vehicle
    ? `${q.vehicle.make} ${q.vehicle.model} ${q.vehicle.version}`
    : q.catalogueVersion
      ? `${q.catalogueVersion.model.brand.name} ${q.catalogueVersion.model.name} ${q.catalogueVersion.name}`
      : "—";
  const name = (u: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}` : null);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t("quote")} ${q.number}`}
        subtitle={`${q.customer.displayName} · ${vehicle}`}
        backHref={`/sales/leads/${q.leadId}`}
        badges={
          <>
            <StatusBadge status={q.status} label={t(`quoteStatuses.${q.status}`)} />
            <StatusBadge status={q.stockType} />
            {reservation && <StatusBadge status="RESERVED" label={t("reservedUntil", { date: formatDate(reservation.expiresOn) })} />}
          </>
        }
        actions={
          <>
            {q.status === "DRAFT" && canEdit && (
              <>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/sales/quotes/${q.id}/edit`}>
                    <Pencil /> {t("edit")}
                  </Link>
                </Button>
                <ActionButton action={submitQuoteAction.bind(null, q.id)} label={t("sendQuote")} successMessage={t("quoteSubmitted")} />
              </>
            )}
            {(q.status === "SENT" || q.status === "PENDING_APPROVAL" || q.status === "EXPIRED") && canEdit && (
              <ActionButton
                action={reviseQuoteAction.bind(null, q.id)}
                label={q.status === "PENDING_APPROVAL" ? t("withdraw") : t("revise")}
                variant="outline"
                icon={<Undo2 />}
                confirm={t("reviseConfirm")}
              />
            )}
            {open && q.vehicleId && canEdit && !reservation && <ActionButton action={reserveQuoteVehicleAction.bind(null, q.id)} label={t("reserveVehicle")} variant="outline" successMessage={t("vehicleReserved")} />}
            {reservation && canEdit && open && <ActionButton action={releaseReservationAction.bind(null, q.id, reservation.id)} label={t("releaseReservation")} variant="ghost" />}
            {q.status === "SENT" && canEdit && <ActionButton action={declineQuoteAction.bind(null, q.id)} label={t("customerDeclines")} variant="ghost" confirm={t("declineConfirm")} />}
            {q.status === "SENT" && canOrder && (
              <ActionButton action={acceptQuoteAction.bind(null, q.id)} label={t("customerAccepts")} icon={<CheckCircle2 />} confirm={t("acceptConfirm")} successMessage={t("orderCreated")} />
            )}
            {q.salesOrder && (
              <Button asChild size="sm">
                <Link href={`/sales/orders/${q.salesOrder.id}`}>{t("openOrder", { number: q.salesOrder.number })}</Link>
              </Button>
            )}
          </>
        }
      />

      {pending && (
        <Section title={t("approvalRequired")}>
          <p className="mb-3 text-sm">
            {t("approvalRequest", {
              discount: formatBp(q.discountBp),
              role: pending.rule.approverRole.name,
              by: name(pending.requestedBy) ?? "—",
              date: formatDate(pending.businessDate),
            })}
          </p>
          {canValidate && pending.requestedById !== actor.userId ? (
            <div className="flex flex-wrap gap-6">
              <SpecForm action={decideApprovalAction.bind(null, q.id, "APPROVE")} submitLabel={t("approve")} inline fields={[{ name: "comment", label: t("comment"), placeholder: t("optional") }]} />
              <SpecForm action={decideApprovalAction.bind(null, q.id, "REJECT")} submitLabel={t("reject")} inline fields={[{ name: "comment", label: t("rejectReason"), placeholder: t("optional") }]} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{pending.requestedById === actor.userId ? t("waitingForApprover") : t("approverOnly", { role: pending.rule.approverRole.name })}</p>
          )}
        </Section>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Section title={t("dealLines")}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" data-testid="quote-lines">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-3 font-medium">{t("label")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("qty")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("exclVatShort")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("vat")}</th>
                    <th className="py-1.5 text-right font-medium">{t("inclVatShort")}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.lines.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">
                        {l.label}
                        {l.vatMode !== "STANDARD" && <span className="ml-1.5 text-[11px] text-muted-foreground">{t(`vatModes.${l.vatMode}`)}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{l.quantity}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.lineExclVatCents)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(l.vatCents)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatMoney(l.lineInclVatCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-[13px]">
                  <tr className="border-t">
                    <td className="pt-2 font-medium" colSpan={2}>
                      {t("total")}
                    </td>
                    <td className="pt-2 pr-3 text-right tabular-nums">{formatMoney(q.totalExclVatCents)}</td>
                    <td className="pt-2 pr-3 text-right tabular-nums">{formatMoney(q.vatCents)}</td>
                    <td className="pt-2 text-right font-semibold tabular-nums" data-testid="quote-total">
                      {formatMoney(q.totalInclVatCents)}
                    </td>
                  </tr>
                  {q.tradeInCents > 0 && (
                    <tr>
                      <td colSpan={4} className="pt-1 text-right text-muted-foreground">
                        {t("tradeInDeducted")}
                      </td>
                      <td className="pt-1 text-right tabular-nums">− {formatMoney(q.tradeInCents)}</td>
                    </tr>
                  )}
                  {q.financedCents > 0 && (
                    <tr>
                      <td colSpan={4} className="pt-1 text-right text-muted-foreground">
                        {t("financedBy", { lender: q.financing?.lender ?? "" })}
                      </td>
                      <td className="pt-1 text-right tabular-nums">− {formatMoney(q.financedCents)}</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={4} className="pt-1 text-right font-medium">
                      {t("balanceDue")}
                    </td>
                    <td className="pt-1 text-right font-semibold tabular-nums">{formatMoney(q.balanceDueCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Section>

          {q.tradeIn && (
            <Section title={t("tradeIn")}>
              <Fields
                items={[
                  { label: t("vehicle"), value: `${q.tradeIn.make} ${q.tradeIn.model} ${q.tradeIn.version}`.trim() },
                  { label: "VIN", value: <span className="font-mono text-xs">{q.tradeIn.vin}</span> },
                  { label: t("registration"), value: q.tradeIn.registration },
                  { label: t("firstRegistration"), value: q.tradeIn.firstRegistration ? formatDate(q.tradeIn.firstRegistration) : null },
                  { label: t("mileage"), value: `${q.tradeIn.mileage.toLocaleString("en-GB")} km` },
                  { label: t("fuel"), value: t(`fuels.${q.tradeIn.fuel}`) },
                  { label: t("marketValue"), value: formatMoney(q.tradeIn.marketValueCents) },
                  { label: t("estimatedRepair"), value: formatMoney(q.tradeIn.estimatedRepairCents) },
                  { label: t("tradeInOffer"), value: <span className="font-medium">{formatMoney(q.tradeIn.offerCents)}</span> },
                  ...(q.tradeIn.vehicle && q.tradeIn.vehicle.status !== "CUSTOMER" ? [{ label: t("voRecord"), value: <Link className="text-primary hover:underline" href={`/sales/vo-stock/${q.tradeIn.vehicle.id}`}>{t(`vehicleStatuses.${q.tradeIn.vehicle.status}`)}</Link> }] : []),
                ]}
              />
            </Section>
          )}

          {q.financing && (
            <Section title={t("financing")}>
              <Fields
                items={[
                  { label: t("financingKind"), value: t(`financingKinds.${q.financing.kind}`) },
                  { label: t("lender"), value: q.financing.lender },
                  { label: t("amountFinanced"), value: formatMoney(q.financing.principalCents) },
                  { label: t("customerContribution"), value: formatMoney(q.financing.depositCents) },
                  { label: t("months"), value: q.financing.months },
                  { label: t("aprPct"), value: formatBp(q.financing.aprBp) },
                  { label: t("monthlyPaymentLabel"), value: <span className="font-medium">{formatMoney(q.financing.monthlyPaymentCents)}</span> },
                  ...(q.financing.residualCents ? [{ label: t("residualValue"), value: formatMoney(q.financing.residualCents) }] : []),
                  { label: t("costOfCredit"), value: formatMoney(q.financing.totalCostCents) },
                  { label: t("totalPayable"), value: formatMoney(q.financing.totalPayableCents) },
                  { label: t("dealerCommission"), value: formatMoney(q.financing.dealerCommissionCents) },
                ]}
              />
            </Section>
          )}

          <Section title={t("activity")}>
            <Timeline items={timeline} />
          </Section>
        </div>

        <div className="space-y-4">
          <Section title={t("quote")}>
            <Fields
              items={[
                { label: t("customer"), value: <Link className="text-primary hover:underline" href={`/customers/${q.customerId}`}>{q.customer.displayName}</Link> },
                { label: t("lead"), value: <Link className="text-primary hover:underline" href={`/sales/leads/${q.leadId}`}>{q.lead.number}</Link> },
                { label: t("site"), value: q.site.name },
                { label: t("salesperson"), value: name(q.salesperson) },
                { label: t("createdOn"), value: formatDate(q.createdOn) },
                { label: t("sentOn"), value: q.sentOn ? formatDate(q.sentOn) : null },
                { label: t("validUntil"), value: formatDate(q.validUntil) },
                { label: t("vatRegime"), value: t(`vatRegimes.${q.vatRegime}`) },
                ...(q.vehicle ? [{ label: "VIN", value: <span className="font-mono text-xs">{q.vehicle.vin}</span> }] : []),
                ...(q.colour ? [{ label: t("colour"), value: q.colour }] : []),
              ]}
            />
            {q.notes && <p className="mt-3 whitespace-pre-line border-t pt-3 text-sm">{q.notes}</p>}
          </Section>
          <Section title={t("dealerView")}>
            <dl className="space-y-1 text-[13px]">
              {[
                [t("listPrice"), formatMoney(q.listPriceInclVatCents)],
                [t("discountInclVat"), formatMoney(q.discountInclVatCents)],
                [t("effectiveDiscount"), formatBp(q.discountBp)],
                [t("frontEndMargin"), formatMoney(q.frontEndMarginCents)],
                [t("backEndMargin"), formatMoney(q.backEndMarginCents)],
                [t("commission"), formatMoney(q.commissionCents)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </Section>
          {q.approvals.length > 0 && (
            <Section title={t("approvals")}>
              <ul className="space-y-2 text-[13px]">
                {q.approvals.map((a) => (
                  <li key={a.id} className="space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span>{a.rule.approverRole.name}</span>
                      <StatusBadge status={a.status} label={t(`approvalStatuses.${a.status}`)} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("requestedBy", { name: name(a.requestedBy) ?? "—", date: formatDate(a.businessDate) })}
                      {a.decidedBy && ` · ${t("decidedBy", { name: name(a.decidedBy) ?? "—" })}`}
                    </div>
                    {a.comment && <div className="text-xs">{a.comment}</div>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
