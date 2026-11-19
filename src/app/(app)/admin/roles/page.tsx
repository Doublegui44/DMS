import { getTranslations } from "next-intl/server";
import { getRequestContext, query } from "@/lib/session";
import { can, RESOURCES } from "@/lib/rbac";
import { getPermissionMatrix } from "@/modules/admin";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionMatrix } from "./permission-matrix";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const sp = await searchParams;
  const t = await getTranslations("admin");
  const { actor } = await getRequestContext();
  const roles = await query((ctx) => getPermissionMatrix(ctx), { resource: "admin.role", action: "view" });
  const selected = roles.find((r) => r.key === sp.role) ?? roles[0];

  return (
    <div>
      <PageHeader
        title={t("rolesTitle")}
        subtitle="Module × action. Roles are granted per site or on all sites (Admin → Users)."
      />
      <PermissionMatrix
        roles={roles.map((r) => ({ id: r.id, key: r.key, name: r.name, userCount: r.userCount }))}
        selectedRoleId={selected.id}
        granted={[...selected.granted]}
        modules={Object.entries(RESOURCES).map(([module, resources]) => ({ module, resources: [...resources] }))}
        canEdit={can(actor.permissions, "admin.role", "edit")}
      />
    </div>
  );
}
