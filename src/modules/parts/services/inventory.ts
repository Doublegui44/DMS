/** Cycle counts: a list of items to count, the counted quantities, the variance posted. */
import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { nextDocumentNumber } from "@/modules/core";
import { dec, Decimal } from "../domain/valuation";
import { countEntriesInputSchema, cycleCountInputSchema, type CountEntriesInput, type CycleCountInput } from "../schemas/parts";
import { moveStock, postStockValue, requireUnits, siteCode } from "./shared";

/**
 * Open a count on the items of a site that were counted longest ago (optionally one family or a
 * range of bins). Items already on an open count are left out.
 */
export async function createCycleCount(ctx: ServiceContext, input: CycleCountInput) {
  const data = parseInput(cycleCountInputSchema, input);
  ctx.require("parts.inventory", "create", data.siteId);
  const where: Prisma.StockItemWhereInput = {
    siteId: data.siteId,
    OR: [{ qtyOnHand: { gt: 0 } }, { minQty: { gt: 0 } }],
    countLines: { none: { count: { status: "OPEN" } } },
    ...(data.family ? { part: { family: data.family } } : {}),
    ...(data.binPrefix ? { bin: { startsWith: data.binPrefix } } : {}),
  };
  const items = await ctx.tx.stockItem.findMany({
    where,
    orderBy: [{ lastCountedOn: { sort: "asc", nulls: "first" } }, { bin: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    take: data.limit,
  });
  if (!items.length) throw new ValidationError("No stock item matches these filters", { family: ["Nothing to count"] });
  const number = await nextDocumentNumber(ctx, { docType: "CYCLE_COUNT", scope: data.siteId, sitePrefix: await siteCode(ctx.tx, data.siteId) });
  const count = await ctx.tx.cycleCount.create({
    data: {
      number,
      siteId: data.siteId,
      label: data.label,
      createdOn: ctx.businessDate,
      createdById: ctx.actor.userId,
      lines: { create: items.map((i) => ({ stockItemId: i.id, expectedQty: i.qtyOnHand })) },
    },
  });
  await ctx.audit({ action: "cycle_count.create", entityType: "CycleCount", entityId: count.id, after: { ...data, number, items: items.length }, siteId: data.siteId });
  return count;
}

async function openCount(ctx: ServiceContext, id: string, action: "edit" | "validate") {
  const count = await ctx.tx.cycleCount.findUnique({ where: { id }, include: { lines: { include: { stockItem: { include: { part: true } } } } } });
  if (!count) throw new NotFoundError("CycleCount", id);
  ctx.require("parts.inventory", action, count.siteId);
  if (count.status !== "OPEN") throw new ConflictError(`Count ${count.number} is ${count.status.toLowerCase()}`);
  return count;
}

/** Enter (or clear) counted quantities; nothing moves until the count is posted. */
export async function recordCounts(ctx: ServiceContext, countId: string, input: CountEntriesInput) {
  const data = parseInput(countEntriesInputSchema, input);
  const count = await openCount(ctx, countId, "edit");
  const byId = new Map(count.lines.map((l) => [l.id, l]));
  for (const [index, entry] of data.lines.entries()) {
    const line = byId.get(entry.lineId);
    if (!line) throw new NotFoundError("CycleCountLine", entry.lineId);
    if (entry.countedQty !== null) requireUnits(line.stockItem.part, new Decimal(entry.countedQty), `lines.${index}.countedQty`);
    await ctx.tx.cycleCountLine.update({ where: { id: line.id }, data: { countedQty: entry.countedQty } });
  }
  await ctx.audit({ action: "cycle_count.record", entityType: "CycleCount", entityId: countId, after: { lines: data.lines.filter((l) => l.countedQty !== null).length }, siteId: count.siteId });
}

/**
 * Post the count: every counted quantity replaces the book quantity at that moment (counts are
 * posted the day they are made). Shortfalls leave at PMP, surpluses enter at PMP (or list cost);
 * the net variance is posted to stock variation (Dr/Cr 373000 against 603730).
 */
export async function postCycleCount(ctx: ServiceContext, countId: string) {
  const count = await openCount(ctx, countId, "validate");
  const missing = count.lines.filter((l) => l.countedQty === null);
  if (missing.length) {
    throw new ValidationError(`${missing.length} item(s) not counted yet: ${missing.slice(0, 5).map((l) => l.stockItem.part.partNumber).join(", ")}`, { lines: ["Count every item"] });
  }
  let variance = 0;
  for (const line of count.lines) {
    const counted = dec(line.countedQty);
    const moved = await moveStock(ctx, {
      siteId: count.siteId,
      partId: line.stockItem.partId,
      kind: "ADJUSTMENT",
      change: { countedTo: counted, fallbackCostCents: line.stockItem.part.listCostCents },
      sourceType: "CYCLE_COUNT",
      sourceId: count.id,
      reference: count.number,
    });
    await ctx.tx.cycleCountLine.update({
      where: { id: line.id },
      data: { varianceQty: (moved?.qty ?? new Decimal(0)).toFixed(3), varianceValueCents: moved?.valueCents ?? 0 },
    });
    await ctx.tx.stockItem.update({ where: { id: line.stockItemId }, data: { lastCountedOn: ctx.businessDate } });
    variance += moved?.valueCents ?? 0;
  }
  await postStockValue(ctx, { siteId: count.siteId, valueCents: variance, label: `Stock count ${count.number} — ${count.label}`, sourceType: "CYCLE_COUNT", sourceId: count.id });
  const saved = await ctx.tx.cycleCount.update({
    where: { id: countId },
    data: { status: "POSTED", postedOn: ctx.businessDate, postedById: ctx.actor.userId, varianceValueCents: variance },
  });
  await ctx.audit({ action: "cycle_count.post", entityType: "CycleCount", entityId: countId, after: { varianceValueCents: variance, lines: count.lines.length }, siteId: count.siteId });
  return saved;
}

export async function cancelCycleCount(ctx: ServiceContext, countId: string) {
  const count = await openCount(ctx, countId, "edit");
  const saved = await ctx.tx.cycleCount.update({ where: { id: countId }, data: { status: "CANCELLED" } });
  await ctx.audit({ action: "cycle_count.cancel", entityType: "CycleCount", entityId: countId, before: { status: count.status }, after: { status: "CANCELLED" }, siteId: count.siteId });
  return saved;
}
