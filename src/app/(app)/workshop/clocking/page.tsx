import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import type { SearchParams } from "@/lib/list";
import { getClockingBoard } from "@/modules/workshop";
import { PageHeader, Section } from "@/components/shared/page-header";
import { SpecForm } from "@/components/shared/spec-form";
import { StatusBadge } from "@/components/shared/status-badge";
import { clockOffAction, clockOnAction } from "../actions";
import { clock, hours, nowHhmm } from "../format";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("clocking");

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function ClockingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("workshop");
  const d = await query((ctx) => getClockingBoard(ctx, { siteId: one(sp.site) }), { resource: "workshop.clocking", action: "view" });
  const now = nowHhmm();
  return (
    <div className="space-y-4">
      <PageHeader title={t("clocking")} subtitle={t("clockingHint")} />
      {d.technicians.length === 0 && (
        <Section>
          <p className="text-[13px] text-muted-foreground">{t("noTechnicians")}</p>
        </Section>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {d.technicians.map((tech) => (
          <Section
            key={tech.id}
            title={
              <span className="flex items-center gap-2" data-testid="technician-card" data-technician={tech.name}>
                {tech.name}
                {tech.open ? <StatusBadge status="IN_PROGRESS" label={t("onJob")} /> : <StatusBadge status="NOT_REQUIRED" label={t("idle")} />}
              </span>
            }
          >
            <p className="mb-2 text-xs text-muted-foreground">
              {t("clockedToday")}: {hours(tech.clockedToday)}
            </p>
            {tech.open && (
              <p className="mb-3 text-[13px]">
                {t("since", { time: clock(tech.open.startMinute) })} —{" "}
                <Link className="text-primary hover:underline" href={`/workshop/repair-orders/${tech.open.ro.id}`}>
                  {tech.open.ro.number}
                </Link>{" "}
                · {tech.open.job.lineNo}. {tech.open.job.description}
              </p>
            )}
            {tech.canClock && (
              <div className="space-y-3">
                {tech.open && (
                  <div data-testid="clock-off">
                    <SpecForm
                      action={clockOffAction}
                      submitLabel={t("clockOff")}
                      inline
                      fields={[
                        { name: "technicianId", label: "", type: "hidden", defaultValue: tech.id },
                        { name: "time", label: t("time"), defaultValue: now },
                        { name: "jobDone", label: t("jobDone"), type: "checkboxes", options: [{ value: "on", label: t("jobFinished") }] },
                      ]}
                    />
                  </div>
                )}
                {d.jobs.length > 0 && (
                  <div data-testid="clock-on">
                    <SpecForm
                      action={clockOnAction}
                      submitLabel={tech.open ? t("switchJob") : t("clockOn")}
                      inline
                      fields={[
                        { name: "technicianId", label: "", type: "hidden", defaultValue: tech.id },
                        { name: "jobId", label: t("job"), type: "select", options: d.jobs, empty: "—" },
                        { name: "time", label: t("time"), defaultValue: now },
                      ]}
                    />
                  </div>
                )}
              </div>
            )}
            {tech.clockings.length > 0 && (
              <table className="mt-3 w-full text-[12px]">
                <tbody>
                  {tech.clockings.map((c) => (
                    <tr key={c.id} className="border-t">
                      <td className="py-1 pr-2 tabular-nums">
                        {clock(c.startMinute)} – {c.endMinute === null ? "…" : clock(c.endMinute)}
                      </td>
                      <td className="py-1 pr-2">
                        <Link className="text-primary hover:underline" href={`/workshop/repair-orders/${c.ro.id}`}>
                          {c.ro.number}
                        </Link>{" "}
                        · {c.job.lineNo}. {c.job.description}
                      </td>
                      <td className="py-1 text-right tabular-nums">{hours(c.centiHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        ))}
      </div>
    </div>
  );
}
