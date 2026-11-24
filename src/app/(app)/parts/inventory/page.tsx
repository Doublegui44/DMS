import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listCycleCounts } from "@/modules/parts";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("cycleCounts");

const STATUSES = ["OPEN", "POSTED", "CANCELLED"] as const;

export default async function CycleCountsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("parts");
  const { actor, sites } = await getRequestContext();
  const p = parseListParams(sp, { sort: "createdOn", dir: "desc" });
  const data = await query((ctx) => listCycleCounts(ctx, p), { resource: "parts.inventory", action: "view" });
  const rows: Row[] = data.rows.map((c) => ({
    id: c.id,
    number: { kind: "link", href: `/parts/inventory/${c.id}`, label: c.number },
    label: c.label,
    createdOn: { kind: "date", iso: isoDate(c.createdOn) },
    status: { kind: "badge", status: c.status, label: t(`countStatuses.${c.status}`) },
    lines: c._count.lines,
    postedOn: { kind: "date", iso: c.postedOn ? isoDate(c.postedOn) : null },
    varianceValueCents: { kind: "money", cents: c.varianceValueCents },
    site: c.site.code,
  }));
  const canCreate = sites.some((s) => can(actor.permissions, "parts.inventory", "create", s.id));
  return (
    <div>
      <PageHeader
        title={t("inventory")}
        subtitle={t("inventoryHint")}
        actions={
          canCreate && (
            <Button asChild size="sm">
              <Link href="/parts/inventory/new">
                <Plus /> {t("newCount")}
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
        columns={[
          { key: "number", header: t("number"), sortable: true },
          { key: "label", header: t("label") },
          { key: "createdOn", header: t("date"), sortable: true },
          { key: "status", header: t("status") },
          { key: "lines", header: t("items"), align: "right" },
          { key: "postedOn", header: t("postedOn"), sortable: true },
          { key: "varianceValueCents", header: t("variance"), align: "right", sortable: true },
          { key: "site", header: t("site") },
        ]}
        filters={[
          { key: "status", label: t("status"), options: STATUSES.map((s) => ({ value: s, label: t(`countStatuses.${s}`) })) },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
