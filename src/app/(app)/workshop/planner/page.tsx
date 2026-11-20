import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { query } from "@/lib/session";
import { formatDate } from "@/lib/dates";
import type { SearchParams } from "@/lib/list";
import { getPlanner } from "@/modules/workshop";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionButton } from "@/components/shared/action-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cancelAppointmentAction } from "../actions";
import { clock, hours } from "../format";

export const metadata = { title: "Workshop planner" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

type Appt = Awaited<ReturnType<typeof getPlanner>>["rows"][number]["days"][number]["appointments"][number];

export default async function PlannerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("workshop");
  const d = await query((ctx) => getPlanner(ctx, { siteId: one(sp.site), week: one(sp.week) }), { resource: "workshop.appointment", action: "view" });
  const href = (week: string) => `/workshop/planner?site=${d.siteId}&week=${week}`;
  const card = (a: Appt) => (
    <div key={a.id} className="space-y-0.5 rounded border bg-background p-1.5 text-[11px] leading-tight" data-testid="appointment">
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium tabular-nums">
          {clock(a.startMinute)} · {hours(a.plannedCentiHours)}
        </span>
        {a.status === "ARRIVED" ? (
          a.repairOrder ? (
            <Link className="text-primary hover:underline" href={`/workshop/repair-orders/${a.repairOrder.id}`}>
              {a.repairOrder.number}
            </Link>
          ) : (
            <StatusBadge status="ARRIVED" label={t("arrived")} />
          )
        ) : null}
      </div>
      <div className="truncate">{a.customer.displayName}</div>
      <div className="truncate text-muted-foreground">
        {a.vehicle.make} {a.vehicle.model} {a.vehicle.registration ?? ""}
      </div>
      <div className="truncate text-muted-foreground">{a.concern}</div>
      {a.status === "BOOKED" && d.canBook && (
        <div className="flex flex-wrap gap-1 pt-1">
          {a.date.toISOString().slice(0, 10) === d.today && (
            <Button asChild size="sm" variant="outline" className="h-6 px-2 text-[11px]">
              <Link href={`/workshop/repair-orders/new?appointment=${a.id}`}>{t("checkIn")}</Link>
            </Button>
          )}
          <ActionButton action={cancelAppointmentAction.bind(null, a.id, false)} label={t("cancel")} variant="ghost" confirm={t("cancelAppointmentConfirm")} />
        </div>
      )}
    </div>
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("planner")}
        subtitle={t("plannerHint")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <form method="get" className="flex items-center gap-2">
              <input type="hidden" name="week" value={d.days[0]} />
              <select name="site" defaultValue={d.siteId} className="h-8 rounded-md border bg-background px-2 text-[13px]">
                {d.sites.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" variant="outline">
                {t("show")}
              </Button>
            </form>
            <Button asChild size="sm" variant="outline">
              <Link href={href(d.previousWeek)} aria-label={t("previousWeek")}>
                <ChevronLeft />
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={href(d.today)}>{t("thisWeek")}</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={href(d.nextWeek)} aria-label={t("nextWeek")}>
                <ChevronRight />
              </Link>
            </Button>
            {d.canBook && (
              <Button asChild size="sm">
                <Link href={`/workshop/planner/new?site=${d.siteId}`}>
                  <Plus /> {t("bookAppointment")}
                </Link>
              </Button>
            )}
          </div>
        }
      />
      <Section>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed text-[13px]" data-testid="planner">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="w-40 py-1.5 pr-2 font-medium">{t("technician")}</th>
                {d.days.map((day) => (
                  <th key={day} className={cn("py-1.5 pr-2 font-medium", day === d.today && "text-foreground")}>
                    {formatDate(day)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id} className="border-b align-top last:border-0" data-technician={r.name}>
                  <td className="py-2 pr-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {hours(r.capacity)} / {t("day")}
                    </div>
                  </td>
                  {r.days.map((day) => {
                    const pct = r.capacity ? Math.round((day.booked * 100) / r.capacity) : 0;
                    return (
                      <td key={day.date} className={cn("py-2 pr-2", day.date === d.today && "bg-muted/40")}>
                        <div className="mb-1 h-1.5 overflow-hidden rounded bg-muted" title={`${hours(day.booked)} / ${hours(r.capacity)}`}>
                          <div className={cn("h-full", pct > 90 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                        <div className="space-y-1">{day.appointments.map(card)}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="align-top">
                <td className="py-2 pr-2 text-xs text-muted-foreground">{t("unassigned")}</td>
                {d.unassigned.map((day) => (
                  <td key={day.date} className="py-2 pr-2">
                    <div className="space-y-1">{day.appointments.map(card)}</div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {d.rows.length === 0 && <p className="mt-3 text-[13px] text-muted-foreground">{t("noTechnicians")}</p>}
      </Section>
    </div>
  );
}
