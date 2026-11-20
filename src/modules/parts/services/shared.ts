/** Helpers shared by the parts services: settings, part lookup, the stock ledger and its postings. */
import type { Part, PartMovementKind } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import type { Tx } from "@/lib/db";
import { DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { buildPartsStockEntry, postEntry } from "@/modules/accounting";
import { getSetting } from "@/modules/core";
import { normalisePartNumber, resolveReplacement } from "../domain/catalogue";
import { DEFAULT_TOLERANCE, type InvoiceTolerance } from "../domain/purchasing";
import { addToStock, adjustTo, dec, Decimal, stockState, takeFromStock } from "../domain/valuation";

export interface PartsSettings {
  invoiceTolerance: InvoiceTolerance;
  /** Days between sending an order and the expected delivery. */
  leadTimeDays: { STOCK: number; EMERGENCY: number };
}

export async function partsSettings(tx: Tx, siteId: string | null): Promise<PartsSettings> {
  return {
    invoiceTolerance: await getSetting(tx, "parts.invoiceTolerance", siteId, DEFAULT_TOLERANCE),
    leadTimeDays: await getSetting(tx, "parts.leadTimeDays", siteId, { STOCK: 2, EMERGENCY: 1 }),
  };
}

/** Rate of a VAT code in the site's country on a date. */
export async function vatRateBp(tx: Tx, siteId: string, code: string, date: Date): Promise<number> {
  const site = await tx.site.findUnique({ where: { id: siteId } });
  if (!site) throw new NotFoundError("Site", siteId);
  const rate = await tx.vatRate.findFirst({
    where: { countryCode: site.countryCode, code, validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
    orderBy: { validFrom: "desc" },
  });
  if (!rate) throw new DomainError("unknown_vat_rate", `No ${code} VAT rate is configured for this site's country`);
  return rate.rateBp;
}

/** A catalogue part by its number (spaces and case ignored); `field` names the form input for errors. */
export async function partByNumber(tx: Tx, number: string, field = "partNumber"): Promise<Part> {
  const part = await tx.part.findUnique({ where: { partNumber: normalisePartNumber(number) } });
  if (!part) throw new ValidationError(`Unknown part number ${number}`, { [field]: ["Not in the catalogue"] });
  return part;
}

/**
 * The part to sell or order today: a superseded number is replaced by its current successor.
 * Returns the part and, when it was substituted, the number that was asked for.
 */
export async function currentPart(tx: Tx, part: Part, today: Date): Promise<{ part: Part; requestedNumber: string | null }> {
  const links = await tx.partSupersession.findMany({ select: { oldPartId: true, newPartId: true, effectiveOn: true } });
  const byOld = new Map(links.map((l) => [l.oldPartId, l]));
  const { partId } = resolveReplacement(part.id, (id) => byOld.get(id), today);
  if (partId === part.id) return { part, requestedNumber: null };
  return { part: await tx.part.findUniqueOrThrow({ where: { id: partId } }), requestedNumber: part.partNumber };
}

/** Parts sold by the piece are counted in whole units; litres and metres take decimals. */
export function requireUnits(part: Pick<Part, "unit" | "partNumber">, qty: Decimal, field = "qty") {
  if (part.unit === "EA" && !qty.isInteger()) {
    throw new ValidationError(`${part.partNumber} is sold by the piece`, { [field]: ["Whole units only"] });
  }
}

/** Stock item of a part at a site (created empty on first use), locked until the transaction ends. */
export async function lockStockItem(tx: Tx, partId: string, siteId: string) {
  const item = await tx.stockItem.upsert({ where: { partId_siteId: { partId, siteId } }, create: { partId, siteId }, update: {} });
  await tx.$queryRaw`SELECT 1 FROM stock_item WHERE id = ${item.id} FOR UPDATE`;
  return tx.stockItem.findUniqueOrThrow({ where: { id: item.id } });
}

export type StockChange =
  /** Units enter with their total value (receipt at cost, transfer in, opening). */
  | { in: Decimal; valueCents: number }
  /** Units leave at PMP; `releaseReserved` also frees what a confirmed sale had reserved. */
  | { out: Decimal; releaseReserved?: Decimal }
  /** A counted quantity replaces the book quantity (surplus at PMP, or the fallback cost). */
  | { countedTo: Decimal; fallbackCostCents: number };

export interface StockMove {
  siteId: string;
  partId: string;
  kind: PartMovementKind;
  change: StockChange;
  sourceType: string;
  sourceId: string | null;
  reference: string | null;
  /** Date of the last movement to record (seed openings carry the real one); defaults to today. */
  movedOn?: Date;
}

/**
 * Move parts stock: one ledger row, the item's quantity, value and PMP updated together under a
 * row lock. Postings are the caller's (one entry per document). Null when a count changes nothing.
 */
export async function moveStock(ctx: ServiceContext, m: StockMove) {
  const item = await lockStockItem(ctx.tx, m.partId, m.siteId);
  const before = stockState(item);
  const c = m.change;
  const result = "in" in c ? addToStock(before, c.in, c.valueCents) : "out" in c ? takeFromStock(before, c.out) : adjustTo(before, c.countedTo, c.fallbackCostCents);
  if (!result) return null;
  let reserved = dec(item.qtyReserved);
  if ("out" in c && c.releaseReserved) reserved = Decimal.max(reserved.minus(c.releaseReserved), 0);
  const signedQty = result.after.qty.minus(before.qty);
  await ctx.tx.stockItem.update({
    where: { id: item.id },
    data: {
      qtyOnHand: result.after.qty.toFixed(3),
      valueCents: result.after.valueCents,
      pmpCents: result.after.pmpCents.toFixed(4),
      qtyReserved: reserved.toFixed(3),
      lastMovementOn: m.movedOn ?? ctx.businessDate,
    },
  });
  const movement = await ctx.tx.partMovement.create({
    data: {
      stockItemId: item.id,
      partId: m.partId,
      siteId: m.siteId,
      kind: m.kind,
      qty: signedQty.toFixed(3),
      unitCostCents: result.unitCostCents.toFixed(4),
      valueCents: result.valueCents,
      qtyAfter: result.after.qty.toFixed(3),
      valueAfterCents: result.after.valueCents,
      pmpAfterCents: result.after.pmpCents.toFixed(4),
      sourceType: m.sourceType,
      sourceId: m.sourceId,
      reference: m.reference,
      businessDate: ctx.businessDate,
      userId: ctx.actor.userId,
    },
  });
  return { movement, stockItemId: item.id, qty: signedQty, valueCents: result.valueCents, unitCostCents: result.unitCostCents, before };
}

/** Reserve (positive) or release (negative) units on a site's stock item, never beyond what is free. */
export async function reserveStock(ctx: ServiceContext, a: { siteId: string; part: Pick<Part, "id" | "partNumber">; qty: Decimal; field?: string }) {
  const item = await lockStockItem(ctx.tx, a.part.id, a.siteId);
  const reserved = dec(item.qtyReserved).plus(a.qty);
  const available = dec(item.qtyOnHand).minus(dec(item.qtyReserved));
  if (a.qty.gt(0) && a.qty.gt(available)) {
    throw new ValidationError(`Only ${available.toString()} of ${a.part.partNumber} available`, { [a.field ?? "qty"]: [`${available.toString()} available`] });
  }
  await ctx.tx.stockItem.update({ where: { id: item.id }, data: { qtyReserved: Decimal.max(reserved, 0).toFixed(3) } });
}

/** Units of a part free to sell or move at a site (on hand − reserved). */
export async function availableAt(tx: Tx, partId: string, siteId: string): Promise<Decimal> {
  const item = await tx.stockItem.findUnique({ where: { partId_siteId: { partId, siteId } } });
  return item ? dec(item.qtyOnHand).minus(dec(item.qtyReserved)) : new Decimal(0);
}

/** One parts stock entry for a document: parts stock against stock variation (or the liaison account). */
export async function postStockValue(
  ctx: ServiceContext,
  a: { siteId: string; valueCents: number; counterpart?: "VARIATION" | "LIAISON"; label: string; sourceType: string; sourceId: string | null },
) {
  if (a.valueCents === 0) return null;
  return postEntry(
    ctx,
    buildPartsStockEntry({
      siteId: a.siteId,
      date: ctx.businessDate,
      valueCents: a.valueCents,
      counterpart: a.counterpart ?? "VARIATION",
      label: a.label,
      sourceType: a.sourceType,
      sourceId: a.sourceId,
    }),
  );
}

export async function siteCode(tx: Tx, siteId: string): Promise<string> {
  const site = await tx.site.findUnique({ where: { id: siteId }, select: { code: true } });
  if (!site) throw new NotFoundError("Site", siteId);
  return site.code;
}
