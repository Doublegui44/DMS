import { formatNumber } from "@/lib/format-locale";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { daysBetween } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { ageingLevel, listVehicles, type VehicleStatus } from "@/modules/core";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("vehicles");

const STATUSES: VehicleStatus[] = ["ORDERED", "IN_TRANSIT", "IN_STOCK", "INTAKE", "RECONDITIONING", "FOR_SALE", "RESERVED", "SOLD", "DELIVERED", "CUSTOMER"];

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = parseListParams(await searchParams, { sort: "createdAt", dir: "desc" });
  const t = await getTranslations("vehicle");
  const { actor, sites } = await getRequestContext();
  const [data, businessDate] = await query(async (ctx) => [await listVehicles(ctx, p), ctx.businessDate] as const, {
    resource: "vehicle",
    action: "view",
  });

  const rows: Row[] = data.rows.map((v) => {
    const days = v.stockInDate && v.stockType !== "NONE" ? daysBetween(v.stockInDate, businessDate) : null;
    const level = days !== null ? ageingLevel(days) : null;
    return {
      id: v.id,
      vehicle: { kind: "link", href: `/vehicles/${v.id}`, label: `${v.make} ${v.model}`, sub: v.version },
      registration: { kind: "mono", value: v.registration ?? v.vin.slice(-8) },
      stockType: { kind: "badge", status: v.stockType, label: v.stockType === "NONE" ? t("stockTypes.NONE") : v.stockType },
      status: { kind: "badge", status: v.status, label: t(`statuses.${v.status}`) },
      site: v.site?.code ?? null,
      owner: v.owner ? { kind: "link", href: `/customers/${v.owner.id}`, label: v.owner.displayName } : null,
      mileage: formatNumber(v.mileage),
      listPriceCents: { kind: "money", cents: v.listPriceCents },
      stockValueCents: v.stockType === "NONE" ? null : { kind: "money", cents: v.stockValueCents },
      stockInDate:
        days === null ? null : level === "ok" ? `${days} d` : { kind: "badge", status: level!, label: `${days} d` },
    };
  });

  return (
    <div>
      <PageHeader
        title={t("title")}
        actions={
          can(actor.permissions, "vehicle", "create") && (
            <Button asChild size="sm">
              <Link href="/vehicles/new">
                <Plus /> {t("new")}
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
        exportHref="/api/export/vehicles"
        columns={[
          { key: "vehicle", header: t("model"), sortable: false },
          { key: "registration", header: t("registration") },
          { key: "stockType", header: t("stockType") },
          { key: "status", header: t("status"), sortable: true },
          { key: "site", header: t("site") },
          { key: "owner", header: t("owner") },
          { key: "mileage", header: t("mileage"), align: "right" },
          { key: "listPriceCents", header: t("listPrice"), align: "right", sortable: true },
          { key: "stockValueCents", header: t("stockValue"), align: "right", sortable: true },
          { key: "stockInDate", header: t("daysInStock"), align: "right", sortable: true },
        ]}
        filters={[
          { key: "stockType", label: t("stockType"), options: (["VN", "VO", "NONE"] as const).map((s) => ({ value: s, label: t(`stockTypes.${s}`) })) },
          { key: "status", label: t("status"), options: STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) })) },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
          {
            key: "fuel",
            label: t("fuel"),
            options: (["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "ELECTRIC", "LPG"] as const).map((f) => ({ value: f, label: t(`fuels.${f}`) })),
          },
        ]}
      />
    </div>
  );
}
