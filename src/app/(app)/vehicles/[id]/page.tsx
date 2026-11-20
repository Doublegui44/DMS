import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Factory, Pencil } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { daysBetween, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ageingLevel, getTimeline, getVehicle } from "@/modules/core";
import { getServiceHistory } from "@/modules/workshop";
import { Fields, PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Timeline } from "@/components/shared/timeline";
import { Button } from "@/components/ui/button";

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const tv = await getTranslations("vehicle");
  const { actor } = await getRequestContext();
  const [{ v, businessDate }, timeline, service] = await Promise.all([
    query(async (ctx) => ({ v: await getVehicle(ctx, id), businessDate: ctx.businessDate })),
    query((ctx) => getTimeline(ctx, "Vehicle", id)),
    query((ctx) => getServiceHistory(ctx, id)),
  ]);
  const tw = await getTranslations("workshop");
  const canCheckIn = can(actor.permissions, "workshop.repair_order", "create");
  const canEdit = can(actor.permissions, "vehicle", "edit", v.siteId ?? undefined);
  const inStock = v.stockType !== "NONE";
  const days = inStock && v.stockInDate ? daysBetween(v.stockInDate, businessDate) : null;
  const level = days !== null ? ageingLevel(days) : null;
  // A stock car is moved, priced and sold from its sales page (D-048).
  const salesHref =
    v.stockType === "VN" && can(actor.permissions, "sales.vn_stock", "view", v.siteId ?? undefined)
      ? `/sales/vn-stock/${v.id}`
      : v.stockType === "VO" && can(actor.permissions, "sales.vo_stock", "view", v.siteId ?? undefined)
        ? `/sales/vo-stock/${v.id}`
        : null;

  return (
    <div>
      <PageHeader
        title={`${v.make} ${v.model}`}
        subtitle={v.version}
        backHref="/vehicles"
        badges={
          <>
            <StatusBadge status={v.stockType} label={tv(`stockTypes.${v.stockType}`)} />
            <StatusBadge status={v.status} label={tv(`statuses.${v.status}`)} />
            {level && level !== "ok" && <StatusBadge status={level} label={`${days} days in stock`} />}
          </>
        }
        actions={
          (salesHref || canEdit) && (
            <>
              {salesHref && (
                <Button asChild size="sm" variant="outline">
                  <Link href={salesHref}>
                    <Factory /> {tv("openInSales")}
                  </Link>
                </Button>
              )}
              {canEdit && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/vehicles/${id}/edit`}>
                    <Pencil /> {t("common.edit")}
                  </Link>
                </Button>
              )}
            </>
          )
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Section title={t("common.details")}>
            <Fields
              items={[
                { label: tv("vin"), value: <span className="font-mono text-xs">{v.vin}</span> },
                { label: tv("registration"), value: v.registration && <span className="font-mono text-xs">{v.registration}</span> },
                { label: tv("brand"), value: v.brand?.name ?? `${v.make} (non-franchise)` },
                { label: tv("fuel"), value: tv(`fuels.${v.fuel}`) },
                { label: tv("firstRegistration"), value: v.firstRegistration ? formatDate(v.firstRegistration) : null },
                { label: tv("mileage"), value: `${v.mileage.toLocaleString("en-GB")} km` },
                { label: tv("co2"), value: v.co2 },
                { label: tv("power"), value: v.powerHp },
                { label: tv("colour"), value: v.colour },
                { label: tv("site"), value: v.site?.name },
                {
                  label: tv("owner"),
                  value: v.owner && (
                    <Link href={`/customers/${v.owner.id}`} className="text-primary hover:underline">
                      {v.owner.displayName}
                    </Link>
                  ),
                },
              ]}
            />
          </Section>
          {inStock && (
            <Section title="Stock">
              <Fields
                items={[
                  { label: tv("listPrice"), value: formatMoney(v.listPriceCents) },
                  { label: tv("stockValue"), value: formatMoney(v.stockValueCents) },
                  { label: tv("stockInDate"), value: v.stockInDate ? formatDate(v.stockInDate) : null },
                  { label: tv("daysInStock"), value: days },
                  { label: tv("vatRegime"), value: tv(`vatRegimes.${v.vatRegime}`) },
                ]}
              />
            </Section>
          )}
          {service && (
            <Section
              title={tw("serviceHistory")}
              actions={
                canCheckIn && (
                  <div className="flex gap-2">
                    {v.stockType === "NONE" && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/workshop/planner/new?vehicle=${v.id}`}>{tw("book")}</Link>
                      </Button>
                    )}
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/workshop/repair-orders/new?vehicle=${v.id}${v.stockType === "VO" ? "&kind=INTERNAL" : ""}`}>{tw("checkIn")}</Link>
                    </Button>
                  </div>
                )
              }
            >
              {service.appointments.map((a) => (
                <p key={a.id} className="mb-2 text-[13px]">
                  <StatusBadge status="BOOKED" label={tw("upcoming")} /> {formatDate(a.date)} — {a.concern}
                </p>
              ))}
              {service.ros.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">{tw("noServiceHistory")}</p>
              ) : (
                <table className="w-full text-[13px]" data-testid="service-history">
                  <tbody className="divide-y">
                    {service.ros.map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{formatDate(r.openedOn)}</td>
                        <td className="py-1.5 pr-3">
                          <Link className="text-primary hover:underline" href={`/workshop/repair-orders/${r.id}`}>
                            {r.number}
                          </Link>
                          <div className="text-xs text-muted-foreground">{r.site.code}</div>
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">{r.mileageIn.toLocaleString("en-GB")} km</td>
                        <td className="py-1.5 pr-3">{r.jobs.map((j) => j.description).join(" · ")}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(r.totalExclVatCents)}</td>
                        <td className="py-1.5">
                          <StatusBadge status={r.status} label={tw(`roStatuses.${r.status}`)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          )}
          <Section title={tv("statusHistory")}>
            {inStock && <p className="text-xs text-muted-foreground">{tv("statusFollowsFlow")}</p>}
            <table className="mt-2 w-full text-[13px]">
              <tbody className="divide-y">
                {v.statusHistory.map((h) => (
                  <tr key={h.id}>
                    <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{formatDate(h.businessDate)}</td>
                    <td className="py-1.5 pr-3">
                      {h.fromStatus && (
                        <>
                          <StatusBadge status={h.fromStatus} label={tv(`statuses.${h.fromStatus}`)} />
                          <span className="mx-1.5 text-muted-foreground">→</span>
                        </>
                      )}
                      <StatusBadge status={h.toStatus} label={tv(`statuses.${h.toStatus}`)} />
                    </td>
                    <td className="py-1.5 text-muted-foreground">{h.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
        <Section title={t("common.timeline")}>
          <Timeline items={timeline} />
        </Section>
      </div>
    </div>
  );
}
