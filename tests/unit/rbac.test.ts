import { describe, expect, it } from "vitest";
import { accessibleSiteIds, ACTIONS, ALL_RESOURCES, buildPermissionSet, can } from "@/lib/rbac";
import { DEFAULT_ROLE_MATRIX, flattenGrants, ROLE_KEYS } from "@/modules/admin/domain/role-matrix";

describe("buildPermissionSet / can", () => {
  const set = buildPermissionSet([
    { siteId: "nte", permissions: [{ resource: "sales.order", action: "create" }] },
    { siteId: "ren", permissions: [{ resource: "sales.order", action: "create" }, { resource: "customer", action: "view" }] },
    { siteId: null, permissions: [{ resource: "dashboard", action: "view" }] },
  ]);

  it("scopes a grant to its sites", () => {
    expect(can(set, "sales.order", "create", "nte")).toBe(true);
    expect(can(set, "sales.order", "create", "ren")).toBe(true);
    expect(can(set, "sales.order", "create", "ang")).toBe(false);
    expect(can(set, "customer", "view", "nte")).toBe(false);
  });

  it("without a site, answers 'allowed somewhere'", () => {
    expect(can(set, "sales.order", "create")).toBe(true);
    expect(can(set, "sales.order", "delete")).toBe(false);
  });

  it("all-sites grants apply everywhere", () => {
    expect(can(set, "dashboard", "view", "anything")).toBe(true);
  });

  it("an all-sites grant wins over site grants regardless of order", () => {
    const s = buildPermissionSet([
      { siteId: null, permissions: [{ resource: "vehicle", action: "view" }] },
      { siteId: "nte", permissions: [{ resource: "vehicle", action: "view" }] },
    ]);
    expect(s.get("vehicle:view")).toBe("ALL");
  });

  it("computes accessible sites", () => {
    expect(accessibleSiteIds([{ siteId: "a", permissions: [] }, { siteId: "b", permissions: [] }])).toEqual(["a", "b"]);
    expect(accessibleSiteIds([{ siteId: "a", permissions: [] }, { siteId: null, permissions: [] }])).toBe("ALL");
  });
});

describe("default role matrix", () => {
  const perms = (role: (typeof ROLE_KEYS)[number]) =>
    new Set(flattenGrants(DEFAULT_ROLE_MATRIX[role]).map((g) => `${g.resource}:${g.action}`));

  it("defines all ten roles", () => {
    expect(ROLE_KEYS).toHaveLength(10);
    for (const r of ROLE_KEYS) expect(DEFAULT_ROLE_MATRIX[r]).toBeDefined();
  });

  it("gives Admin every permission", () => {
    expect(perms("ADMIN").size).toBe(ALL_RESOURCES.length * ACTIONS.length);
  });

  it("only uses known resources", () => {
    for (const r of ROLE_KEYS) {
      for (const g of flattenGrants(DEFAULT_ROLE_MATRIX[r])) expect(ALL_RESOURCES).toContain(g.resource);
    }
  });

  it("lets every role see the dashboard", () => {
    for (const r of ROLE_KEYS) expect(perms(r).has("dashboard:view")).toBe(true);
  });

  it("separates duties", () => {
    expect(perms("SALESPERSON").has("sales.order:validate")).toBe(false);
    expect(perms("SALES_MANAGER").has("sales.order:validate")).toBe(true);
    expect(perms("TECHNICIAN").has("accounting.entry:view")).toBe(false);
    expect(perms("TECHNICIAN").has("workshop.clocking:create")).toBe(true);
    expect(perms("ACCOUNTANT").has("accounting.period:validate")).toBe(true);
    expect(perms("ACCOUNTANT").has("sales.order:create")).toBe(false);
    expect(perms("PARTS_ADVISOR").has("parts.inventory:validate")).toBe(false);
    expect(perms("SERVICE_ADVISOR").has("admin.user:view")).toBe(false);
  });
});
