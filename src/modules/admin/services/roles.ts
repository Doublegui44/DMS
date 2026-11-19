import type { ServiceContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { ACTIONS, ALL_RESOURCES, type Action } from "@/lib/rbac";
import { DEFAULT_ROLE_MATRIX, ROLE_KEYS, ROLE_LABELS, flattenGrants } from "../domain/role-matrix";

/** Create every permission row and the ten default roles with their matrix (idempotent). */
export async function seedRolesAndPermissions(ctx: ServiceContext) {
  ctx.require("admin.role", "edit");
  for (const resource of ALL_RESOURCES) {
    for (const action of ACTIONS) {
      await ctx.tx.permission.upsert({
        where: { resource_action: { resource, action } },
        create: { resource, action },
        update: {},
      });
    }
  }
  const permissions = await ctx.tx.permission.findMany();
  const permId = new Map(permissions.map((p) => [`${p.resource}:${p.action}`, p.id]));

  for (const key of ROLE_KEYS) {
    const role = await ctx.tx.role.upsert({
      where: { key },
      create: { key, name: ROLE_LABELS[key] },
      update: { name: ROLE_LABELS[key] },
    });
    await ctx.tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    const grants = flattenGrants(DEFAULT_ROLE_MATRIX[key]);
    await ctx.tx.rolePermission.createMany({
      data: grants.map((g) => ({ roleId: role.id, permissionId: permId.get(`${g.resource}:${g.action}`)! })),
      skipDuplicates: true,
    });
  }
  await ctx.audit({ action: "role.seed", entityType: "Role", entityId: "*" });
}

/** Grant or revoke one cell of the permission matrix. */
export async function setRolePermission(
  ctx: ServiceContext,
  args: { roleId: string; resource: string; action: Action; granted: boolean },
) {
  ctx.require("admin.role", "edit");
  const role = await ctx.tx.role.findUnique({ where: { id: args.roleId } });
  if (!role) throw new NotFoundError("Role", args.roleId);
  const permission = await ctx.tx.permission.findUnique({
    where: { resource_action: { resource: args.resource, action: args.action } },
  });
  if (!permission) throw new NotFoundError("Permission", `${args.resource}:${args.action}`);
  if (args.granted) {
    await ctx.tx.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      create: { roleId: role.id, permissionId: permission.id },
      update: {},
    });
  } else {
    await ctx.tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
  }
  await ctx.audit({
    action: args.granted ? "role.permission.grant" : "role.permission.revoke",
    entityType: "Role",
    entityId: role.id,
    after: { role: role.key, permission: `${args.resource}:${args.action}` },
  });
}
