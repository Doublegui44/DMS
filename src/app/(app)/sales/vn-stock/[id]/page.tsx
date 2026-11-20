import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Truck } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getTimeline } from "@/modules/core";
import { getVnVehicle } from "@/modules/sales";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { SpecForm } from "@/components/shared/spec-form";
import { Timeline } from "@/components/shared/timeline";
import { receiveVehicleAction, shipFactoryOrderAction } from "../../actions";
import { centsToInput } from "../../quotes/draft";

export default async function VnVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("sales");
  const { actor } = await getRequestContext();
  const [v, timeline] = await Promise.all([query((ctx) => getVnVehicle(ctx, id)), query((ctx) => getTimeline(ctx, "Vehicle", id))]);
  const fo = v.factoryOrder;
  const canEdit = !!v.siteId && can(actor.permissions, "sales.vn_stock", "edit", v.siteId);
  const awaiting = !v.stockInDate && ["ORDERED", "IN_TRANSIT", "RESERVED"].includes(v.status);
  const order = v.salesOrders.find((o) => o.status === "CONFIRMED" || o.status === "INVOICED") ?? null;
  const reservation = v.reservations[0] ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${v.make} ${v.model} ${v.version}`}
        subtitle={<span className="font-mono text-xs">{v.vin}</span>}
        backHref="/sales/vn-stock"
        badges={
          <>
            <StatusBadge status={v.status} label={t(`vehicleStatuses.${v.status}`)} />
            {v.ageing && <StatusBadge status={v.ageing} label={t("days", { count: v.daysInStock ?? 0 })} />}
          </>
        }
        actions={
          fo && fo.status === "ORDERED" && canEdit ? (
            <ActionButton action={shipFactoryOrderAction.bind(null, v.id, fo.id)} label={t("markShipped")} variant="outline" icon={<Truck />} successMessage={t("factoryOrderShipped")} />
          ) : undefined
        }
      />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {awaiting && canEdit && (
            <Section title={t("receiveVehicle")}>
              <p className="mb-3 text-xs text-muted-foreground">{t("receiveHint")}</p>
              <SpecForm
                action={receiveVehicleAction.bind(null, v.id)}
                submitLabel={t("receiveInStock")}
                inline
                fields={[{ name: "costCents", label: t("oemInvoiceAmount"), type: "money", defaultValue: centsToInput(v.stockValueCents), testId: "receive-cost" }]}
              />
            </Section>
          )}
          <Section title={t("vehicle")}>
            <Fields
              items={[
                { label: t("brand"), value: v.brand?.name ?? v.make },
                { label: t("colour"), value: v.colour },
                { label: t("fuel"), value: t(`fuels.${v.fuel}`) },
                { label: "CO₂", value: v.co2 !== null ? `${v.co2} g/km` : null },
                { label: t("power"), value: v.powerHp !== null ? `${v.powerHp} hp` : null },
                { label: t("site"), value: v.site?.name ?? null },
                { label: t("listPriceIncl"), value: formatMoney(v.listPriceCents) },
                { label: v.stockInDate ? t("stockValue") : t("expectedCost"), value: formatMoney(v.stockValueCents) },
                { label: t("inStockSince"), value: v.stockInDate ? formatDate(v.stockInDate) : null },
                { label: t("registration"), value: v.registration },
              ]}
            />
            {v.options.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5 border-t pt-3 text-xs">
                {v.options.map((o) => (
                  <li key={o.id} className="rounded border px-1.5 py-0.5">
                    {o.label}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title={t("activity")}>
            <Timeline items={timeline} />
          </Section>
        </div>
        <div className="space-y-4">
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
                  { label: t("orderedFor"), value: fo.salesOrder ? <Link className="text-primary hover:underline" href={`/sales/orders/${fo.salesOrder.id}`}>{fo.salesOrder.number}</Link> : t("forStock") },
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
                reservation && (
                  <p className="text-sm">
                    {t("reservedForUntil", { name: reservation.customer.displayName, date: formatDate(reservation.expiresOn) })}
                  </p>
                )
              )}
            </Section>
          )}
          <Section title={t("statusHistory")}>
            <ul className="space-y-1 text-[13px]">
              {v.statusHistory.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
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
