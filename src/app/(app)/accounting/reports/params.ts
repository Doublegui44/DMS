import { isoDate } from "@/lib/dates";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const valid = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

/** Report range from the URL, by default the fiscal year to date. */
export function rangeFrom(sp: Record<string, string | string[] | undefined>, today: Date) {
  const from = valid(one(sp.from)) ?? `${today.getUTCFullYear()}-01-01`;
  const to = valid(one(sp.to)) ?? isoDate(today);
  return { from, to, site: one(sp.site) ?? "", range: { from: new Date(from), to: new Date(to), siteId: one(sp.site) || null } };
}

/** A month from `?period=YYYY-MM`, by default the business month. */
export function periodFrom(sp: Record<string, string | string[] | undefined>, today: Date) {
  const raw = one(sp.period);
  const m = raw && /^(\d{4})-(\d{2})$/.exec(raw);
  const year = m ? Number(m[1]) : today.getUTCFullYear();
  const month = m ? Math.min(12, Math.max(1, Number(m[2]))) : today.getUTCMonth() + 1;
  return { year, month, period: `${year}-${String(month).padStart(2, "0")}`, site: one(sp.site) ?? "" };
}
