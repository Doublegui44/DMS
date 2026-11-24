import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getSimulationJob, getSimulationStatus } from "@/modules/simulation";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { JobPanel } from "./job-panel";
import { RunForm } from "./run-form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("simulation");

const steps = (counts: Record<string, number>) => Object.entries(counts).reduce((t, [k, n]) => (k === "day" ? t : t + n), 0);

export default async function SimulationPage() {
  const t = await getTranslations("simulation");
  const { businessDate, sites, defaults, runs, job } = await query(async (ctx) => ({ ...(await getSimulationStatus(ctx)), job: await getSimulationJob(ctx) }), { resource: "admin.simulation", action: "view" });
  const last = runs[0];

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Section title={t("run")}>
          <div className="space-y-4 p-4">
            <JobPanel key={job?.id ?? "none"} initial={job} />
            <RunForm sites={sites.map((s) => ({ slug: s.slug, name: s.name }))} defaults={defaults} />
          </div>
        </Section>
        <Section title={t("businessDate")}>
          <div className="space-y-2 p-4">
            <p className="text-2xl font-semibold tabular-nums" data-testid="sim-business-date">
              {formatDate(businessDate)}
            </p>
            <p className="text-xs text-muted-foreground">{t("cli")}</p>
            <code className="block rounded bg-muted px-2 py-1 font-mono text-xs">npm run simulate -- --days 30 --site nantes</code>
          </div>
        </Section>
      </div>

      <Section title={t("runs")}>
        {runs.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("noRuns")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" data-testid="sim-runs">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b text-left">
                  <th className="px-4 py-1.5 font-medium">{t("at")}</th>
                  <th className="px-4 py-1.5 font-medium">{t("period")}</th>
                  <th className="px-4 py-1.5 font-medium">{t("site")}</th>
                  <th className="px-4 py-1.5 text-right font-medium">{t("daysShort")}</th>
                  <th className="px-4 py-1.5 text-right font-medium">{t("steps")}</th>
                  <th className="px-4 py-1.5 text-right font-medium">{t("refused")}</th>
                  <th className="px-4 py-1.5 font-medium">{t("books")}</th>
                  <th className="px-4 py-1.5 font-medium">{t("status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-1.5 whitespace-nowrap">{formatDateTime(r.at)}</td>
                    <td className="px-4 py-1.5 whitespace-nowrap tabular-nums">
                      {formatDate(r.from)} → {formatDate(r.to)}
                    </td>
                    <td className="px-4 py-1.5">{r.site ?? t("allSites")}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{r.days}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{steps(r.counts)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{r.skippedCount}</td>
                    <td className="px-4 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status="books" tone={r.invariants.balanced ? "green" : "red"} label={r.invariants.balanced ? t("balanced") : t("unbalanced")} />
                        <StatusBadge status="stock" tone={r.invariants.stockReconciled ? "green" : "red"} label={r.invariants.stockReconciled ? t("reconciled") : t("unreconciled")} />
                      </div>
                    </td>
                    <td className="px-4 py-1.5">
                      <StatusBadge status={r.ok ? "ok" : "critical"} label={r.ok ? t("ok") : t("failed")} />
                      {r.stopped && <StatusBadge status="stopped" tone="amber" label={t("stopped")} className="ml-1" />}
                      {r.error && <p className="mt-1 text-xs text-destructive">{r.error}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {last && (
        <Section title={t("lastRun")}>
          <div className="grid gap-6 p-4 lg:grid-cols-2">
            <ul className="grid grid-cols-1 gap-x-6 text-[13px] sm:grid-cols-2" data-testid="sim-counts">
              {Object.entries(last.counts)
                .filter(([k]) => k !== "day")
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, n]) => (
                  <li key={k} className="flex justify-between border-b py-1">
                    <span className="first-letter:uppercase">{k}</span>
                    <span className="tabular-nums">{n}</span>
                  </li>
                ))}
            </ul>
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t("refusedSteps")}</h3>
              {last.skipped.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">—</p>
              ) : (
                <ul className="space-y-1 text-[13px]">
                  {last.skipped.map((s, i) => (
                    <li key={i}>
                      <span className="tabular-nums text-muted-foreground">{formatDate(s.day)}</span> {s.site && <span className="font-mono text-xs">{s.site}</span>} {s.step}: {s.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
