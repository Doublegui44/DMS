/** Shared list-view parameters (URL search params ⇄ query). */

export interface ListParams {
  q: string;
  page: number;
  pageSize: number;
  sort: string | null;
  dir: "asc" | "desc";
  filters: Record<string, string>;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type SearchParams = Record<string, string | string[] | undefined>;

const RESERVED = new Set(["q", "page", "pageSize", "sort", "dir"]);

export function parseListParams(sp: SearchParams, defaults: Partial<ListParams> = {}): ListParams {
  const get = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const filters: Record<string, string> = { ...(defaults.filters ?? {}) };
  for (const [k, v] of Object.entries(sp)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (!RESERVED.has(k) && value) filters[k] = value;
  }
  const pageSize = Math.min(Math.max(Number(get("pageSize")) || defaults.pageSize || 25, 5), 200);
  return {
    q: (get("q") ?? "").trim(),
    page: Math.max(Number(get("page")) || 1, 1),
    pageSize,
    sort: get("sort") ?? defaults.sort ?? null,
    dir: get("dir") === "asc" ? "asc" : get("dir") === "desc" ? "desc" : defaults.dir ?? "desc",
    filters,
  };
}

/** Prisma skip/take for a page; `all` disables paging (CSV export). */
export function pageArgs(p: ListParams, all = false): { skip?: number; take?: number } {
  return all ? {} : { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

/** Pick a whitelisted sort column; returns a Prisma orderBy. */
export function orderBy<K extends string>(
  p: ListParams,
  allowed: readonly K[],
  fallback: K,
): Record<string, "asc" | "desc"> {
  const key = (allowed as readonly string[]).includes(p.sort ?? "") ? (p.sort as K) : fallback;
  return { [key]: p.dir };
}
