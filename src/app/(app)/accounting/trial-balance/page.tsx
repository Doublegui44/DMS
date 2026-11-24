import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { formatMoney } from "@/lib/money";
import { getTrialBalance } from "@/modules/accounting";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/shared/form";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("trialBalance");

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; site?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations("accounting");
  const { sites } = await getRequestContext();
  const tb = await query(
    (ctx) => getTrialBalance(ctx, { from: sp.from ? new Date(sp.from) : undefined, to: sp.to ? new Date(sp.to) : undefined, siteId: sp.site || undefined }),
    { resource: "accounting.report", action: "view" },
  );
  const money = (c: number) => (c ? formatMoney(c) : "");
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("trialBalance")}
        badges={<StatusBadge status={tb.balanced ? "PAID" : "overdue"} label={tb.balanced ? t("balanced") : t("unbalanced")} />}
      />
      <form className="flex flex-wrap items-end gap-3 text-sm">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t("from")}</span>
          <input type="date" name="from" defaultValue={sp.from} className={inputClass} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t("to")}</span>
          <input type="date" name="to" defaultValue={sp.to} className={inputClass} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t("site")}</span>
          <select name="site" defaultValue={sp.site ?? ""} className={inputClass}>
            <option value="">—</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" variant="outline">
          {t("apply")}
        </Button>
      </form>
      <Section>
        <table className="w-full text-[13px]" data-testid="trial-balance">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-1.5 pr-3">{t("account")}</th>
              <th className="py-1.5 pr-3">{t("label")}</th>
              <th className="py-1.5 pr-3 text-right">{t("debit")}</th>
              <th className="py-1.5 pr-3 text-right">{t("credit")}</th>
              <th className="py-1.5 pr-3 text-right">{t("balance")} Dr</th>
              <th className="py-1.5 text-right">{t("balance")} Cr</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.accountCode} className="border-b last:border-0">
                <td className="py-1.5 pr-3">
                  <Link href={`/accounting/chart/${r.accountCode}`} className="font-mono text-xs text-primary hover:underline">
                    {r.accountCode}
                  </Link>
                </td>
                <td className="py-1.5 pr-3">{r.label}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.debitCents)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.creditCents)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.balanceCents > 0 ? formatMoney(r.balanceCents) : ""}</td>
                <td className="py-1.5 text-right tabular-nums">{r.balanceCents < 0 ? formatMoney(-r.balanceCents) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={2} className="py-2 pr-3 text-right">
                {t("totals")}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(tb.totals.debitCents)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(tb.totals.creditCents)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </Section>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title={t("classTotals")}>
          <table className="w-full text-[13px]">
            <tbody>
              {tb.byClass.map((c) => (
                <tr key={c.class}>
                  <td className="py-1 pr-3">Class {c.class}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatMoney(c.debitCents)}</td>
                  <td className="py-1 text-right tabular-nums">{formatMoney(c.creditCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title={t("result")}>
          <p className="text-2xl font-semibold tabular-nums" data-testid="tb-result" data-cents={tb.resultCents}>
            {formatMoney(tb.resultCents)}
          </p>
        </Section>
      </div>
    </div>
  );
}
