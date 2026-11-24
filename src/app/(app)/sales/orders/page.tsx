import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listOrders } from "@/modules/sales";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("salesOrders");

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("sales");
  const { sites } = await getRequestContext();
  const p = parseListParams(sp, { sort: "orderDate", dir: "desc" });
  const data = await query((ctx) => listOrders(ctx, p), { resource: "sales.order", action: "view" });
  const rows: Row[] = data.rows.map((o) => ({
    id: o.id,
    number: { kind: "link", href: `/sales/orders/${o.id}`, label: o.number },
    orderDate: { kind: "date", iso: isoDate(o.orderDate) },
    customer: { kind: "link", href: `/customers/${o.customer.id}`, label: o.customer.displayName },
    vehicle: `${o.vehicle.make} ${o.vehicle.model} ${o.vehicle.version}`,
    stockType: { kind: "badge", status: o.stockType, label: o.stockType },
    status: { kind: "badge", status: o.status, label: t(`orderStatuses.${o.status}`) },
    totalInclVatCents: { kind: "money", cents: o.totalInclVatCents },
    tradeIn: { kind: "money", cents: o.tradeInCents || null },
    financed: { kind: "money", cents: o.financedCents || null },
    invoice: o.invoice ? { kind: "link", href: `/accounting/invoices/${o.invoice.id}`, label: o.invoice.number ?? "—" } : null,
    expectedDeliveryDate: o.status === "CONFIRMED" && o.expectedDeliveryDate ? { kind: "date", iso: isoDate(o.expectedDeliveryDate) } : null,
    salesperson: o.salesperson ? `${o.salesperson.firstName} ${o.salesperson.lastName}` : null,
    site: o.site.code,
  }));
  return (
    <div>
      <PageHeader title={t("orders")} subtitle={t("ordersHint")} />
      <DataTable
        rows={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        exportHref="/api/export/orders"
        columns={[
          { key: "number", header: t("order"), sortable: true },
          { key: "orderDate", header: t("date"), sortable: true },
          { key: "customer", header: t("customer") },
          { key: "vehicle", header: t("vehicle") },
          { key: "stockType", header: t("type") },
          { key: "status", header: t("status"), sortable: true },
          { key: "totalInclVatCents", header: t("totalIncl"), align: "right", sortable: true },
          { key: "tradeIn", header: t("tradeIn"), align: "right" },
          { key: "financed", header: t("financed"), align: "right" },
          { key: "invoice", header: t("invoice") },
          { key: "expectedDeliveryDate", header: t("expectedDelivery"), sortable: true },
          { key: "salesperson", header: t("salesperson") },
          { key: "site", header: t("site") },
        ]}
        filters={[
          { key: "status", label: t("status"), options: ["CONFIRMED", "INVOICED", "DELIVERED", "CANCELLED"].map((s) => ({ value: s, label: t(`orderStatuses.${s}`) })) },
          { key: "stockType", label: t("type"), options: ["VN", "VO"].map((s) => ({ value: s, label: s })) },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
