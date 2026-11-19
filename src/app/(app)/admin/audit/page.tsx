import { getTranslations } from "next-intl/server";
import { query } from "@/lib/session";
import { formatDateTime, isoDate } from "@/lib/dates";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listAuditLog } from "@/modules/admin";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";

export const metadata = { title: "Activity log" };

const ENTITY_LINKS: Record<string, string> = { Customer: "/customers", Vehicle: "/vehicles" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = parseListParams(await searchParams, { sort: "at", dir: "desc", pageSize: 50 });
  const t = await getTranslations("admin");
  const data = await query((ctx) => listAuditLog(ctx, p), { resource: "admin.audit", action: "view" });

  const rows: Row[] = data.rows.map((a) => ({
    id: a.id,
    at: formatDateTime(a.at),
    businessDate: { kind: "date", iso: isoDate(a.businessDate) },
    user: a.user ? `${a.user.firstName} ${a.user.lastName}` : "System",
    site: a.site?.code ?? null,
    action: { kind: "mono", value: a.action },
    entity: ENTITY_LINKS[a.entityType]
      ? { kind: "link", href: `${ENTITY_LINKS[a.entityType]}/${a.entityId}`, label: a.entityType, sub: a.entityId.slice(-6) }
      : `${a.entityType} ${a.entityId.slice(-6)}`,
  }));

  return (
    <div>
      <PageHeader title={t("auditTitle")} />
      <DataTable
        rows={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        exportHref="/api/export/audit"
        columns={[
          { key: "at", header: t("at"), sortable: true },
          { key: "businessDate", header: "Business date" },
          { key: "user", header: t("user") },
          { key: "site", header: "Site" },
          { key: "action", header: t("action"), sortable: true },
          { key: "entity", header: t("entity") },
        ]}
        filters={[
          {
            key: "entityType",
            label: t("entity"),
            options: ["Customer", "Vehicle", "User", "Role", "BusinessClock"].map((e) => ({ value: e, label: e })),
          },
        ]}
      />
    </div>
  );
}
