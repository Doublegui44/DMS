import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import type { SearchParams } from "@/lib/list";
import { DAMAGE_ZONES, getCheckInFormData, searchServiceVehicles } from "@/modules/workshop";
import { PageHeader, Section } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/shared/form";
import { checkInAction } from "../../actions";
import { clock, vehicleName } from "../../format";
import { CheckInForm } from "./check-in-form";

export const metadata = { title: "Check-in" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function CheckInPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("workshop");
  const internal = one(sp.kind) === "INTERNAL";
  const q = one(sp.q) ?? "";
  const form = await query((ctx) => getCheckInFormData(ctx, { appointmentId: one(sp.appointment), vehicleId: one(sp.vehicle), siteId: one(sp.site) }), {
    resource: "workshop.repair_order",
    action: "create",
  });
  const found = q ? await query((ctx) => searchServiceVehicles(ctx, q)) : [];

  if (form.vehicle) {
    const v = form.vehicle;
    const customerId = form.appointment?.customerId ?? form.owner?.id ?? null;
    const customerName = form.appointment?.customer.displayName ?? form.owner?.displayName ?? "";
    const isInternal = internal || v.stockType === "VO";
    const customers = isInternal ? null : form.customers;
    const hidden: Record<string, string> = { siteId: form.siteId, vehicleId: v.id, kind: isInternal ? "INTERNAL" : "CUSTOMER" };
    if (form.appointment) hidden.appointmentId = form.appointment.id;
    if (customerId && !isInternal) hidden.customerId = customerId;
    return (
      <div className="max-w-3xl">
        <PageHeader
          title={isInternal ? t("internalCheckIn") : t("checkIn")}
          subtitle={`${vehicleName(v)}${customerName && !isInternal ? ` — ${customerName}` : ""}${form.appointment ? ` · ${form.appointment.number}` : ""}`}
          backHref="/workshop/repair-orders/new"
        />
        <Section>
          <CheckInForm
            action={checkInAction}
            hidden={hidden}
            internal={isInternal}
            customers={customers}
            defaults={{ mileageIn: v.mileage, concern: form.appointment?.concern ?? (isInternal ? t("preSaleService") : ""), signedBy: customerName }}
            labels={{
              mileage: t("mileageIn"),
              fuel: t("fuelLevel"),
              damages: t("damages"),
              damagesHint: t("damagesHint", { zones: DAMAGE_ZONES.join(", ") }),
              concern: t("concern"),
              promisedOn: t("promisedOn"),
              notes: t("notes"),
              signedBy: t("signedBy"),
              signature: t("signature"),
              signatureHint: t("signatureHint"),
              clear: t("clear"),
              submit: t("openRo"),
              customer: t("customer"),
            }}
          />
        </Section>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title={t("checkIn")} subtitle={t("checkInHint")} backHref="/workshop/repair-orders" />
      <Section title={t("dueToday")}>
        {form.due.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t("noAppointmentsToday")}</p>
        ) : (
          <ul className="divide-y text-[13px]" data-testid="due-appointments">
            {form.due.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="mr-2 tabular-nums text-muted-foreground">{clock(d.startMinute)}</span>
                  {d.label}
                  <span className="ml-2 text-muted-foreground">— {d.concern}</span>
                </span>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/workshop/repair-orders/new?appointment=${d.id}`}>{t("checkIn")}</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t("walkIn")}>
        <form className="flex gap-2" method="get">
          <input name="q" defaultValue={q} placeholder={t("searchVehicle")} className={inputClass} data-testid="vehicle-search" />
          <Button type="submit" size="sm" variant="outline">
            {t("search")}
          </Button>
        </form>
        {q && (
          <ul className="mt-3 divide-y text-[13px]" data-testid="vehicle-results">
            {found.length === 0 && <li className="py-2 text-muted-foreground">{t("noVehicleFound")}</li>}
            {found.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {vehicleName(v)} <span className="text-muted-foreground">— {v.owner?.displayName ?? t("noOwner")}</span>
                </span>
                <span className="flex gap-2">
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/workshop/planner/new?vehicle=${v.id}`}>{t("book")}</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/workshop/repair-orders/new?vehicle=${v.id}`}>{t("checkIn")}</Link>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t("internalCheckIn")}>
        <p className="mb-3 text-xs text-muted-foreground">{t("internalHint")}</p>
        <form className="flex gap-2" method="get">
          <input type="hidden" name="kind" value="INTERNAL" />
          <select name="vehicle" className={inputClass} data-testid="internal-vehicle">
            {form.voStock.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="outline" disabled={!form.voStock.length}>
            {t("continue")}
          </Button>
        </form>
      </Section>
    </div>
  );
}
