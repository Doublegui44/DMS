import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { getRequestContext, query } from "@/lib/session";
import { can } from "@/lib/rbac";
import { isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listRepairOrders } from "@/modules/workshop";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { RO_STATUSES, vehicleName } from "../format";

export const metadata = { title: "Repair orders" };

export default async function RepairOrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const t = await getTranslations("workshop");
  const { actor, sites } = await getRequestContext();
  const p = parseListParams(sp, { sort: "openedOn", dir: "desc" });
  const data = await query((ctx) => listRepairOrders(ctx, p), { resource: "workshop.repair_order", action: "view" });
  const rows: Row[] = data.rows.map((r) => ({
    id: r.id,
    number: { kind: "link", href: `/workshop/repair-orders/${r.id}`, label: r.number },
    openedOn: { kind: "date", iso: isoDate(r.openedOn) },
    kind: { kind: "badge", status: r.kind === "INTERNAL" ? "INTERNAL" : "CUSTOMER", label: t(`kinds.${r.kind}`) },
    customer: r.customer ? { kind: "link", href: `/customers/${r.customer.id}`, label: r.customer.displayName } : t("internalCustomer"),
    vehicle: { kind: "link", href: `/vehicles/${r.vehicle.id}`, label: vehicleName(r.vehicle) },
    status: { kind: "badge", status: r.status, label: t(`roStatuses.${r.status}`) },
    jobs: r._count.jobs,
    totalExclVatCents: { kind: "money", cents: r.totalExclVatCents },
    promisedOn: r.promisedOn ? { kind: "date", iso: isoDate(r.promisedOn) } : null,
    advisor: r.advisor ? `${r.advisor.firstName} ${r.advisor.lastName}` : null,
    site: r.site.code,
  }));
  const canCreate = sites.some((s) => can(actor.permissions, "workshop.repair_order", "create", s.id));
  return (
    <div>
      <PageHeader
        title={t("repairOrders")}
        subtitle={t("repairOrdersHint")}
        actions={
          canCreate && (
            <Button asChild size="sm">
              <Link href="/workshop/repair-orders/new">
                <Plus /> {t("checkIn")}
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
        exportHref="/api/export/repair-orders"
        columns={[
          { key: "number", header: t("number"), sortable: true },
          { key: "openedOn", header: t("openedOn"), sortable: true },
          { key: "kind", header: t("kind") },
          { key: "customer", header: t("customer") },
          { key: "vehicle", header: t("vehicle") },
          { key: "status", header: t("status"), sortable: true },
          { key: "jobs", header: t("jobs"), align: "right" },
          { key: "totalExclVatCents", header: t("totalExcl"), align: "right", sortable: true },
          { key: "promisedOn", header: t("promisedOn"), sortable: true },
          { key: "advisor", header: t("advisor") },
          { key: "site", header: t("site") },
        ]}
        filters={[
          { key: "status", label: t("status"), options: [{ value: "OPEN", label: t("openRos") }, ...RO_STATUSES.map((s) => ({ value: s, label: t(`roStatuses.${s}`) }))] },
          { key: "kind", label: t("kind"), options: (["CUSTOMER", "INTERNAL"] as const).map((k) => ({ value: k, label: t(`kinds.${k}`) })) },
          { key: "site", label: t("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
