/**
 * Role-based access control primitives (pure, no I/O).
 * A permission is `resource` × `action`. Roles are granted per site or on all sites.
 */

export const ACTIONS = ["view", "create", "edit", "validate", "delete"] as const;
export type Action = (typeof ACTIONS)[number];

/** Catalogue of permission resources, grouped by module (drives the permission matrix UI). */
export const RESOURCES = {
  core: ["dashboard", "customer", "vehicle"],
  sales: ["sales.lead", "sales.quote", "sales.order", "sales.trade_in", "sales.vo_stock", "sales.catalogue"],
  workshop: [
    "workshop.appointment",
    "workshop.repair_order",
    "workshop.clocking",
    "workshop.warranty",
    "workshop.labour_catalogue",
  ],
  parts: ["parts.part", "parts.stock", "parts.purchase_order", "parts.counter_sale", "parts.inventory"],
  accounting: [
    "accounting.entry",
    "accounting.invoice",
    "accounting.payment",
    "accounting.period",
    "accounting.chart",
    "accounting.report",
  ],
  admin: ["admin.user", "admin.role", "admin.settings", "admin.audit", "admin.simulation"],
} as const;

export type Module = keyof typeof RESOURCES;
export type Resource = (typeof RESOURCES)[Module][number];

export const ALL_RESOURCES: Resource[] = Object.values(RESOURCES).flat() as Resource[];

export function permissionKey(resource: string, action: Action): string {
  return `${resource}:${action}`;
}

/** "ALL" = granted on every site; otherwise the set of site ids where granted. */
export type SiteScope = "ALL" | Set<string>;
export type PermissionSet = Map<string, SiteScope>;

export interface RoleGrant {
  siteId: string | null;
  permissions: { resource: string; action: Action }[];
}

/** Merge role grants into a permission set. */
export function buildPermissionSet(grants: RoleGrant[]): PermissionSet {
  const set: PermissionSet = new Map();
  for (const grant of grants) {
    for (const p of grant.permissions) {
      const key = permissionKey(p.resource, p.action);
      const current = set.get(key);
      if (current === "ALL") continue;
      if (grant.siteId === null) {
        set.set(key, "ALL");
      } else {
        const sites = current ?? new Set<string>();
        sites.add(grant.siteId);
        set.set(key, sites);
      }
    }
  }
  return set;
}

/**
 * Is `action` on `resource` allowed? Without `siteId`, returns true if allowed on at least one site.
 */
export function can(set: PermissionSet, resource: string, action: Action, siteId?: string | null): boolean {
  const scope = set.get(permissionKey(resource, action));
  if (!scope) return false;
  if (scope === "ALL") return true;
  if (siteId === undefined || siteId === null) return scope.size > 0;
  return scope.has(siteId);
}

/** Site ids on which the grants give any access at all; "ALL" if any role is group-wide. */
export function accessibleSiteIds(grants: RoleGrant[]): "ALL" | string[] {
  if (grants.some((g) => g.siteId === null)) return "ALL";
  return [...new Set(grants.map((g) => g.siteId as string))];
}
