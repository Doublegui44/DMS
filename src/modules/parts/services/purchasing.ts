/** Parts purchasing: suggested orders, purchase orders, goods receipts (GRNI accrual and stock entry). */
import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import type { Tx } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { buildPurchaseEntry, postEntry } from "@/modules/accounting";
import { nextDocumentNumber } from "@/modules/core";
import { backorderQty, purchaseOrderStatus, suggestedQty } from "../domain/purchasing";
import { dec, Decimal, valueOf } from "../domain/valuation";
import {
  purchaseLineInputSchema,
  purchaseOrderInputSchema,
  receiptInputSchema,
  suggestedOrdersInputSchema,
  type PurchaseLineInput,
  type PurchaseOrderInput,
  type ReceiptInput,
  type SuggestedOrdersInput,
} from "../schemas/parts";
import { currentPart, moveStock, partByNumber, partsSettings, postStockValue, requireUnits, siteCode } from "./shared";

declare module "@/lib/events" {
  interface DomainEventMap {
    PurchaseOrderSent: { purchaseOrderId: string; number: string; supplierId: string; kind: "STOCK" | "EMERGENCY" };
    GoodsReceived: { receiptId: string; number: string; purchaseOrderId: string; valueCents: number };
  }
}

const OPEN_ORDER: Prisma.PurchaseOrderWhereInput["status"] = { in: ["DRAFT", "SENT", "PARTIAL"] };

/** Units already on order per part at a site: draft and sent orders, minus what was received. */
export async function onOrderByPart(tx: Tx, siteId: string, partIds?: string[]): Promise<Map<string, Decimal>> {
  const lines = await tx.purchaseOrderLine.findMany({
    where: { purchaseOrder: { siteId, status: OPEN_ORDER }, ...(partIds ? { partId: { in: partIds } } : {}) },
    select: { partId: true, qtyOrdered: true, qtyReceived: true },
  });
  const out = new Map<string, Decimal>();
  for (const l of lines) out.set(l.partId, (out.get(l.partId) ?? new Decimal(0)).plus(backorderQty({ ordered: l.qtyOrdered, received: l.qtyReceived })));
  return out;
}

/**
 * Replenishment suggestions at a site: items whose available stock plus what is on order is under
 * their minimum, ordered back up to their maximum from the part's usual supplier at list cost.
 * Superseded parts are left out: their successor carries the levels.
 */
export async function replenishmentSuggestions(tx: Tx, siteId: string, today: Date, stockItemIds?: string[]) {
  const items = await tx.stockItem.findMany({
    where: {
      siteId,
      minQty: { gt: 0 },
      ...(stockItemIds?.length ? { id: { in: stockItemIds } } : {}),
      part: { active: true, OR: [{ replacedBy: null }, { replacedBy: { effectiveOn: { gt: today } } }] },
    },
    include: { part: { include: { supplier: { select: { id: true, name: true, isOem: true } } } } },
  });
  const onOrder = await onOrderByPart(tx, siteId);
  const rows = [];
  for (const item of items) {
    const ordered = onOrder.get(item.partId) ?? new Decimal(0);
    const qty = suggestedQty({ onHand: item.qtyOnHand, reserved: item.qtyReserved, onOrder: ordered, min: item.minQty, max: item.maxQty });
    if (qty.lte(0)) continue;
    rows.push({
      stockItemId: item.id,
      part: item.part,
      bin: item.bin,
      onHand: dec(item.qtyOnHand),
      reserved: dec(item.qtyReserved),
      onOrder: ordered,
      min: dec(item.minQty),
      max: dec(item.maxQty),
      qty,
      unitCostCents: item.part.listCostCents,
      valueCents: valueOf(qty, item.part.listCostCents),
    });
  }
  return rows.sort((a, b) => a.part.supplier.name.localeCompare(b.part.supplier.name) || a.part.partNumber.localeCompare(b.part.partNumber));
}

async function newOrder(ctx: ServiceContext, a: { siteId: string; supplierId: string; kind: "STOCK" | "EMERGENCY"; expectedOn?: Date | null; notes?: string | null }) {
  const supplier = await ctx.tx.supplier.findUnique({ where: { id: a.supplierId }, select: { id: true } });
  if (!supplier) throw new ValidationError("Unknown supplier", { supplierId: ["Choose a supplier"] });
  const number = await nextDocumentNumber(ctx, { docType: "PURCHASE_ORDER", scope: a.siteId, sitePrefix: await siteCode(ctx.tx, a.siteId) });
  return ctx.tx.purchaseOrder.create({
    data: {
      number,
      siteId: a.siteId,
      supplierId: a.supplierId,
      kind: a.kind,
      createdOn: ctx.businessDate,
      expectedOn: a.expectedOn ?? null,
      notes: a.notes ?? null,
      createdById: ctx.actor.userId,
    },
  });
}

/** Draft one stock order per supplier from the suggestions (all of them, or the selected items). */
export async function createSuggestedOrders(ctx: ServiceContext, input: SuggestedOrdersInput) {
  const data = parseInput(suggestedOrdersInputSchema, input);
  ctx.require("parts.purchase_order", "create", data.siteId);
  const rows = await replenishmentSuggestions(ctx.tx, data.siteId, ctx.businessDate, data.stockItemIds);
  if (!rows.length) throw new ConflictError("Nothing to order: every item is above its minimum or already on order");
  const bySupplier = new Map<string, typeof rows>();
  for (const r of rows) bySupplier.set(r.part.supplierId, [...(bySupplier.get(r.part.supplierId) ?? []), r]);
  const orders = [];
  for (const [supplierId, lines] of bySupplier) {
    const po = await newOrder(ctx, { siteId: data.siteId, supplierId, kind: "STOCK", notes: "Suggested from minimum stock levels" });
    await ctx.tx.purchaseOrderLine.createMany({
      data: lines.map((l, i) => ({ purchaseOrderId: po.id, lineNo: i + 1, partId: l.part.id, qtyOrdered: l.qty.toFixed(3), unitCostCents: l.unitCostCents })),
    });
    await ctx.audit({ action: "purchase_order.suggest", entityType: "PurchaseOrder", entityId: po.id, after: { number: po.number, lines: lines.length }, siteId: data.siteId });
    orders.push(po);
  }
  return orders;
}

/** A purchase order typed by hand (stock or emergency), with or without its first lines. */
export async function createPurchaseOrder(ctx: ServiceContext, input: PurchaseOrderInput) {
  const data = parseInput(purchaseOrderInputSchema, input);
  ctx.require("parts.purchase_order", "create", data.siteId);
  const po = await newOrder(ctx, data);
  for (const line of data.lines) await addLine(ctx, po.id, line);
  await ctx.audit({ action: "purchase_order.create", entityType: "PurchaseOrder", entityId: po.id, after: { ...data, number: po.number }, siteId: data.siteId });
  return po;
}

async function draftOrder(ctx: ServiceContext, id: string) {
  const po = await ctx.tx.purchaseOrder.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  if (!po) throw new NotFoundError("PurchaseOrder", id);
  ctx.require("parts.purchase_order", "edit", po.siteId);
  if (po.status !== "DRAFT") throw new ConflictError(`Order ${po.number} is already ${po.status.toLowerCase()}`);
  return po;
}

/** Add a part to a draft order (a superseded number is replaced; the same part adds up on its line). */
async function addLine(ctx: ServiceContext, purchaseOrderId: string, input: PurchaseLineInput) {
  const line = parseInput(purchaseLineInputSchema, input);
  const asked = await partByNumber(ctx.tx, line.partNumber);
  const { part } = await currentPart(ctx.tx, asked, ctx.businessDate);
  if (!part.active) throw new ValidationError(`${part.partNumber} is no longer active`, { partNumber: ["Inactive part"] });
  const qty = new Decimal(line.qty);
  requireUnits(part, qty);
  const existing = await ctx.tx.purchaseOrderLine.findFirst({ where: { purchaseOrderId, partId: part.id } });
  if (existing) {
    return ctx.tx.purchaseOrderLine.update({
      where: { id: existing.id },
      data: { qtyOrdered: dec(existing.qtyOrdered).plus(qty).toFixed(3), ...(line.unitCostCents !== undefined ? { unitCostCents: line.unitCostCents } : {}) },
    });
  }
  const last = await ctx.tx.purchaseOrderLine.aggregate({ where: { purchaseOrderId }, _max: { lineNo: true } });
  return ctx.tx.purchaseOrderLine.create({
    data: { purchaseOrderId, lineNo: (last._max.lineNo ?? 0) + 1, partId: part.id, qtyOrdered: qty.toFixed(3), unitCostCents: line.unitCostCents ?? part.listCostCents },
  });
}

export async function addPurchaseOrderLine(ctx: ServiceContext, purchaseOrderId: string, input: PurchaseLineInput) {
  const po = await draftOrder(ctx, purchaseOrderId);
  const line = await addLine(ctx, po.id, input);
  await ctx.audit({ action: "purchase_order.add_line", entityType: "PurchaseOrder", entityId: po.id, after: input, siteId: po.siteId });
  return line;
}

export async function removePurchaseOrderLine(ctx: ServiceContext, purchaseOrderId: string, lineId: string) {
  const po = await draftOrder(ctx, purchaseOrderId);
  const line = po.lines.find((l) => l.id === lineId);
  if (!line) throw new NotFoundError("PurchaseOrderLine", lineId);
  await ctx.tx.purchaseOrderLine.delete({ where: { id: lineId } });
  await ctx.audit({ action: "purchase_order.remove_line", entityType: "PurchaseOrder", entityId: po.id, before: line, siteId: po.siteId });
}

/** Send a draft order to the supplier; the expected date follows the site's lead time. */
export async function sendPurchaseOrder(ctx: ServiceContext, purchaseOrderId: string) {
  const po = await draftOrder(ctx, purchaseOrderId);
  if (!po.lines.length) throw new ConflictError("Add at least one line before sending the order");
  const { leadTimeDays } = await partsSettings(ctx.tx, po.siteId);
  const updated = await ctx.tx.purchaseOrder.update({
    where: { id: po.id },
    data: { status: "SENT", sentOn: ctx.businessDate, expectedOn: po.expectedOn ?? addDays(ctx.businessDate, leadTimeDays[po.kind]) },
  });
  await ctx.audit({ action: "purchase_order.send", entityType: "PurchaseOrder", entityId: po.id, before: { status: po.status }, after: { status: "SENT" }, siteId: po.siteId });
  await ctx.emit({
    type: "PurchaseOrderSent",
    aggregateType: "PurchaseOrder",
    aggregateId: po.id,
    siteId: po.siteId,
    payload: { purchaseOrderId: po.id, number: po.number, supplierId: po.supplierId, kind: po.kind },
  });
  return updated;
}

/**
 * Receive goods against a sent order. Each line enters stock at the order's unit cost (the PMP is
 * recalculated); the receipt accrues the purchase until the supplier's invoice arrives
 * (Dr 607300 / Cr 408100) and puts the value into parts stock (Dr 373000 / Cr 603730).
 */
export async function receivePurchaseOrder(ctx: ServiceContext, purchaseOrderId: string, input: ReceiptInput) {
  const data = parseInput(receiptInputSchema, input);
  const po = await ctx.tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { lines: { include: { part: true } }, supplier: true } });
  if (!po) throw new NotFoundError("PurchaseOrder", purchaseOrderId);
  ctx.require("parts.purchase_order", "edit", po.siteId);
  if (po.status !== "SENT" && po.status !== "PARTIAL") throw new ConflictError(`Order ${po.number} is ${po.status.toLowerCase()}: nothing to receive`);

  const number = await nextDocumentNumber(ctx, { docType: "GOODS_RECEIPT", scope: po.siteId, sitePrefix: await siteCode(ctx.tx, po.siteId) });
  const receipt = await ctx.tx.goodsReceipt.create({
    data: {
      number,
      siteId: po.siteId,
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      receivedOn: ctx.businessDate,
      deliveryNote: data.deliveryNote ?? null,
      valueCents: 0,
      createdById: ctx.actor.userId,
    },
  });
  const seen = new Set<string>();
  let total = 0;
  for (const [index, entry] of data.lines.entries()) {
    const line = po.lines.find((l) => l.id === entry.poLineId);
    if (!line) throw new NotFoundError("PurchaseOrderLine", entry.poLineId);
    if (seen.has(line.id)) throw new ValidationError("A line is listed twice", { [`lines.${index}.qty`]: ["Listed twice"] });
    seen.add(line.id);
    const qty = new Decimal(entry.qty);
    requireUnits(line.part, qty, `lines.${index}.qty`);
    const open = backorderQty({ ordered: line.qtyOrdered, received: line.qtyReceived });
    if (qty.gt(open)) throw new ValidationError(`Only ${open.toString()} of ${line.part.partNumber} still expected`, { [`lines.${index}.qty`]: [`At most ${open.toString()}`] });
    const valueCents = valueOf(qty, line.unitCostCents);
    await moveStock(ctx, {
      siteId: po.siteId,
      partId: line.partId,
      kind: "RECEIPT",
      change: { in: qty, valueCents },
      sourceType: "GOODS_RECEIPT",
      sourceId: receipt.id,
      reference: number,
    });
    await ctx.tx.goodsReceiptLine.create({ data: { receiptId: receipt.id, poLineId: line.id, partId: line.partId, qty: qty.toFixed(3), unitCostCents: line.unitCostCents, valueCents } });
    await ctx.tx.purchaseOrderLine.update({ where: { id: line.id }, data: { qtyReceived: dec(line.qtyReceived).plus(qty).toFixed(3) } });
    total += valueCents;
  }

  const label = `Parts receipt ${number} — ${po.supplier.name}`;
  if (total > 0) {
    await postEntry(
      ctx,
      buildPurchaseEntry({
        siteId: po.siteId,
        date: ctx.businessDate,
        label,
        sourceType: "GOODS_RECEIPT",
        sourceId: receipt.id,
        lines: [{ account: { key: "PURCHASE_PARTS" }, amountCents: total, departmentCode: "PARTS" }],
        credit: { account: { key: "GOODS_RECEIVED_NOT_INVOICED" }, partyType: "SUPPLIER", partyId: po.supplierId },
      }),
    );
    await postStockValue(ctx, { siteId: po.siteId, valueCents: total, label, sourceType: "GOODS_RECEIPT", sourceId: receipt.id });
  }
  const lines = await ctx.tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
  const status = purchaseOrderStatus(lines.map((l) => ({ ordered: l.qtyOrdered, received: l.qtyReceived })));
  await ctx.tx.purchaseOrder.update({ where: { id: po.id }, data: { status, ...(status === "RECEIVED" ? { closedOn: ctx.businessDate } : {}) } });
  const saved = await ctx.tx.goodsReceipt.update({ where: { id: receipt.id }, data: { valueCents: total } });
  await ctx.audit({ action: "purchase_order.receive", entityType: "PurchaseOrder", entityId: po.id, after: { receipt: number, lines: data.lines, valueCents: total, status }, siteId: po.siteId });
  await ctx.emit({
    type: "GoodsReceived",
    aggregateType: "PurchaseOrder",
    aggregateId: po.id,
    siteId: po.siteId,
    payload: { receiptId: receipt.id, number, purchaseOrderId: po.id, valueCents: total },
  });
  return saved;
}

/** Stop waiting for the rest of a partly received order (its backorders are cancelled). */
export async function closePurchaseOrder(ctx: ServiceContext, purchaseOrderId: string) {
  const po = await ctx.tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
  if (!po) throw new NotFoundError("PurchaseOrder", purchaseOrderId);
  ctx.require("parts.purchase_order", "edit", po.siteId);
  if (po.status !== "PARTIAL") throw new ConflictError("Only a partly received order can be closed");
  const updated = await ctx.tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "CLOSED", closedOn: ctx.businessDate } });
  await ctx.audit({ action: "purchase_order.close", entityType: "PurchaseOrder", entityId: po.id, before: { status: po.status }, after: { status: "CLOSED" }, siteId: po.siteId });
  return updated;
}

/** Cancel an order nothing was received on (a draft, or a sent order the supplier will not deliver). */
export async function cancelPurchaseOrder(ctx: ServiceContext, purchaseOrderId: string) {
  const po = await ctx.tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
  if (!po) throw new NotFoundError("PurchaseOrder", purchaseOrderId);
  ctx.require("parts.purchase_order", "edit", po.siteId);
  if (po.status !== "DRAFT" && po.status !== "SENT") throw new ConflictError(`Order ${po.number} is ${po.status.toLowerCase()}: close it instead`);
  const updated = await ctx.tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "CANCELLED", closedOn: ctx.businessDate } });
  await ctx.audit({ action: "purchase_order.cancel", entityType: "PurchaseOrder", entityId: po.id, before: { status: po.status }, after: { status: "CANCELLED" }, siteId: po.siteId });
  return updated;
}
