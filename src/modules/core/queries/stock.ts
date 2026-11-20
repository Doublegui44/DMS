import type { Tx } from "@/lib/db";
import { STOCK_LEDGER_STATUSES } from "../domain/vehicle";

/**
 * Vehicle stock sub-ledger per site and stock type: Σ stock value of the vehicles counted in stock
 * (status in the ledger set and `stockInDate` set). Accounting reconciles it with 371/372.
 */
export async function vehicleStockLedger(tx: Tx, siteId?: string) {
  const rows = await tx.vehicle.groupBy({
    by: ["siteId", "stockType"],
    where: {
      stockType: { in: ["VN", "VO"] },
      status: { in: STOCK_LEDGER_STATUSES },
      stockInDate: { not: null },
      ...(siteId ? { siteId } : {}),
    },
    _sum: { stockValueCents: true },
    _count: true,
  });
  return rows.map((r) => ({
    siteId: r.siteId as string,
    stockType: r.stockType as "VN" | "VO",
    valueCents: r._sum.stockValueCents ?? 0,
    count: r._count,
  }));
}
