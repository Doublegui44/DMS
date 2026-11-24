import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatBp } from "@/lib/money";
import { isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listCounterSales } from "@/modules/parts";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("counterSales");

const STATUSES = ["QUOTE", "CONFIRMED", "INVOICED", "CANCELLED"] as const;
const CLASSES = ["RETAIL", "TRADE", "INTERNAL", "WARRANTY"] as const;

export default async function CounterSalesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("parts");
  const { actor, sites } = await getRequestContext();
  const p = parseListParams(sp, { sort: "createdOn", dir: "desc" });
  const data = await query((ctx) => listCounterSales(ctx, p), { resource: "parts.counter_sale", action: "view" });
  const rows: Row[] = data.rows.map((s) => ({
    id: s.id,
    number: { kind: "link", href: `/parts/counter/${s.id}`, label: s.number },
    createdOn: { kind: "date", iso: isoDate(s.createdOn) },
    customer: { kind: "link", href: `/customers/${s.customer.id}`, label: s.customer.displayName },
    priceClass: { kind: "badge", status: s.priceClass, label: t(`priceClasses.${s.priceClass}`) },
    status: { kind: "badge", status: s.status, label: t(`counterStatuses.${s.status}`) },
    lines: s._count.lines,
    totalExclVatCents: { kind: "money", cents: s.totalExclVatCents },
    margin: s.margin ? formatBp(s.margin.marginBp, 1) : null,
    invoice: s.invoice ? { kind: "link", href: `/accounting/invoices/${s.invoice.id}`, label: s.invoice.number ?? "—" } : null,
    site: s.site.code,
  }));
  const canCreate = sites.some((s) => can(actor.permissions, "parts.counter_sale", "create", s.id));
  return (
    <div>
      <PageHeader
        title={t("counter")}
        subtitle={t("counterHint")}
        actions={
          canCreate && (
            <Button asChild size="sm">
              <Link href="/parts/counter/new">
                <Plus /> {t("newCounterSale")}
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
        exportHref="/api/export/counter-sales"
        columns={[
          { key: "number", header: t("number"), sortable: true },
          { key: "createdOn", header: t("date"), sortable: true },
          { key: "customer", header: t("customer") },
          { key: "priceClass", header: t("priceClass") },
          { key: "status", header: t("status"), sortable: true },
          { key: "lines", header: t("lines"), align: "right" },
          { key: "totalExclVatCents", header: t("totalExcl"), align: "right", sortable: true },
          { key: "margin", header: t("margin"), align: "right" },
          { key: "invoice", header: t("invoice") },
          { key: "site", header: t("site") },
        ]}
        filters={[
          { key: "status", label: t("status"), options: STATUSES.map((s) => ({ value: s, label: t(`counterStatuses.${s}`) })) },
          { key: "priceClass", label: t("priceClass"), options: CLASSES.map((c) => ({ value: c, label: t(`priceClasses.${c}`) })) },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
