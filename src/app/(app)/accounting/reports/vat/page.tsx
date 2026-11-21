import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { formatBp, formatMoney } from "@/lib/money";
import { getVatReport } from "@/modules/accounting";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ReportFilters } from "../filters";
import { periodFrom } from "../params";

export const metadata = { title: "VAT return" };

export default async function VatPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const t = await getTranslations("reports");
  const { sites } = await getRequestContext();
  const today = await query(async (ctx) => ctx.businessDate, { resource: "accounting.report", action: "view" });
  const p = periodFrom(sp, today);
  const vat = await query((ctx) => getVatReport(ctx, { year: p.year, month: p.month, siteId: p.site || null }));
  const accounts = (rows: { accountCode: string; label: string; amountCents: number }[], testId: string) => (
    <table className="w-full text-[13px]" data-testid={testId}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.accountCode} className="border-b last:border-0">
            <td className="py-1.5 pr-3">
              <Link href={`/accounting/chart/${r.accountCode}`} className="font-mono text-xs text-primary hover:underline">
                {r.accountCode}
              </Link>
            </td>
            <td className="py-1.5 pr-3 text-muted-foreground">{r.label}</td>
            <td className="py-1.5 text-right tabular-nums" data-cents={r.amountCents}>
              {formatMoney(r.amountCents)}
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td className="py-1.5 text-muted-foreground">{t("noMovement")}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
  const due = vat.netDueCents >= 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("vat")}
        subtitle={t("vatHint")}
        backHref="/accounting/reports"
        badges={<StatusBadge status={vat.periodStatus} label={vat.periodStatus === "LOCKED" ? t("periodLocked") : t("periodOpen")} />}
      />
      <ReportFilters
        fields={[
          { name: "period", label: t("period"), type: "month", value: p.period, testId: "vat-period" },
          { name: "site", label: t("site"), type: "select", value: p.site, options: [{ value: "", label: t("allSites") }, ...sites.map((s) => ({ value: s.id, label: s.name }))] },
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: t("collected"), cents: vat.collectedCents, id: "vat-collected" },
          { label: t("deductible"), cents: vat.deductibleCents, id: "vat-deductible" },
          { label: due ? t("netDue") : t("credit"), cents: Math.abs(vat.netDueCents), id: "vat-net" },
        ].map((k) => (
          <div key={k.id} className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">{k.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums" data-testid={k.id} data-cents={k.id === "vat-net" ? vat.netDueCents : k.cents}>
              {formatMoney(k.cents)}
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("collected")}>{accounts(vat.collected, "vat-collected-accounts")}</Section>
        <Section title={t("deductible")}>{accounts(vat.deductible, "vat-deductible-accounts")}</Section>
      </div>
      <Section title={t("salesByRate")}>
        <table className="w-full text-[13px]" data-testid="vat-sales">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-1.5 pr-3 font-medium">{t("regime")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("rate")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("base")}</th>
              <th className="py-1.5 text-right font-medium">{t("vatAmount")}</th>
            </tr>
          </thead>
          <tbody>
            {vat.sales.map((s) => (
              <tr key={`${s.vatRegime}-${s.vatRateCode}`} className="border-b">
                <td className="py-1.5 pr-3">{t(`regimes.${s.vatRegime as "STANDARD" | "MARGIN"}`)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatBp(s.vatRateBp, 1)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(s.baseCents)}</td>
                <td className="py-1.5 text-right tabular-nums">{formatMoney(s.vatCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-[13px]">
            <tr className="font-medium">
              <td colSpan={3} className="py-1.5 pr-3 text-right">
                {t("invoicedVat")}
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(vat.invoicedVatCents)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="py-1.5 pr-3 text-right text-muted-foreground">
                {t("unexplained")}
              </td>
              <td className={`py-1.5 text-right tabular-nums ${vat.unexplainedCents ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`} data-testid="vat-unexplained">
                {formatMoney(vat.unexplainedCents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </Section>
    </div>
  );
}
