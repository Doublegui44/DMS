import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { formatBp, formatMoney } from "@/lib/money";
import { AGEING_BUCKETS } from "@/modules/accounting";
import type { RoleDashboard } from "@/modules/reports";
import { Section } from "@/components/shared/page-header";
import { MonthlyBars, type Series } from "@/components/charts/monthly-bars";

const DEPARTMENT_COLOR: Record<string, string> = { VN: "var(--chart-1)", VO: "var(--chart-2)", WORKSHOP: "var(--chart-3)", PARTS: "var(--chart-4)" };
const money = (c: number) => formatMoney(c, { decimals: false });
const hours = (ch: number) => `${(ch / 100).toFixed(1)} h`;

function Stat({ label, value, sub, testId, cents }: { label: string; value: string; sub?: string; testId?: string; cents?: number }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums" data-testid={testId} data-cents={cents}>
        {value}
      </div>
      {sub && <div className="text-xs tabular-nums text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ReportLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
      {label}
      <ArrowRight className="size-3" />
    </Link>
  );
}

export async function RoleWidgets({ d }: { d: RoleDashboard }) {
  const t = await getTranslations("dashboard");
  const tr = await getTranslations("reports");
  const deps = d.layout.departments;
  const depSeries: Series[] = deps.map((k) => ({ key: k, label: tr(`departments.${k}`), color: DEPARTMENT_COLOR[k] }));

  return (
    <div className="space-y-4" data-testid="role-dashboard">
      {d.unitsSold && (
        <Section
          title={d.unitsSold.mine ? t("unitsSoldMine") : t("unitsSold")}
          actions={<span className="text-xs text-muted-foreground">{t("unitsHint")}</span>}
        >
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="grid grid-cols-2 content-start gap-3" data-testid="widget-units">
              <Stat label={`${t("thisMonth")} · VN`} value={String(d.unitsSold.month.VN.units)} sub={`${t("frontEnd")} ${money(d.unitsSold.month.VN.frontEndCents)}`} testId="units-month-VN" />
              <Stat label={`${t("thisMonth")} · VO`} value={String(d.unitsSold.month.VO.units)} sub={`${t("frontEnd")} ${money(d.unitsSold.month.VO.frontEndCents)}`} testId="units-month-VO" />
              <Stat label={`${t("yearToDate")} · VN`} value={String(d.unitsSold.year.VN.units)} sub={`${t("backEnd")} ${money(d.unitsSold.year.VN.backEndCents)}`} testId="units-year-VN" />
              <Stat label={`${t("yearToDate")} · VO`} value={String(d.unitsSold.year.VO.units)} sub={`${t("backEnd")} ${money(d.unitsSold.year.VO.backEndCents)}`} testId="units-year-VO" />
            </div>
            <MonthlyBars
              testId="chart-units"
              data={d.unitsSold.byMonth}
              series={[
                { key: "VN", label: tr("departments.VN"), color: DEPARTMENT_COLOR.VN },
                { key: "VO", label: tr("departments.VO"), color: DEPARTMENT_COLOR.VO },
              ]}
            />
          </div>
        </Section>
      )}

      {d.grossMargin && (
        <Section title={t("grossMargin")} actions={<ReportLink href="/accounting/reports/pnl" label={t("openReport")} />}>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" data-testid="widget-margin">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-3 font-medium">{t("department")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("thisMonth")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("marginPct")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("yearToDate")}</th>
                    <th className="py-1.5 text-right font-medium">{t("marginPct")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.grossMargin.month.map((m, i) => {
                    const y = d.grossMargin!.year[i];
                    return (
                      <tr key={m.department} className="border-b last:border-0" data-dep={m.department}>
                        <td className="py-1.5 pr-3">
                          <span className="mr-2 inline-block size-2 rounded-full" style={{ background: DEPARTMENT_COLOR[m.department] }} />
                          {tr(`departments.${m.department}`)}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums" data-period="month" data-cents={m.grossMarginCents}>
                          {money(m.grossMarginCents)}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{formatBp(m.grossMarginBp, 1)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums" data-period="year" data-cents={y.grossMarginCents}>
                          {money(y.grossMarginCents)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">{formatBp(y.grossMarginBp, 1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">{t("grossMarginHint")}</p>
            </div>
            {d.marginTrend && <MonthlyBars testId="chart-margin" data={d.marginTrend} series={depSeries} money />}
          </div>
        </Section>
      )}

      {d.stockAgeing && (
        <Section
          title={t("stockAgeing")}
          actions={<span className="text-xs text-muted-foreground">{t("stockAgeingHint", { a: d.stockAgeing.thresholds[0], b: d.stockAgeing.thresholds[1], c: d.stockAgeing.thresholds[2] })}</span>}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" data-testid="widget-ageing">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-3 font-medium" />
                  {(["ok", "watch", "warning", "critical"] as const).map((b) => (
                    <th key={b} className="py-1.5 pr-3 text-right font-medium">
                      {t(`bands.${b}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["VN", "VO"] as const).map((k) => (
                  <tr key={k} className="border-b last:border-0" data-kind={k}>
                    <td className="py-1.5 pr-3">{tr(`departments.${k}`)}</td>
                    {(["ok", "watch", "warning", "critical"] as const).map((b) => {
                      const c = d.stockAgeing![k][b];
                      return (
                        <td key={b} className={`py-1.5 pr-3 text-right tabular-nums ${b === "critical" && c.count ? "font-semibold text-amber-700 dark:text-amber-400" : ""}`} data-band={b} data-count={c.count}>
                          {c.count} <span className="text-xs font-normal text-muted-foreground">· {money(c.valueCents)}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {d.workshopProductivity && (
        <Section
          title={d.workshopProductivity.mine ? t("productivityMine") : t("productivity")}
          actions={<span className="text-xs text-muted-foreground">{t("productivityHint")}</span>}
        >
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="grid grid-cols-2 content-start gap-3">
              <Stat label={t("productivityLabel")} value={formatBp(d.workshopProductivity.productivityBp, 1)} sub={`${hours(d.workshopProductivity.clockedCentiHours)} / ${hours(d.workshopProductivity.availableCentiHours)}`} testId="productivity" />
              <Stat label={t("efficiencyLabel")} value={formatBp(d.workshopProductivity.efficiencyBp, 1)} sub={`${hours(d.workshopProductivity.billedCentiHours)} / ${hours(d.workshopProductivity.clockedCentiHours)}`} testId="efficiency" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" data-testid="widget-productivity">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-3 font-medium">{t("technician")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("available")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("clocked")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("billed")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("productivityLabel")}</th>
                    <th className="py-1.5 text-right font-medium">{t("efficiencyLabel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.workshopProductivity.technicians.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">{r.siteCode}</span>
                        {r.name}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{hours(r.availableCentiHours)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{hours(r.clockedCentiHours)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{hours(r.billedCentiHours)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatBp(r.productivityBp, 1)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatBp(r.efficiencyBp, 1)}</td>
                    </tr>
                  ))}
                  {d.workshopProductivity.technicians.length === 0 && (
                    <tr>
                      <td className="py-1.5 text-muted-foreground">{t("none")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Section>
      )}

      {d.partsTurnover && (
        <Section title={t("partsTurnover")} actions={<span className="text-xs text-muted-foreground">{t("partsTurnoverHint", { days: d.partsTurnover.days })}</span>}>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="grid grid-cols-2 content-start gap-3">
              <Stat label={t("turns")} value={d.partsTurnover.turnover ? (d.partsTurnover.turnover.turnsX100 / 100).toFixed(1) : "—"} testId="parts-turns" />
              <Stat label={t("daysCover")} value={d.partsTurnover.turnover ? String(d.partsTurnover.turnover.daysOfStock) : "—"} sub={`${t("stockHeld")} ${money(d.partsTurnover.stockValueCents)}`} testId="parts-cover" cents={d.partsTurnover.stockValueCents} />
            </div>
            <table className="w-full text-[13px]" data-testid="widget-turnover">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-3 font-medium">{t("site")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("used")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("stockHeld")}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t("turns")}</th>
                  <th className="py-1.5 text-right font-medium">{t("daysCover")}</th>
                </tr>
              </thead>
              <tbody>
                {d.partsTurnover.bySite.map((s) => (
                  <tr key={s.siteId} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">{s.site!.name}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(s.costOfUseCents)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(s.stockValueCents)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{s.turnover ? (s.turnover.turnsX100 / 100).toFixed(1) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.turnover?.daysOfStock ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {(d.receivables || d.payables) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {(
            [
              ["receivables", d.receivables, t("receivablesAgeing")],
              ["payables", d.payables, t("payablesAgeing")],
            ] as const
          ).map(([key, totals, title]) =>
            totals ? (
              <Section key={key} title={title} actions={<ReportLink href={`/accounting/reports/ageing?type=${key}`} label={t("openReport")} />}>
                <table className="w-full text-[13px]" data-testid={`widget-${key}`}>
                  <tbody>
                    {AGEING_BUCKETS.map((b) => (
                      <tr key={b} className="border-b">
                        <td className="py-1.5 pr-3">{tr(`buckets.${b}`)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{money(totals[b])}</td>
                        <td className="w-2/5 py-1.5">
                          <div className="h-1.5 rounded-full bg-muted">
                            <div
                              className={`h-1.5 rounded-full ${b === "current" ? "bg-[var(--chart-1)]" : b === "d90plus" ? "bg-[var(--chart-2)]" : "bg-[var(--chart-1)] opacity-60"}`}
                              style={{ width: `${totals.totalCents > 0 ? Math.max(0, Math.round((totals[b] * 100) / totals.totalCents)) : 0}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b">
                      <td className="py-1.5 pr-3 text-muted-foreground">{tr("unapplied")}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{money(totals.unappliedCents)}</td>
                      <td />
                    </tr>
                    <tr className="font-semibold">
                      <td className="py-1.5 pr-3">{tr("balance")}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums" data-testid={`${key}-balance`} data-cents={totals.balanceCents}>
                        {money(totals.balanceCents)}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </Section>
            ) : null,
          )}
        </div>
      )}

      {d.vat && (
        <Section title={t("vatTitle")} actions={<ReportLink href="/accounting/reports/vat" label={t("openReport")} />}>
          <div className="grid gap-3 sm:grid-cols-2" data-testid="widget-vat">
            {d.vat.map((v) => {
              const period = `${v.year}-${String(v.month).padStart(2, "0")}`;
              return (
                <Link key={period} href={`/accounting/reports/vat?period=${period}`} className="rounded-lg border bg-card px-4 py-3 hover:border-primary/50">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{period}</span>
                    <span>{v.periodStatus === "LOCKED" ? tr("periodLocked") : tr("periodOpen")}</span>
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums" data-cents={v.netDueCents}>
                    {money(Math.abs(v.netDueCents))} <span className="text-xs font-normal text-muted-foreground">{v.netDueCents >= 0 ? t("vatNet") : t("vatCreditShort")}</span>
                  </div>
                  <div className="text-xs tabular-nums text-muted-foreground">
                    {tr("collected")} {money(v.collectedCents)} · {tr("deductible")} {money(v.deductibleCents)}
                  </div>
                </Link>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
