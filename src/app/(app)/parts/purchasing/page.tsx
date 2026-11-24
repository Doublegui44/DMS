import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileCheck2, Lightbulb, Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { getPartFormData, listPurchaseOrders } from "@/modules/parts";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("partsPurchasing");

const STATUSES = ["DRAFT", "SENT", "PARTIAL", "RECEIVED", "CLOSED", "CANCELLED"] as const;

export default async function PurchasingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("parts");
  const { actor, sites } = await getRequestContext();
  const p = parseListParams(sp, { sort: "createdOn", dir: "desc" });
  const [data, form] = await Promise.all([query((ctx) => listPurchaseOrders(ctx, p), { resource: "parts.purchase_order", action: "view" }), query((ctx) => getPartFormData(ctx))]);
  const rows: Row[] = data.rows.map((po) => ({
    id: po.id,
    number: { kind: "link", href: `/parts/purchasing/${po.id}`, label: po.number },
    createdOn: { kind: "date", iso: isoDate(po.createdOn) },
    supplier: po.supplier.name,
    kind: { kind: "badge", status: po.kind, label: t(`poKinds.${po.kind}`) },
    status: { kind: "badges", items: [{ status: po.status, label: t(`poStatuses.${po.status}`) }, ...(po.late ? [{ status: "overdue", label: t("late") }] : [])] },
    lines: po.lineCount,
    valueCents: { kind: "money", cents: po.valueCents },
    expectedOn: { kind: "date", iso: po.expectedOn ? isoDate(po.expectedOn) : null },
    site: po.site.code,
  }));
  const canCreate = sites.some((s) => can(actor.permissions, "parts.purchase_order", "create", s.id));
  return (
    <div>
      <PageHeader
        title={t("purchasing")}
        subtitle={t("purchasingHint")}
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href="/parts/purchasing/invoices">
                <FileCheck2 /> {t("supplierInvoices")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/parts/purchasing/suggestions">
                <Lightbulb /> {t("suggestions")}
              </Link>
            </Button>
            {canCreate && (
              <Button asChild size="sm">
                <Link href="/parts/purchasing/new">
                  <Plus /> {t("newOrder")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <DataTable
        rows={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        exportHref="/api/export/purchase-orders"
        columns={[
          { key: "number", header: t("number"), sortable: true },
          { key: "createdOn", header: t("date"), sortable: true },
          { key: "supplier", header: t("supplier") },
          { key: "kind", header: t("kind") },
          { key: "status", header: t("status"), sortable: true },
          { key: "lines", header: t("lines"), align: "right" },
          { key: "valueCents", header: t("value"), align: "right" },
          { key: "expectedOn", header: t("expectedOn"), sortable: true },
          { key: "site", header: t("site") },
        ]}
        filters={[
          { key: "status", label: t("status"), options: [{ value: "OPEN", label: t("openOrders") }, ...STATUSES.map((s) => ({ value: s, label: t(`poStatuses.${s}`) }))] },
          { key: "kind", label: t("kind"), options: ["STOCK", "EMERGENCY"].map((k) => ({ value: k, label: t(`poKinds.${k}`) })) },
          { key: "supplier", label: t("supplier"), options: form.suppliers },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
