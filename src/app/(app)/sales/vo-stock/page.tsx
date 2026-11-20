import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listVoStock } from "@/modules/sales";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Used-vehicle stock" };

export default async function VoStockPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("sales");
  const { actor, sites } = await getRequestContext();
  const p = parseListParams(sp, { sort: "stockInDate", dir: "asc" });
  const data = await query((ctx) => listVoStock(ctx, p), { resource: "sales.vo_stock", action: "view" });
  const [watch, warning, critical] = data.thresholds;
  const rows: Row[] = data.rows.map((v) => {
    const order = v.salesOrders[0];
    const reservation = v.reservations[0];
    return {
      id: v.id,
      make: { kind: "link", href: `/sales/vo-stock/${v.id}`, label: `${v.make} ${v.model}`, sub: v.version },
      registration: { kind: "mono", value: v.registration },
      mileage: v.mileage === null ? null : `${v.mileage.toLocaleString("en-GB")} km`,
      status: { kind: "badge", status: v.status, label: t(`vehicleStatuses.${v.status}`) },
      vatRegime: { kind: "badge", status: v.vatRegime === "MARGIN" ? "VO" : "VN", label: t(`vatRegimes.${v.vatRegime}`) },
      stockInDate: { kind: "date", iso: v.stockInDate ? isoDate(v.stockInDate) : null },
      ageing: { kind: "badge", status: v.ageing, label: t("days", { count: v.daysInStock }) },
      purchase: { kind: "money", cents: v.purchasePriceCents },
      stockValueCents: { kind: "money", cents: v.stockValueCents },
      listPriceCents: { kind: "money", cents: v.listPriceCents },
      margin: { kind: "money", cents: v.expectedMarginCents },
      customer: order
        ? { kind: "link", href: `/sales/orders/${order.id}`, label: order.customer.displayName, sub: order.number }
        : reservation
          ? { kind: "link", href: `/customers/${reservation.customer.id}`, label: reservation.customer.displayName, sub: t("reservedShort") }
          : null,
      site: v.site?.code ?? null,
    };
  });
  return (
    <div>
      <PageHeader
        title={t("voStock")}
        subtitle={t("voStockHint", { watch, warning, critical })}
        actions={
          can(actor.permissions, "sales.vo_stock", "create") && (
            <Button asChild size="sm">
              <Link href="/sales/vo-stock/purchase">
                <Plus /> {t("buyUsedCar")}
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
        exportHref="/api/export/vo-stock"
        columns={[
          { key: "make", header: t("vehicle"), sortable: true },
          { key: "registration", header: t("registration") },
          { key: "mileage", header: t("mileage"), align: "right" },
          { key: "status", header: t("status"), sortable: true },
          { key: "vatRegime", header: t("vatRegime") },
          { key: "stockInDate", header: t("inStockSince"), sortable: true },
          { key: "ageing", header: t("ageing") },
          { key: "purchase", header: t("purchasePrice"), align: "right" },
          { key: "stockValueCents", header: t("stockValue"), align: "right", sortable: true },
          { key: "listPriceCents", header: t("listPriceIncl"), align: "right", sortable: true },
          { key: "margin", header: t("expectedMargin"), align: "right" },
          { key: "customer", header: t("customer") },
          { key: "site", header: t("site") },
        ]}
        filters={[
          { key: "status", label: t("status"), options: ["INTAKE", "RECONDITIONING", "FOR_SALE", "RESERVED", "SOLD"].map((s) => ({ value: s, label: t(`vehicleStatuses.${s}`) })) },
          {
            key: "ageing",
            label: t("ageing"),
            options: [
              { value: "watch", label: t("ageingOver", { days: watch }) },
              { value: "warning", label: t("ageingOver", { days: warning }) },
              { value: "critical", label: t("ageingOver", { days: critical }) },
            ],
          },
          { key: "regime", label: t("vatRegime"), options: ["MARGIN", "STANDARD"].map((r) => ({ value: r, label: t(`vatRegimes.${r}`) })) },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
