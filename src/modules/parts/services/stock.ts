/** Parts stock: bins and min/max levels, transfers between sites. */
import type { ServiceContext } from "@/lib/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { nextDocumentNumber } from "@/modules/core";
import { Decimal } from "../domain/valuation";
import { stockLevelsInputSchema, transferInputSchema, type StockLevelsInput, type TransferInput } from "../schemas/parts";
import { availableAt, moveStock, partByNumber, postStockValue, requireUnits, siteCode } from "./shared";

/** Bin and replenishment levels of a part at a site (the stock item is created if the site never held it). */
export async function setStockLevels(ctx: ServiceContext, input: StockLevelsInput) {
  const data = parseInput(stockLevelsInputSchema, input);
  ctx.require("parts.stock", "edit", data.siteId);
  const part = await ctx.tx.part.findUnique({ where: { id: data.partId }, select: { id: true } });
  if (!part) throw new NotFoundError("Part", data.partId);
  const before = await ctx.tx.stockItem.findUnique({ where: { partId_siteId: { partId: data.partId, siteId: data.siteId } } });
  const levels = { bin: data.bin ?? null, minQty: data.minQty, maxQty: data.maxQty };
  const item = await ctx.tx.stockItem.upsert({
    where: { partId_siteId: { partId: data.partId, siteId: data.siteId } },
    create: { partId: data.partId, siteId: data.siteId, ...levels },
    update: levels,
  });
  await ctx.audit({
    action: "stock.levels",
    entityType: "StockItem",
    entityId: item.id,
    before: before ? { bin: before.bin, minQty: before.minQty, maxQty: before.maxQty } : null,
    after: levels,
    siteId: data.siteId,
  });
  return item;
}

/**
 * Move parts from one site to another in one step. Units leave the sending site at its PMP and
 * enter the receiving one at that value; each site posts its stock against the liaison account,
 * which nets to zero across the group.
 */
export async function transferStock(ctx: ServiceContext, input: TransferInput) {
  const data = parseInput(transferInputSchema, input);
  ctx.require("parts.stock", "edit", data.fromSiteId);
  const to = await ctx.tx.site.findUnique({ where: { id: data.toSiteId } });
  if (!to) throw new ValidationError("Unknown site", { toSiteId: ["Choose a site"] });
  const number = await nextDocumentNumber(ctx, { docType: "STOCK_TRANSFER", scope: data.fromSiteId, sitePrefix: await siteCode(ctx.tx, data.fromSiteId) });
  const transfer = await ctx.tx.stockTransfer.create({
    data: {
      number,
      fromSiteId: data.fromSiteId,
      toSiteId: data.toSiteId,
      transferredOn: ctx.businessDate,
      valueCents: 0,
      notes: data.notes ?? null,
      createdById: ctx.actor.userId,
    },
  });
  // Lines on the same part are merged so availability is checked on the total.
  const merged = new Map<string, { part: Awaited<ReturnType<typeof partByNumber>>; qty: Decimal; index: number }>();
  for (const [index, line] of data.lines.entries()) {
    const part = await partByNumber(ctx.tx, line.partNumber, `lines.${index}.partNumber`);
    const prev = merged.get(part.id);
    merged.set(part.id, { part, qty: (prev?.qty ?? new Decimal(0)).plus(line.qty), index: prev?.index ?? index });
  }
  let total = 0;
  for (const { part, qty, index } of merged.values()) {
    requireUnits(part, qty, `lines.${index}.qty`);
    const free = await availableAt(ctx.tx, part.id, data.fromSiteId);
    if (qty.gt(free)) throw new ValidationError(`Only ${free.toString()} of ${part.partNumber} free to transfer`, { [`lines.${index}.qty`]: [`${free.toString()} available`] });
    const out = (await moveStock(ctx, {
      siteId: data.fromSiteId,
      partId: part.id,
      kind: "TRANSFER_OUT",
      change: { out: qty },
      sourceType: "STOCK_TRANSFER",
      sourceId: transfer.id,
      reference: number,
    }))!;
    const value = -out.valueCents;
    await moveStock(ctx, {
      siteId: data.toSiteId,
      partId: part.id,
      kind: "TRANSFER_IN",
      change: { in: qty, valueCents: value },
      sourceType: "STOCK_TRANSFER",
      sourceId: transfer.id,
      reference: number,
    });
    await ctx.tx.stockTransferLine.create({
      data: { transferId: transfer.id, partId: part.id, qty: qty.toFixed(3), unitCostCents: out.unitCostCents.toFixed(4), valueCents: value },
    });
    total += value;
  }
  const label = `Parts transfer ${number} to ${to.code}`;
  await postStockValue(ctx, { siteId: data.fromSiteId, valueCents: -total, counterpart: "LIAISON", label, sourceType: "STOCK_TRANSFER", sourceId: transfer.id });
  await postStockValue(ctx, { siteId: data.toSiteId, valueCents: total, counterpart: "LIAISON", label, sourceType: "STOCK_TRANSFER", sourceId: transfer.id });
  const saved = await ctx.tx.stockTransfer.update({ where: { id: transfer.id }, data: { valueCents: total } });
  await ctx.audit({ action: "stock.transfer", entityType: "StockTransfer", entityId: transfer.id, after: { number, to: to.code, lines: data.lines, valueCents: total }, siteId: data.fromSiteId });
  return saved;
}
