import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { parseListParams, type SearchParams } from "@/lib/list";
import { listUsers, ROLE_KEYS } from "@/modules/admin";
import { DataTable, type Row } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("users");

export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = parseListParams(await searchParams, { sort: "lastName", dir: "asc", pageSize: 50 });
  const t = await getTranslations("admin");
  const tRole = await getTranslations("roles");
  const tc = await getTranslations("common");
  const tu = await getTranslations("ui");
  const { sites } = await getRequestContext();
  const data = await query((ctx) => listUsers(ctx, p), { resource: "admin.user", action: "view" });

  const rows: Row[] = data.rows.map((u) => ({
    id: u.id,
    lastName: `${u.firstName} ${u.lastName}`,
    email: { kind: "mono", value: u.email },
    roles: {
      kind: "badges",
      items: u.roles.map((r) => ({ status: r.role.key, tone: "indigo" as const, label: `${tRole(r.role.key)} · ${r.site?.code ?? tc("groupWide")}` })),
    },
    technician: u.isTechnician,
    active: { kind: "badge", status: u.active ? "ACTIVE" : "INACTIVE", label: u.active ? tu("active") : tu("inactive") },
  }));

  return (
    <div>
      <PageHeader title={t("usersTitle")} subtitle={tu("demoPassword")} />
      <DataTable
        rows={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        exportHref="/api/export/users"
        columns={[
          { key: "lastName", header: tu("name"), sortable: true },
          { key: "email", header: tu("email"), sortable: true },
          { key: "roles", header: t("roles") },
          { key: "technician", header: t("technician"), align: "center" },
          { key: "active", header: t("active") },
        ]}
        filters={[
          { key: "role", label: t("role"), options: ROLE_KEYS.map((k) => ({ value: k, label: tRole(k) })) },
          { key: "site", label: tu("site"), options: sites.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
    </div>
  );
}
