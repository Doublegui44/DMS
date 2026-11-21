import Link from "next/link";
import { Fragment } from "react";
import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { formatBp, formatMoney } from "@/lib/money";
import { getProfitAndLoss, type DepartmentColumn, type PnlFigures, type PnlSection } from "@/modules/accounting";
import { PageHeader, Section } from "@/components/shared/page-header";
import { ReportFilters } from "../filters";
import { rangeFrom } from "../params";

export const metadata = { title: "P&L by department" };

const SECTIONS: PnlSection[] = ["REVENUE", "COST_OF_SALES", "EXPENSES", "OTHER_INCOME"];

export default async function PnlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const t = await getTranslations("reports");
  const { sites } = await getRequestContext();
  const today = await query(async (ctx) => ctx.businessDate, { resource: "accounting.report", action: "view" });
  const r = rangeFrom(sp, today);
  const pnl = await query((ctx) => getProfitAndLoss(ctx, r.range));
  const cols = pnl.columns;
  const money = (c: number) => (c ? formatMoney(c, { decimals: false }) : "—");
  const figureRow = (label: string, pick: (f: PnlFigures) => number, opts: { pct?: boolean; strong?: boolean; testId?: string } = {}) => (
    <tr className={`border-b ${opts.strong ? "bg-muted/40 font-semibold" : ""}`} data-testid={opts.testId}>
      <td className="py-1.5 pr-3" colSpan={2}>
        {label}
      </td>
      {cols.map((c) => (
        <td key={c} className="py-1.5 pr-3 text-right tabular-nums" data-dep={c} data-cents={pick(pnl.byDepartment[c])}>
          {opts.pct ? formatBp(pick(pnl.byDepartment[c]), 1) : money(pick(pnl.byDepartment[c]))}
        </td>
      ))}
      <td className="py-1.5 text-right tabular-nums" data-dep="TOTAL" data-cents={pick(pnl.total)}>
        {opts.pct ? formatBp(pick(pnl.total), 1) : money(pick(pnl.total))}
      </td>
    </tr>
  );
  const sectionTotal: Record<PnlSection, (f: PnlFigures) => number> = {
    REVENUE: (f) => f.revenueCents,
    COST_OF_SALES: (f) => f.costOfSalesCents,
    EXPENSES: (f) => f.expensesCents,
    OTHER_INCOME: (f) => f.otherIncomeCents,
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t("pnl")} subtitle={t("pnlHint")} backHref="/accounting/reports" />
      <ReportFilters
        fields={[
          { name: "from", label: t("from"), type: "date", value: r.from, testId: "pnl-from" },
          { name: "to", label: t("to"), type: "date", value: r.to, testId: "pnl-to" },
          { name: "site", label: t("site"), type: "select", value: r.site, options: [{ value: "", label: t("allSites") }, ...sites.map((s) => ({ value: s.id, label: s.name }))] },
        ]}
      />
      <Section>
        {pnl.lines.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t("noMovement")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]" data-testid="pnl-table">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-3 font-medium">{t("account")}</th>
                  <th className="py-1.5 pr-3 font-medium" />
                  {cols.map((c) => (
                    <th key={c} className="py-1.5 pr-3 text-right font-medium">
                      {t(`departments.${c as DepartmentColumn}`)}
                    </th>
                  ))}
                  <th className="py-1.5 text-right font-medium">{t("total")}</th>
                </tr>
              </thead>
              <tbody>
                {SECTIONS.map((section) => {
                  const lines = pnl.lines.filter((l) => l.section === section);
                  return (
                    <Fragment key={section}>
                      {lines.length > 0 && (
                        <>
                          <tr>
                            <td colSpan={cols.length + 3} className="pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {t(`sections.${section}`)}
                            </td>
                          </tr>
                          {lines.map((l) => (
                            <tr key={l.accountCode} className="border-b border-dashed last:border-solid">
                              <td className="py-1 pr-3">
                                <Link href={`/accounting/chart/${l.accountCode}`} className="font-mono text-xs text-primary hover:underline">
                                  {l.accountCode}
                                </Link>
                              </td>
                              <td className="py-1 pr-3 text-muted-foreground">{l.label}</td>
                              {cols.map((c) => (
                                <td key={c} className="py-1 pr-3 text-right tabular-nums">
                                  {money(l.byDepartment[c])}
                                </td>
                              ))}
                              <td className="py-1 text-right tabular-nums">{money(l.totalCents)}</td>
                            </tr>
                          ))}
                          {figureRow(t(`sections.${section}`), sectionTotal[section], { testId: `pnl-${section}` })}
                        </>
                      )}
                      {section === "COST_OF_SALES" && (
                        <>
                          {figureRow(t("grossMargin"), (f) => f.grossMarginCents, { strong: true, testId: "pnl-gross-margin" })}
                          {figureRow(t("grossMarginPct"), (f) => f.grossMarginBp, { pct: true, testId: "pnl-gross-margin-pct" })}
                        </>
                      )}
                    </Fragment>
                  );
                })}
                {figureRow(t("result"), (f) => f.resultCents, { strong: true, testId: "pnl-result" })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t("workshopNote")}</p>
      </Section>
    </div>
  );
}
