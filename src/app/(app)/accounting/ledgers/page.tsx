import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listPartyBalances } from "@/modules/accounting";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("ledgers");

export default async function LedgersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const type = sp.type === "supplier" ? "SUPPLIER" : "CUSTOMER";
  const p = parseListParams(Object.fromEntries(Object.entries(sp).filter(([k]) => k !== "type")));
  const t = await getTranslations("accounting");
  const { sites } = await getRequestContext();
  const data = await query((ctx) => listPartyBalances(ctx, type, p), { resource: "accounting.report", action: "view" });
  const rows: Row[] = data.rows.map((r) => ({
    id: r.partyId,
    accountCode: { kind: "mono", value: r.accountCode },
    name: { kind: "link", href: `/accounting/ledgers/${type.toLowerCase()}/${r.partyId}`, label: r.name },
    debit: { kind: "money", cents: r.debitCents },
    credit: { kind: "money", cents: r.creditCents },
    balance: { kind: "money", cents: r.balanceCents },
  }));
  const tab = (key: string, label: string) => (
    <Link
      href={`/accounting/ledgers?type=${key}`}
      className={cn("rounded-md px-3 py-1.5 text-sm", (key === "supplier") === (type === "SUPPLIER") ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}
    >
      {label}
    </Link>
  );
  return (
    <div>
      <PageHeader title={t("ledgers")} actions={<div className="flex gap-1">{tab("customer", t("customers"))}{tab("supplier", t("suppliers"))}</div>} />
      <DataTable
        rows={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        columns={[
          { key: "accountCode", header: t("account") },
          { key: "name", header: t("party") },
          { key: "debit", header: t("debit"), align: "right" },
          { key: "credit", header: t("credit"), align: "right" },
          { key: "balance", header: t("balance"), align: "right" },
        ]}
        filters={[
          { key: "open", label: t("openOnly"), options: [{ value: "1", label: t("openOnly") }] },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
