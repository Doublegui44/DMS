import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { formatBp } from "@/lib/money";
import { formatDate, isoDate } from "@/lib/dates";
import type { SearchParams } from "@/lib/list";
import { getProductivity } from "@/modules/workshop";
import { PageHeader, Section } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/shared/form";
import { hours } from "../format";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("productivity");

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function ProductivityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("workshop");
  const d = await query((ctx) => getProductivity(ctx, { siteId: one(sp.site), from: one(sp.from), to: one(sp.to) }), { resource: "workshop.clocking", action: "view" });
  const rows = [...d.rows.map((r) => ({ ...r, total: false })), { id: "total", name: t("workshopTotal"), ...d.totals, total: true }];
  return (
    <div className="space-y-4">
      <PageHeader title={t("productivity")} subtitle={t("productivityHint", { from: formatDate(d.from), to: formatDate(d.to), days: d.workingDays })} />
      <Section>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="site" value={d.siteId} />
          <label className="space-y-1 text-xs text-muted-foreground">
            {t("from")}
            <input type="date" name="from" defaultValue={isoDate(d.from)} className={inputClass} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            {t("to")}
            <input type="date" name="to" defaultValue={isoDate(d.to)} className={inputClass} />
          </label>
          <Button type="submit" size="sm" variant="outline">
            {t("show")}
          </Button>
        </form>
        <table className="w-full text-[13px]" data-testid="productivity">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-1.5 pr-3 font-medium">{t("technician")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("available")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("clocked")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("billed")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("productivityRate")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("efficiency")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("utilisation")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.total ? "font-semibold" : "border-b"} data-technician={r.name}>
                <td className="py-1.5 pr-3">{r.name}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{hours(r.availableCentiHours)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{hours(r.clockedCentiHours)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{hours(r.billedCentiHours)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatBp(r.productivityBp, 1)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums" data-testid="efficiency">
                  {formatBp(r.efficiencyBp, 1)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatBp(r.utilisedBp, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">{t("kpiHint")}</p>
      </Section>
    </div>
  );
}
