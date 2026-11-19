import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listAccounts } from "@/modules/accounting";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Chart of accounts" };

export default async function ChartPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = parseListParams(await searchParams, { sort: "code", dir: "asc", pageSize: 100 });
  const t = await getTranslations("accounting");
  const { actor } = await getRequestContext();
  const data = await query((ctx) => listAccounts(ctx, p), { resource: "accounting.chart", action: "view" });
  const rows: Row[] = data.rows.map((a) => ({
    id: a.code,
    code: { kind: "link", href: `/accounting/chart/${a.code}`, label: a.code },
    label: a.label,
    class: a.class,
    type: t(`types.${a.type}`),
    flags: {
      kind: "badges",
      items: [
        ...(a.requiresAnalytic ? [{ status: "analytic", label: "Analytic", tone: "indigo" as const }] : []),
        ...(a.isReceivable ? [{ status: "receivable", label: "Customer", tone: "blue" as const }] : []),
        ...(a.isPayable ? [{ status: "payable", label: "Supplier", tone: "amber" as const }] : []),
        ...(!a.active ? [{ status: "INACTIVE", label: "Inactive" }] : []),
      ],
    },
    balance: { kind: "money", cents: a.balanceCents },
  }));
  return (
    <div>
      <PageHeader
        title={t("chart")}
        actions={
          can(actor.permissions, "accounting.chart", "create") && (
            <Button asChild size="sm">
              <Link href="/accounting/chart/new">
                <Plus /> {t("newAccount")}
              </Link>
            </Button>
          )
        }
      />
      <DataTable
        rows={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        exportHref="/api/export/accounts"
        columns={[
          { key: "code", header: t("code"), sortable: true },
          { key: "label", header: t("label"), sortable: true },
          { key: "class", header: t("class"), sortable: true },
          { key: "type", header: t("type") },
          { key: "flags", header: "" },
          { key: "balance", header: t("balance"), align: "right" },
        ]}
        filters={[
          { key: "class", label: t("class"), options: [1, 2, 3, 4, 5, 6, 7, 8].map((c) => ({ value: String(c), label: `Class ${c}` })) },
          { key: "type", label: t("type"), options: ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"].map((x) => ({ value: x, label: t(`types.${x}`) })) },
        ]}
      />
    </div>
  );
}
