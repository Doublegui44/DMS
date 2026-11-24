import { formatKm } from "@/lib/format-locale";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Wrench } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getTimeline } from "@/modules/core";
import { getVoFormData, getVoVehicle } from "@/modules/sales";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { SpecForm } from "@/components/shared/spec-form";
import { Timeline } from "@/components/shared/timeline";
import { addVehicleCostAction, repriceVoAction, setForSaleAction, startReconditioningAction } from "../../actions";
import { centsToInput } from "../../quotes/draft";

const IN_STOCK = ["INTAKE", "RECONDITIONING", "FOR_SALE", "RESERVED"];

export default async function VoVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("sales");
  const { actor } = await getRequestContext();
  const [v, timeline, form] = await Promise.all([query((ctx) => getVoVehicle(ctx, id)), query((ctx) => getTimeline(ctx, "Vehicle", id)), query((ctx) => getVoFormData(ctx))]);
  const canEdit = !!v.siteId && v.stockType === "VO" && can(actor.permissions, "sales.vo_stock", "edit", v.siteId);
  const inStock = IN_STOCK.includes(v.status);
  const costs = v.costLines.reduce((s, c) => s + c.amountCents, 0);
  const purchase = v.voPurchases.find((p) => !p.cancelledOn) ?? null;
  const order = v.salesOrders.find((o) => o.status === "CONFIRMED" || o.status === "INVOICED") ?? null;
  const reservation = v.reservations[0] ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${v.make} ${v.model} ${v.version}`.trim()}
        subtitle={
          <span>
            {v.registration ?? "—"} · <span className="font-mono text-xs">{v.vin}</span>
          </span>
        }
        backHref="/sales/vo-stock"
        badges={
          <>
            <StatusBadge status={v.status} label={t(`vehicleStatuses.${v.status}`)} />
            <StatusBadge status={v.vatRegime === "MARGIN" ? "VO" : "VN"} label={t(`vatRegimes.${v.vatRegime}`)} />
            {v.ageing && inStock && <StatusBadge status={v.ageing} label={t("days", { count: v.daysInStock ?? 0 })} />}
          </>
        }
        actions={
          canEdit && (v.status === "INTAKE" || v.status === "FOR_SALE") ? (
            <ActionButton
              action={startReconditioningAction.bind(null, v.id)}
              label={v.status === "INTAKE" ? t("startReconditioning") : t("backToReconditioning")}
              variant="outline"
              icon={<Wrench />}
              successMessage={t("reconditioningStarted")}
            />
          ) : undefined
        }
      />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Section title={t("priceAndMargin")}>
            <dl className="mb-3 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
              {[
                [t("purchasePrice"), formatMoney(v.purchasePriceCents)],
                [t("costsCapitalised"), formatMoney(costs)],
                [t("stockValue"), formatMoney(v.stockValueCents)],
                [t("listPriceIncl"), formatMoney(v.listPriceCents)],
                [t("expectedMargin"), formatMoney(v.expectedMarginCents)],
                [t("inStockSince"), v.stockInDate ? formatDate(v.stockInDate) : "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {canEdit && (v.status === "INTAKE" || v.status === "RECONDITIONING") && (
              <SpecForm
                action={setForSaleAction.bind(null, v.id)}
                submitLabel={t("putOnSale")}
                inline
                fields={[{ name: "listPriceCents", label: t("askingPriceIncl"), type: "money", defaultValue: centsToInput(v.listPriceCents), testId: "vo-list-price" }]}
              />
            )}
            {canEdit && (v.status === "FOR_SALE" || v.status === "RESERVED") && (
              <SpecForm
                action={repriceVoAction.bind(null, v.id)}
                submitLabel={t("reprice")}
                inline
                fields={[
                  { name: "listPriceCents", label: t("newPriceIncl"), type: "money", defaultValue: centsToInput(v.listPriceCents) },
                  { name: "reason", label: t("reason"), placeholder: t("repriceReasonPlaceholder") },
                ]}
              />
            )}
          </Section>

          <Section title={t("costs")}>
            {v.costLines.length === 0 ? (
              <p className="mb-3 text-sm text-muted-foreground">{t("noCosts")}</p>
            ) : (
              <table className="mb-3 w-full text-[13px]">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-3 font-medium">{t("date")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("label")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("supplier")}</th>
                    <th className="py-1.5 text-right font-medium">{t("amountExcl")}</th>
                  </tr>
                </thead>
                <tbody>
                  {v.costLines.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 tabular-nums">{formatDate(c.businessDate)}</td>
                      <td className="py-1.5 pr-3">
                        {c.label} <span className="text-xs text-muted-foreground">{t(`costKinds.${c.kind}`)}</span>
                      </td>
                      <td className="py-1.5 pr-3">{c.supplier?.name ?? "—"}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatMoney(c.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canEdit && inStock && (
              <SpecForm
                action={addVehicleCostAction.bind(null, v.id)}
                submitLabel={t("addCost")}
                columns={3}
                fields={[
                  { name: "kind", label: t("costKind"), type: "select", options: ["RECONDITIONING", "TRANSPORT", "OTHER"].map((k) => ({ value: k, label: t(`costKinds.${k}`) })), defaultValue: "RECONDITIONING" },
                  { name: "label", label: t("label"), placeholder: t("costLabelPlaceholder") },
                  { name: "amountCents", label: t("amountExcl"), type: "money" },
                  { name: "supplierId", label: t("supplier"), type: "select", options: form.suppliers, empty: t("chooseSupplier") },
                  { name: "supplierReference", label: t("supplierInvoiceRef"), placeholder: t("optional") },
                ]}
              />
            )}
          </Section>

          {v.priceChanges.length > 0 && (
            <Section title={t("priceHistory")}>
              <ul className="space-y-1 text-[13px]">
                {v.priceChanges.map((c) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-3">
                    <span>
                      <span className="tabular-nums text-muted-foreground">{formatDate(c.businessDate)}</span> {c.oldPriceCents ? `${formatMoney(c.oldPriceCents)} → ` : ""}
                      <span className="font-medium">{formatMoney(c.newPriceCents)}</span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{c.reason}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={t("activity")}>
            <Timeline items={timeline} />
          </Section>
        </div>

        <div className="space-y-4">
          <Section title={t("vehicle")}>
            <Fields
              items={[
                { label: t("site"), value: v.site?.name ?? null },
                { label: t("firstRegistration"), value: v.firstRegistration ? formatDate(v.firstRegistration) : null },
                { label: t("mileage"), value: v.mileage !== null ? formatKm(v.mileage) : null },
                { label: t("fuel"), value: t(`fuels.${v.fuel}`) },
                { label: t("colour"), value: v.colour },
                { label: "CO₂", value: v.co2 !== null ? `${v.co2} g/km` : null },
              ]}
            />
          </Section>
          {purchase && (
            <Section title={t("purchase")}>
              <Fields
                items={[
                  { label: t("number"), value: purchase.number },
                  { label: t("source"), value: t(`purchaseSources.${purchase.source}`) },
                  { label: t("seller"), value: purchase.customer ? <Link className="text-primary hover:underline" href={`/customers/${purchase.customer.id}`}>{purchase.customer.displayName}</Link> : (purchase.supplier?.name ?? purchase.policeEntry?.sellerName ?? null) },
                  { label: t("date"), value: formatDate(purchase.purchaseDate) },
                  { label: t("purchasePrice"), value: formatMoney(purchase.priceCents) },
                  ...(purchase.vatCents ? [{ label: t("deductibleVat"), value: formatMoney(purchase.vatCents) }] : []),
                  ...(purchase.salesOrder ? [{ label: t("tradeInOn"), value: <Link className="text-primary hover:underline" href={`/sales/orders/${purchase.salesOrder.id}`}>{purchase.salesOrder.number}</Link> }] : []),
                  ...(purchase.policeEntry ? [{ label: t("policeRegister"), value: <Link className="text-primary hover:underline" href={`/sales/police-register?q=${encodeURIComponent(purchase.policeEntry.number)}`}>{purchase.policeEntry.number}</Link> }] : []),
                ]}
              />
            </Section>
          )}
          {(order || reservation) && (
            <Section title={t("customer")}>
              {order ? (
                <p className="text-sm">
                  {t("soldTo")}{" "}
                  <Link className="text-primary hover:underline" href={`/sales/orders/${order.id}`}>
                    {order.customer.displayName} ({order.number})
                  </Link>
                </p>
              ) : (
                reservation && <p className="text-sm">{t("reservedForUntil", { name: reservation.customer.displayName, date: formatDate(reservation.expiresOn) })}</p>
              )}
            </Section>
          )}
          <Section title={t("statusHistory")}>
            <ul className="space-y-1 text-[13px]">
              {v.statusHistory.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <StatusBadge status={h.toStatus} label={t(`vehicleStatuses.${h.toStatus}`)} />
                    <span className="truncate text-xs text-muted-foreground">{h.reason}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDate(h.businessDate)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
