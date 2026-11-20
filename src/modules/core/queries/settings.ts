import type { Tx } from "@/lib/db";

/**
 * Read a setting: the site-specific value wins over the group default (siteId = null);
 * `fallback` applies when neither exists (tests, fresh databases). Object settings are merged
 * fallback ← group ← site, so a partial site override keeps the group values.
 */
export async function getSetting<T>(tx: Tx, key: string, siteId: string | null, fallback: T): Promise<T> {
  const rows = await tx.setting.findMany({ where: { key, OR: [{ siteId }, { siteId: null }] } });
  const group = rows.find((r) => r.siteId === null)?.value ?? undefined;
  const site = siteId ? (rows.find((r) => r.siteId === siteId)?.value ?? undefined) : undefined;
  if (isPlainObject(fallback)) {
    return { ...fallback, ...(isPlainObject(group) ? group : {}), ...(isPlainObject(site) ? site : {}) } as T;
  }
  const value = site ?? group;
  return value === undefined || value === null ? fallback : (value as T);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
