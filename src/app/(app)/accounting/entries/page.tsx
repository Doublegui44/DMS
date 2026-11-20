import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { parseListParams, type SearchParams } from "@/lib/list";
import { isoDate } from "@/lib/dates";
import { listEntries, listJournals, listPeriods, periodLabel } from "@/modules/accounting";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Journal entries" };

export default async function EntriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = parseListParams(await searchParams, { sort: "entryDate", dir: "desc" });
  const t = await getTranslations("accounting");
  const { actor, sites } = await getRequestContext();
  const [data, journals, periods] = await Promise.all([
    query((ctx) => listEntries(ctx, p), { resource: "accounting.entry", action: "view" }),
    query((ctx) => listJournals(ctx)),
    query((ctx) => listPeriods(ctx)),
  ]);

  const rows: Row[] = data.rows.map((e) => ({
    id: e.id,
    number: { kind: "link", href: `/accounting/entries/${e.id}`, label: e.number },
    entryDate: { kind: "date", iso: isoDate(e.entryDate) },
    journalCode: e.journalCode,
    label: e.label,
    sourceType: e.sourceType ? { kind: "badge", status: e.sourceType, label: t.has(`sources.${e.sourceType}`) ? t(`sources.${e.sourceType}`) : e.sourceType } : null,
    site: e.site.code,
    total: { kind: "money", cents: e.totalCents },
    state: e.reversedBy
      ? { kind: "badge", status: "REVERSAL", label: `${t("reversedBy")} ${e.reversedBy.number}` }
      : e.period.status === "LOCKED"
        ? { kind: "badge", status: "LOCKED", label: t("locked") }
        : null,
  }));

  return (
    <div>
      <PageHeader
        title={t("entries")}
        actions={
          can(actor.permissions, "accounting.entry", "create") && (
            <Button asChild size="sm">
              <Link href="/accounting/entries/new">
                <Plus /> {t("newEntry")}
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
        exportHref="/api/export/entries"
        columns={[
          { key: "number", header: t("number"), sortable: true },
          { key: "entryDate", header: t("date"), sortable: true },
          { key: "journalCode", header: t("journal"), sortable: true },
          { key: "label", header: t("label") },
          { key: "sourceType", header: t("source") },
          { key: "site", header: t("site") },
          { key: "total", header: t("total"), align: "right" },
          { key: "state", header: "" },
        ]}
        filters={[
          { key: "journal", label: t("journal"), options: journals.map((j) => ({ value: j.code, label: `${j.code} — ${t(`journals.${j.code}`)}` })) },
          { key: "source", label: t("source"), options: ["INVOICE", "PAYMENT", "SALES_ORDER", "VEHICLE_RECEIPT", "VO_PURCHASE", "VEHICLE_COST", "MANUAL", "REVERSAL", "OPENING"].map((s) => ({ value: s, label: t(`sources.${s}`) })) },
          { key: "period", label: t("period"), options: periods.map((x) => ({ value: x.id, label: periodLabel(x) })) },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
