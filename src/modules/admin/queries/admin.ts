import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { orderBy, pageArgs, type ListParams } from "@/lib/list";

export async function listUsers(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("admin.user", "view");
  const w: Prisma.UserWhereInput = {};
  if (p.q) {
    w.OR = [
      { email: { contains: p.q, mode: "insensitive" } },
      { firstName: { contains: p.q, mode: "insensitive" } },
      { lastName: { contains: p.q, mode: "insensitive" } },
    ];
  }
  if (p.filters.role) w.roles = { some: { role: { key: p.filters.role } } };
  if (p.filters.site) w.roles = { some: { OR: [{ siteId: p.filters.site }, { siteId: null }] } };
  if (p.filters.active) w.active = p.filters.active === "true";
  const [rows, total] = await Promise.all([
    ctx.tx.user.findMany({
      where: w,
      orderBy: orderBy(p, ["lastName", "email", "createdAt"] as const, "lastName"),
      ...pageArgs(p, opts.all),
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        active: true,
        isTechnician: true,
        roles: { select: { role: { select: { key: true, name: true } }, site: { select: { code: true } } } },
      },
    }),
    ctx.tx.user.count({ where: w }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getPermissionMatrix(ctx: ServiceContext) {
  ctx.require("admin.role", "view");
  const [roles, permissions] = await Promise.all([
    ctx.tx.role.findMany({ orderBy: { name: "asc" }, include: { permissions: true, _count: { select: { users: true } } } }),
    ctx.tx.permission.findMany(),
  ]);
  const byId = new Map(permissions.map((p) => [p.id, `${p.resource}:${p.action}`]));
  return roles.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    userCount: r._count.users,
    granted: new Set(r.permissions.map((rp) => byId.get(rp.permissionId)!)),
  }));
}

export async function listAuditLog(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("admin.audit", "view");
  const w: Prisma.AuditLogWhereInput = {};
  if (p.q) {
    w.OR = [
      { action: { contains: p.q, mode: "insensitive" } },
      { entityType: { contains: p.q, mode: "insensitive" } },
      { entityId: { contains: p.q } },
    ];
  }
  if (p.filters.entityType) w.entityType = p.filters.entityType;
  if (p.filters.user) w.userId = p.filters.user;
  if (ctx.actor.siteIds !== "ALL") w.AND = [{ OR: [{ siteId: { in: ctx.actor.siteIds } }, { siteId: null }] }];
  const [rows, total] = await Promise.all([
    ctx.tx.auditLog.findMany({
      where: w,
      orderBy: orderBy(p, ["at", "action", "entityType"] as const, "at"),
      ...pageArgs(p, opts.all),
      include: { user: { select: { firstName: true, lastName: true } }, site: { select: { code: true } } },
    }),
    ctx.tx.auditLog.count({ where: w }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}
