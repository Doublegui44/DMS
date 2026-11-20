import { on } from "@/lib/events";
import { buildStockMovementEntry } from "./domain/entry";
import { postEntry } from "./services/posting";

/**
 * Accounting subscribers (D-031). Vehicle stock movements published by core become 37x / 603x
 * entries in the same transaction, so the GL stock accounts always equal the stock sub-ledger.
 */
export function registerAccountingHandlers(): void {
  on("VehicleStockMoved", async (ctx, e) => {
    const p = e.payload;
    await postEntry(
      ctx,
      buildStockMovementEntry({
        siteId: p.siteId,
        date: ctx.businessDate,
        stockType: p.stockType,
        movement: p.movement,
        amountCents: p.amountCents,
        label: p.label,
        sourceType: p.sourceType,
        sourceId: p.sourceId,
      }),
      { brandId: p.brandId },
    );
  });
}
