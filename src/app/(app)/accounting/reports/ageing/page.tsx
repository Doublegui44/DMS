import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { parseListParams, type SearchParams } from "@/lib/list";
import { AGEING_BUCKETS, getPayablesAgeing, getReceivablesAgeing } from "@/modules/accounting";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("ageingBalance");

export default async function AgeingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const payables = sp.type === "payables";
  const p = parseListParams(Object.fromEntries(Object.entries(sp).filter(([k]) => k !== "type")));
  const t = await getTranslations("reports");
  const { sites } = await getRequestContext();
  const data = await query((ctx) => (payables ? getPayablesAgeing(ctx, p) : getReceivablesAgeing(ctx, p)), { resource: "accounting.report", action: "view" });
  const partyType = payables ? "supplier" : "customer";
  const rows: Row[] = data.rows.map((r) => ({
    id: r.partyId,
    accountCode: { kind: "mono", value: r.accountCode },
    name: { kind: "link", href: `/accounting/ledgers/${partyType}/${r.partyId}`, label: r.name },
    ...Object.fromEntries(AGEING_BUCKETS.map((b) => [b, { kind: "money", cents: r[b] || null }])),
    totalCents: { kind: "money", cents: r.totalCents },
    unappliedCents: { kind: "money", cents: r.unappliedCents || null },
    balanceCents: { kind: "money", cents: r.balanceCents },
  }));
  const tab = (key: "receivables" | "payables") => (
    <Link
      href={`/accounting/reports/ageing?type=${key}`}
      className={cn("rounded-md px-3 py-1.5 text-sm", (key === "payables") === payables ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}
      data-testid={`ageing-tab-${key}`}
    >
      {t(key)}
    </Link>
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title={payables ? t("payables") : t("receivables")}
        subtitle={`${t("asOf", { date: formatDate(data.asOf) })} · ${payables ? t("payablesMethod") : t("ageingHint")}`}
        backHref="/accounting/reports"
        actions={
          <div className="flex gap-1">
            {tab("receivables")}
            {tab("payables")}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" data-testid="ageing-totals">
        {[...AGEING_BUCKETS, "unappliedCents" as const, "balanceCents" as const].map((b) => (
          <div key={b} className={cn("rounded-lg border bg-card px-3 py-2", b === "balanceCents" && "border-primary/40")}>
            <div className="text-xs text-muted-foreground">{b === "unappliedCents" ? t("unapplied") : b === "balanceCents" ? t("balance") : t(`buckets.${b}`)}</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums" data-testid={`ageing-${b}`} data-cents={data.totals[b]}>
              {formatMoney(data.totals[b], { decimals: false })}
            </div>
          </div>
        ))}
      </div>
      <DataTable
        rows={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        exportHref={`/api/export/${payables ? "payables-ageing" : "receivables-ageing"}`}
        columns={[
          { key: "accountCode", header: t("account") },
          { key: "name", header: payables ? t("supplier") : t("customer") },
          ...AGEING_BUCKETS.map((b) => ({ key: b, header: t(`buckets.${b}`), align: "right" as const })),
          { key: "totalCents", header: t("openDocuments"), align: "right" },
          { key: "unappliedCents", header: t("unapplied"), align: "right" },
          { key: "balanceCents", header: t("balance"), align: "right" },
        ]}
        filters={[
          { key: "overdue", label: t("overdueOnly"), options: [{ value: "1", label: t("overdueOnly") }] },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
