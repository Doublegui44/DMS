import type { ServiceContext } from "@/lib/context";

export interface TimelineItem {
  id: string;
  at: Date;
  businessDate: Date;
  kind: "event" | "audit";
  title: string;
  userName: string | null;
  details?: unknown;
}

/** Merge domain events and audit entries for one business object, newest first. */
export async function getTimeline(
  ctx: ServiceContext,
  entityType: string,
  entityId: string,
  take = 50,
): Promise<TimelineItem[]> {
  const [events, audits] = await Promise.all([
    ctx.tx.domainEvent.findMany({
      where: { aggregateType: entityType, aggregateId: entityId },
      orderBy: { createdAt: "desc" },
      take,
    }),
    ctx.tx.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { at: "desc" },
      take,
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  const userIds = [...new Set(events.map((e) => e.userId).filter((x): x is string => !!x))];
  const users = userIds.length
    ? await ctx.tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const userName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

  const items: TimelineItem[] = [
    ...events.map((e) => ({
      id: e.id,
      at: e.createdAt,
      businessDate: e.businessDate,
      kind: "event" as const,
      title: e.type,
      userName: e.userId ? userName.get(e.userId) ?? null : "System",
      details: e.payload,
    })),
    ...audits.map((a) => ({
      id: a.id,
      at: a.at,
      businessDate: a.businessDate,
      kind: "audit" as const,
      title: a.action,
      userName: a.user ? `${a.user.firstName} ${a.user.lastName}` : "System",
      details: a.after,
    })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take);
}
