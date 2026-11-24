import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { query } from "@/lib/session";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listLabourOperations } from "@/modules/workshop";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { hours } from "../format";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("labourCatalogue");

export default async function LabourOperationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("workshop");
  const p = parseListParams(sp, { sort: "code", dir: "asc", pageSize: 50 });
  const d = await query((ctx) => listLabourOperations(ctx, p), { resource: "workshop.labour_catalogue", action: "view" });
  const rows: Row[] = d.rows.map((o) => ({
    id: o.id,
    code: d.canEdit ? { kind: "link", href: `/workshop/labour-operations/${o.id}`, label: o.code } : { kind: "mono", value: o.code },
    label: o.label,
    category: o.category,
    brand: o.brand?.name ?? t("allMakes"),
    standardCentiHours: hours(o.standardCentiHours),
    active: { kind: "badge", status: o.active ? "ACTIVE" : "INACTIVE", label: o.active ? t("active") : t("inactive") },
  }));
  return (
    <div>
      <PageHeader
        title={t("labourCatalogue")}
        subtitle={t("labourCatalogueHint")}
        actions={
          d.canEdit && (
            <Button asChild size="sm">
              <Link href="/workshop/labour-operations/new">
                <Plus /> {t("newOperation")}
              </Link>
            </Button>
          )
        }
      />
      <DataTable
        rows={rows}
        total={d.total}
        page={d.page}
        pageSize={d.pageSize}
        exportHref="/api/export/labour-operations"
        columns={[
          { key: "code", header: t("code"), sortable: true },
          { key: "label", header: t("description"), sortable: true },
          { key: "category", header: t("category"), sortable: true },
          { key: "brand", header: t("brand") },
          { key: "standardCentiHours", header: t("standardTime"), align: "right", sortable: true },
          { key: "active", header: t("status") },
        ]}
        filters={[
          { key: "category", label: t("category"), options: d.categories.map((c) => ({ value: c, label: c })) },
          { key: "active", label: t("status"), options: [{ value: "all", label: t("includeInactive") }] },
        ]}
      />
    </div>
  );
}
