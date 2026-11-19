import { db } from "./db";
import type { Actor } from "./context";
import { accessibleSiteIds, buildPermissionSet, type Action, type RoleGrant } from "./rbac";

/** Load a user's roles and permissions into an Actor. Returns null for unknown/inactive users. */
export async function loadActor(userId: string): Promise<Actor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      roles: {
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      },
    },
  });
  if (!user || !user.active) return null;
  const grants: RoleGrant[] = user.roles.map((ur) => ({
    siteId: ur.siteId,
    permissions: ur.role.permissions.map((rp) => ({
      resource: rp.permission.resource,
      action: rp.permission.action as Action,
    })),
  }));
  return {
    userId: user.id,
    name: `${user.firstName} ${user.lastName}`,
    isSystem: false,
    permissions: buildPermissionSet(grants),
    siteIds: grants.length ? accessibleSiteIds(grants) : [],
    roleKeys: [...new Set(user.roles.map((r) => r.role.key))],
  };
}
