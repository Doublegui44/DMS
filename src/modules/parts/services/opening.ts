/** Seed only: parts stock carried forward at the opening (its value is in the opening entry). */
import type { ServiceContext } from "@/lib/context";
import { DomainError } from "@/lib/errors";
import { addToStock, Decimal, type StockState } from "../domain/valuation";

export interface OpeningStockItem {
  partId: string;
  qty: string | number;
  valueCents: number;
  bin: string | null;
  minQty: string | number;
  maxQty: string | number;
  /** Last movement before the opening (dormant stock is older than the history window). */
  lastMovementOn: Date;
}

const EMPTY: StockState = { qty: new Decimal(0), valueCents: 0, pmpCents: new Decimal(0) };
const CHUNK = 1_000;

/**
 * Create a site's opening stock in bulk: stock items with their levels and an OPENING movement
 * each, and no posting, because the accounting opening entry carries the parts stock account.
 * The site must not hold any parts yet. Returns the total value.
 */
export async function registerOpeningStock(ctx: ServiceContext, a: { siteId: string; items: OpeningStockItem[] }) {
  if (!ctx.actor.isSystem) throw new DomainError("seed_only", "Opening stock is registered by the seed only");
  if (await ctx.tx.stockItem.count({ where: { siteId: a.siteId } })) throw new DomainError("opening_exists", "This site already holds parts stock");
  let total = 0;
  for (let i = 0; i < a.items.length; i += CHUNK) {
    const rows = a.items.slice(i, i + CHUNK).map((item) => {
      const qty = new Decimal(item.qty);
      const move = qty.gt(0) ? addToStock(EMPTY, qty, item.valueCents) : null;
      return { item, move };
    });
    const created = await ctx.tx.stockItem.createManyAndReturn({
      data: rows.map(({ item, move }) => ({
        partId: item.partId,
        siteId: a.siteId,
        bin: item.bin,
        minQty: String(item.minQty),
        maxQty: String(item.maxQty),
        qtyOnHand: move ? move.after.qty.toFixed(3) : "0",
        valueCents: move ? move.after.valueCents : 0,
        pmpCents: move ? move.after.pmpCents.toFixed(4) : "0",
        lastMovementOn: move ? item.lastMovementOn : null,
      })),
      select: { id: true, partId: true },
    });
    const idByPart = new Map(created.map((c) => [c.partId, c.id]));
    await ctx.tx.partMovement.createMany({
      data: rows
        .filter((r) => r.move)
        .map(({ item, move }) => ({
          stockItemId: idByPart.get(item.partId)!,
          partId: item.partId,
          siteId: a.siteId,
          kind: "OPENING" as const,
          qty: move!.after.qty.toFixed(3),
          unitCostCents: move!.unitCostCents.toFixed(4),
          valueCents: move!.valueCents,
          qtyAfter: move!.after.qty.toFixed(3),
          valueAfterCents: move!.after.valueCents,
          pmpAfterCents: move!.after.pmpCents.toFixed(4),
          sourceType: "OPENING",
          sourceId: null,
          reference: "Opening stock",
          businessDate: ctx.businessDate,
          userId: null,
        })),
    });
    total += rows.reduce((s, r) => s + (r.move?.valueCents ?? 0), 0);
  }
  return total;
}
