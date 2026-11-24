import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import type { SearchParams } from "@/lib/list";
import { getAppointmentFormData, searchServiceVehicles } from "@/modules/workshop";
import { PageHeader, Section } from "@/components/shared/page-header";
import { SpecForm } from "@/components/shared/spec-form";
import { inputClass } from "@/components/shared/form";
import { Button } from "@/components/ui/button";
import { bookAppointmentAction } from "../../actions";
import { vehicleName } from "../../format";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("bookAnAppointment");

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("workshop");
  const q = one(sp.q) ?? "";
  const [form, today] = await Promise.all([
    query((ctx) => getAppointmentFormData(ctx, { siteId: one(sp.site), vehicleId: one(sp.vehicle) }), { resource: "workshop.appointment", action: "create" }),
    query(async (ctx) => ctx.businessDate),
  ]);
  const found = q && !form.vehicle ? await query((ctx) => searchServiceVehicles(ctx, q)) : [];
  const v = form.vehicle;
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={t("bookAppointment")} subtitle={v ? `${vehicleName(v)}${v.owner ? ` — ${v.owner.displayName}` : ""}` : t("bookHint")} backHref="/workshop/planner" />
      {!v ? (
        <Section title={t("findVehicle")}>
          <form className="flex gap-2" method="get">
            <input type="hidden" name="site" value={form.siteId} />
            <input name="q" defaultValue={q} placeholder={t("searchVehicle")} className={inputClass} data-testid="vehicle-search" />
            <Button type="submit" size="sm" variant="outline">
              {t("search")}
            </Button>
          </form>
          {q && (
            <ul className="mt-3 divide-y text-[13px]" data-testid="vehicle-results">
              {found.length === 0 && <li className="py-2 text-muted-foreground">{t("noVehicleFound")}</li>}
              {found.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    {vehicleName(x)} <span className="text-muted-foreground">— {x.owner?.displayName ?? t("noOwner")}</span>
                  </span>
                  {x.owner && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/workshop/planner/new?site=${form.siteId}&vehicle=${x.id}`}>{t("choose")}</Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : !v.owner ? (
        <Section>
          <p className="text-[13px] text-muted-foreground">{t("noOwnerHint")}</p>
        </Section>
      ) : (
        <Section>
          <SpecForm
            action={bookAppointmentAction}
            submitLabel={t("book")}
            cancelHref="/workshop/planner"
            fields={[
              { name: "vehicleId", label: "", type: "hidden", defaultValue: v.id },
              { name: "customerId", label: "", type: "hidden", defaultValue: v.owner.id },
              { name: "siteId", label: t("site"), type: "select", options: form.sites, defaultValue: form.siteId },
              { name: "technicianId", label: t("technician"), type: "select", options: form.technicians, empty: t("unassigned"), testId: "appt-technician" },
              { name: "date", label: t("date"), type: "date", defaultValue: isoDate(today), testId: "appt-date" },
              { name: "startMinute", label: t("startTime"), defaultValue: "08:30", testId: "appt-time" },
              { name: "plannedCentiHours", label: t("plannedHours"), defaultValue: "1", testId: "appt-hours" },
              { name: "bayId", label: t("bay"), type: "select", options: form.bays, empty: "—" },
              { name: "concern", label: t("concern"), type: "textarea", wide: true, testId: "appt-concern" },
            ]}
          />
        </Section>
      )}
    </div>
  );
}
