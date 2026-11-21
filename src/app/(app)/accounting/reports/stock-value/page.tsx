import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getStockValueReport } from "@/modules/reports";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";

export const metadata = { title: "Stock value" };

export default async function StockValuePage() {
  const t = await getTranslations("reports");
  const r = await query((ctx) => getStockValueReport(ctx), { resource: "accounting.report", action: "view" });
  const money = (c: number | null) => (c === null ? t("notVisible") : formatMoney(c));
  const head = (
    <thead className="text-left text-xs text-muted-foreground">
      <tr className="border-b">
        <th className="py-1.5 pr-3 font-medium">{t("kind")}</th>
        <th className="py-1.5 pr-3 font-medium">{t("account")}</th>
        <th className="py-1.5 pr-3 text-right font-medium">{t("items")}</th>
        <th className="py-1.5 pr-3 text-right font-medium">{t("subLedger")}</th>
        <th className="py-1.5 pr-3 text-right font-medium">{t("ledger")}</th>
        <th className="py-1.5 text-right font-medium">{t("difference")}</th>
      </tr>
    </thead>
  );
  type Line = (typeof r.totals)[number];
  const line = (l: Line, testId?: string) => (
    <tr key={l.kind} className="border-b last:border-0" data-testid={testId}>
      <td className="py-1.5 pr-3">{t(`kinds.${l.kind}`)}</td>
      <td className="py-1.5 pr-3 font-mono text-xs">{l.account}xxx</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{l.count ?? "—"}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums" data-cents={l.subLedgerCents ?? ""}>
        {money(l.subLedgerCents)}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums" data-cents={l.glCents}>
        {formatMoney(l.glCents)}
      </td>
      <td className={`py-1.5 text-right tabular-nums ${l.differenceCents ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
        {l.differenceCents === null ? "—" : formatMoney(l.differenceCents)}
      </td>
    </tr>
  );
  const total = r.totals.reduce((s, l) => s + l.glCents, 0);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("stockValue")}
        subtitle={`${t("asOf", { date: formatDate(r.asOf) })} · ${t("stockValueHint")}`}
        backHref="/accounting/reports"
        badges={<StatusBadge status={r.reconciled ? "PAID" : "overdue"} label={r.reconciled ? t("reconciled") : t("notReconciled")} />}
      />
      <Section title={t("total")} actions={<span className="text-lg font-semibold tabular-nums">{formatMoney(total)}</span>}>
        <table className="w-full text-[13px]" data-testid="stock-value-totals">
          {head}
          <tbody>{r.totals.map((l) => line(l, `stock-total-${l.kind}`))}</tbody>
        </table>
      </Section>
      <div className="grid gap-4 xl:grid-cols-2">
        {r.rows.map((s) => (
          <Section key={s.site.id} title={`${s.site.code} — ${s.site.name}`}>
            <table className="w-full text-[13px]">
              {head}
              <tbody>{s.lines.map((l) => line(l))}</tbody>
            </table>
          </Section>
        ))}
      </div>
    </div>
  );
}
