import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { getPartFormData, listSupplierInvoices } from "@/modules/parts";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Supplier invoices" };

const STATUSES = ["VARIANCE", "MATCHED", "PAID", "REJECTED"] as const;

export default async function SupplierInvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("parts");
  const { actor, sites } = await getRequestContext();
  const p = parseListParams(sp, { sort: "invoiceDate", dir: "desc" });
  const [data, form] = await Promise.all([
    query((ctx) => listSupplierInvoices(ctx, p), { resource: "parts.purchase_order", action: "view" }),
    query((ctx) => getPartFormData(ctx)),
  ]);
  const rows: Row[] = data.rows.map((inv) => ({
    id: inv.id,
    number: { kind: "link", href: `/parts/purchasing/invoices/${inv.id}`, label: inv.number },
    supplierReference: { kind: "mono", value: inv.supplierReference },
    invoiceDate: { kind: "date", iso: isoDate(inv.invoiceDate) },
    supplier: inv.supplier.name,
    status: { kind: "badge", status: inv.status, label: t(`invoiceStatuses.${inv.status}`) },
    totalInclVatCents: { kind: "money", cents: inv.totalInclVatCents },
    varianceCents: { kind: "money", cents: inv.varianceCents },
    dueDate: { kind: "date", iso: isoDate(inv.dueDate) },
    site: inv.site.code,
  }));
  const canCreate = sites.some((s) => can(actor.permissions, "parts.purchase_order", "create", s.id));
  return (
    <div>
      <PageHeader
        title={t("supplierInvoices")}
        subtitle={t("supplierInvoicesHint")}
        backHref="/parts/purchasing"
        actions={
          canCreate && (
            <Button asChild size="sm">
              <Link href="/parts/purchasing/invoices/new">
                <Plus /> {t("newSupplierInvoice")}
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
        exportHref="/api/export/supplier-invoices"
        columns={[
          { key: "number", header: t("number"), sortable: true },
          { key: "supplierReference", header: t("supplierReference") },
          { key: "invoiceDate", header: t("date"), sortable: true },
          { key: "supplier", header: t("supplier") },
          { key: "status", header: t("status") },
          { key: "totalInclVatCents", header: t("totalIncl"), align: "right", sortable: true },
          { key: "varianceCents", header: t("variance"), align: "right", sortable: true },
          { key: "dueDate", header: t("dueDate"), sortable: true },
          { key: "site", header: t("site") },
        ]}
        filters={[
          { key: "status", label: t("status"), options: STATUSES.map((s) => ({ value: s, label: t(`invoiceStatuses.${s}`) })) },
          { key: "due", label: t("dueFilter"), options: [{ value: "1", label: t("dueToPay") }] },
          { key: "supplier", label: t("supplier"), options: form.suppliers },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
