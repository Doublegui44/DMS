import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listBrands } from "@/modules/core";
import { listVnStock } from "@/modules/sales";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("newVehicleStock");

export default async function VnStockPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("sales");
  const { actor, sites } = await getRequestContext();
  const p = parseListParams(sp, { sort: "stockInDate", dir: "asc" });
  const [data, brands] = await Promise.all([query((ctx) => listVnStock(ctx, p), { resource: "sales.vn_stock", action: "view" }), query((ctx) => listBrands(ctx))]);
  const rows: Row[] = data.rows.map((v) => {
    const order = v.salesOrders[0];
    const reservation = v.reservations[0];
    const customer = order ? { kind: "link" as const, href: `/sales/orders/${order.id}`, label: order.customer.displayName, sub: order.number } : reservation ? { kind: "link" as const, href: `/customers/${reservation.customer.id}`, label: reservation.customer.displayName, sub: t("reservedShort") } : null;
    return {
      id: v.id,
      make: { kind: "link", href: `/sales/vn-stock/${v.id}`, label: `${v.make} ${v.model}`, sub: v.version },
      vin: { kind: "mono", value: v.vin },
      colour: v.colour,
      status: { kind: "badge", status: v.status, label: t(`vehicleStatuses.${v.status}`) },
      eta: !v.stockInDate && v.factoryOrder ? { kind: "date", iso: isoDate(v.factoryOrder.expectedOn) } : null,
      stockInDate: v.stockInDate ? { kind: "date", iso: isoDate(v.stockInDate) } : null,
      ageing: v.ageing ? { kind: "badge", status: v.ageing, label: t("days", { count: v.daysInStock ?? 0 }) } : null,
      listPriceCents: { kind: "money", cents: v.listPriceCents },
      stockValueCents: { kind: "money", cents: v.stockInDate ? v.stockValueCents : null },
      customer,
      site: v.site?.code ?? null,
    };
  });
  return (
    <div>
      <PageHeader
        title={t("vnStock")}
        subtitle={t("vnStockHint")}
        actions={
          can(actor.permissions, "sales.vn_stock", "create") && (
            <Button asChild size="sm">
              <Link href="/sales/vn-stock/order">
                <Plus /> {t("orderForStock")}
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
        exportHref="/api/export/vn-stock"
        columns={[
          { key: "make", header: t("vehicle"), sortable: true },
          { key: "vin", header: "VIN" },
          { key: "colour", header: t("colour") },
          { key: "status", header: t("status"), sortable: true },
          { key: "eta", header: t("eta") },
          { key: "stockInDate", header: t("inStockSince"), sortable: true },
          { key: "ageing", header: t("ageing") },
          { key: "listPriceCents", header: t("listPriceIncl"), align: "right", sortable: true },
          { key: "stockValueCents", header: t("stockValue"), align: "right", sortable: true },
          { key: "customer", header: t("customer") },
          { key: "site", header: t("site") },
        ]}
        filters={[
          { key: "status", label: t("status"), options: ["ORDERED", "IN_TRANSIT", "IN_STOCK", "RESERVED", "SOLD"].map((s) => ({ value: s, label: t(`vehicleStatuses.${s}`) })) },
          { key: "arrived", label: t("arrival"), options: [{ value: "1", label: t("arrivedOnly") }] },
          { key: "brand", label: t("brand"), options: brands.map((b) => ({ value: b.id, label: b.name })) },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
