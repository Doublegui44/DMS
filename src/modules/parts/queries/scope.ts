/** Site scoping for parts lists: the actor's sites, narrowed by a `site` filter they may see. */
import type { ServiceContext } from "@/lib/context";
import type { ListParams } from "@/lib/list";

/** Sites the actor can read (null = every site). */
export function allowedSites(ctx: ServiceContext): string[] | null {
  return ctx.actor.siteIds === "ALL" ? null : ctx.actor.siteIds;
}

/** `siteId` condition for a list: the requested site when allowed, else every allowed site. */
export function siteWhere(ctx: ServiceContext, p: ListParams, field = "siteId"): Record<string, string | { in: string[] }> {
  const sites = allowedSites(ctx);
  const wanted = p.filters.site;
  if (wanted) return { [field]: !sites || sites.includes(wanted) ? wanted : { in: [] } };
  return sites ? { [field]: { in: sites } } : {};
}

export function dateRange(p: ListParams): { gte?: Date; lte?: Date } | undefined {
  const from = p.filters.from ? new Date(p.filters.from) : undefined;
  const to = p.filters.to ? new Date(p.filters.to) : undefined;
  return from || to ? { gte: from, lte: to } : undefined;
}
