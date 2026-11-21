/** Stock value report: VN, VO and parts sub-ledgers per site, reconciled with 371 / 372 / 373. */
import type { ServiceContext } from "@/lib/context";
import { getAccountBalancesBySite } from "@/modules/accounting";
import { vehicleStockLedger } from "@/modules/core";
import { partsStockLedger } from "@/modules/parts";

export const STOCK_ACCOUNTS = { VN: "371", VO: "372", PARTS: "373" } as const;
export type StockKind = keyof typeof STOCK_ACCOUNTS;

export async function getStockValueReport(ctx: ServiceContext) {
  ctx.require("accounting.report", "view");
  const sites = await ctx.tx.site.findMany({
    where: ctx.actor.siteIds === "ALL" ? {} : { id: { in: ctx.actor.siteIds } },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  const [vehicles, parts, gl] = await Promise.all([
    vehicleStockLedger(ctx.tx),
    ctx.can("parts.stock", "view") ? partsStockLedger(ctx) : Promise.resolve(null),
    getAccountBalancesBySite(ctx, { prefixes: Object.values(STOCK_ACCOUNTS) }),
  ]);
  const glOf = (siteId: string, kind: StockKind) => gl.find((g) => g.siteId === siteId && g.prefix === STOCK_ACCOUNTS[kind])?.balanceCents ?? 0;

  const rows = sites.map((s) => {
    const line = (kind: StockKind) => {
      const sub =
        kind === "PARTS"
          ? parts
            ? { count: parts.find((p) => p.siteId === s.id)?.items ?? 0, valueCents: parts.find((p) => p.siteId === s.id)?.valueCents ?? 0 }
            : null
          : (() => {
              const v = vehicles.find((x) => x.siteId === s.id && x.stockType === kind);
              return { count: v?.count ?? 0, valueCents: v?.valueCents ?? 0 };
            })();
      const glCents = glOf(s.id, kind);
      return { kind, account: STOCK_ACCOUNTS[kind], count: sub?.count ?? null, subLedgerCents: sub?.valueCents ?? null, glCents, differenceCents: sub ? glCents - sub.valueCents : null };
    };
    return { site: s, lines: [line("VN"), line("VO"), line("PARTS")] };
  });
  const totals = (["VN", "VO", "PARTS"] as const).map((kind) => {
    const ls = rows.map((r) => r.lines.find((l) => l.kind === kind)!);
    const known = ls.every((l) => l.subLedgerCents !== null);
    return {
      kind,
      account: STOCK_ACCOUNTS[kind],
      count: known ? ls.reduce((t, l) => t + (l.count ?? 0), 0) : null,
      subLedgerCents: known ? ls.reduce((t, l) => t + (l.subLedgerCents ?? 0), 0) : null,
      glCents: ls.reduce((t, l) => t + l.glCents, 0),
      differenceCents: known ? ls.reduce((t, l) => t + (l.differenceCents ?? 0), 0) : null,
    };
  });
  return { asOf: ctx.businessDate, rows, totals, reconciled: totals.every((t) => t.differenceCents === null || t.differenceCents === 0) };
}
