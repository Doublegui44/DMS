import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Download } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { PageHeader, Section } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/shared/form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("reports");

const REPORTS = [
  { key: "pnl", href: "/accounting/reports/pnl" },
  { key: "vat", href: "/accounting/reports/vat" },
  { key: "receivables", href: "/accounting/reports/ageing?type=receivables" },
  { key: "payables", href: "/accounting/reports/ageing?type=payables" },
  { key: "stockValue", href: "/accounting/reports/stock-value" },
  { key: "trialBalance", href: "/accounting/trial-balance" },
] as const;

export default async function ReportsPage() {
  const t = await getTranslations("reports");
  const { actor } = await getRequestContext();
  const today = await query(async (ctx) => ctx.businessDate, { resource: "accounting.report", action: "view" });
  const year = today.getUTCFullYear();
  const groupWide = actor.siteIds === "ALL";
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r.key} href={r.href} className="group rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/50" data-testid={`report-${r.key}`}>
            <div className="flex items-center justify-between gap-2 text-sm font-medium">
              {t(r.key)}
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t(`${r.key}Hint`)}</p>
          </Link>
        ))}
      </div>
      <Section title={t("fec")}>
        <p className="mb-3 text-xs text-muted-foreground">{t("fecHint")}</p>
        {groupWide ? (
          <form action="/api/reports/fec" method="get" className="flex items-end gap-3 text-sm">
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">{t("year")}</span>
              <select name="year" defaultValue={String(year)} className={inputClass} data-testid="fec-year">
                {[year, year - 1].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" size="sm" variant="outline" data-testid="fec-download">
              <Download />
              {t("download")}
            </Button>
          </form>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t("fecGroupOnly")}</p>
        )}
      </Section>
    </div>
  );
}
