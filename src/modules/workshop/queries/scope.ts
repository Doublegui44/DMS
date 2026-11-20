import type { ServiceContext } from "@/lib/context";
import type { ListParams } from "@/lib/list";

/** Sites the actor can read (null = every site). */
export function allowedSites(ctx: ServiceContext): string[] | null {
  return ctx.actor.siteIds === "ALL" ? null : ctx.actor.siteIds;
}

export function siteWhere(ctx: ServiceContext, p: ListParams | null, field = "siteId"): Record<string, string | { in: string[] }> {
  const sites = allowedSites(ctx);
  const wanted = p?.filters.site;
  if (wanted) return { [field]: !sites || sites.includes(wanted) ? wanted : { in: [] } };
  return sites ? { [field]: { in: sites } } : {};
}

export function dateRange(p: ListParams): { gte?: Date; lte?: Date } | undefined {
  const from = p.filters.from ? new Date(p.filters.from) : undefined;
  const to = p.filters.to ? new Date(p.filters.to) : undefined;
  return from || to ? { gte: from, lte: to } : undefined;
}

/** The site a workshop screen works on: the requested one if allowed, else the active site. */
export async function workshopSite(ctx: ServiceContext, requested?: string | null): Promise<string> {
  const sites = allowedSites(ctx);
  if (requested && (!sites || sites.includes(requested))) return requested;
  if (ctx.siteId && (!sites || sites.includes(ctx.siteId))) return ctx.siteId;
  if (sites?.length) return sites[0];
  const first = await ctx.tx.site.findFirstOrThrow({ orderBy: { code: "asc" }, select: { id: true } });
  return first.id;
}
