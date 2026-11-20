/**
 * Parts on repair orders, for the workshop module: price a part for a payer, issue it from the
 * site's stock at PMP (Dr 603730 / Cr 373000), take it back at the cost it left with.
 */
import type { PriceClass } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { ValidationError } from "@/lib/errors";
import { discountFor } from "../domain/pricing";
import { Decimal } from "../domain/valuation";
import { availableAt, currentPart, moveStock, partByNumber, postStockValue, requireUnits } from "./shared";

/** The part to fit (a superseded number becomes its successor), its retail price and the payer's discount. */
export async function pricePartForWorkshop(ctx: ServiceContext, a: { partNumber: string; qty: string | number; priceClass: PriceClass; field?: string }) {
  const asked = await partByNumber(ctx.tx, a.partNumber, a.field ?? "partNumber");
  const { part, requestedNumber } = await currentPart(ctx.tx, asked, ctx.businessDate);
  if (!part.active) throw new ValidationError(`${part.partNumber} is no longer sold`, { [a.field ?? "partNumber"]: ["Inactive part"] });
  const qty = new Decimal(a.qty);
  requireUnits(part, qty);
  const rates = await ctx.tx.discountRate.findMany({ where: { discountCodeId: part.discountCodeId } });
  return { part, requestedNumber, qty, unitPriceCents: part.retailPriceCents, discountBp: discountFor(rates, a.priceClass) };
}

/** Issue parts to a repair order: out of stock at PMP, posted at once. Returns the cost. */
export async function issuePartsToRepairOrder(
  ctx: ServiceContext,
  a: { siteId: string; partId: string; partNumber: string; qty: Decimal; roId: string; roNumber: string; field?: string },
) {
  const free = await availableAt(ctx.tx, a.partId, a.siteId);
  if (a.qty.gt(free)) throw new ValidationError(`Only ${free.toString()} of ${a.partNumber} available`, { [a.field ?? "qty"]: [`${free.toString()} available`] });
  const out = (await moveStock(ctx, {
    siteId: a.siteId,
    partId: a.partId,
    kind: "ISSUE_RO",
    change: { out: a.qty },
    sourceType: "REPAIR_ORDER",
    sourceId: a.roId,
    reference: a.roNumber,
  }))!;
  const costCents = -out.valueCents;
  await postStockValue(ctx, { siteId: a.siteId, valueCents: out.valueCents, label: `${a.roNumber} — ${a.partNumber} issued`, sourceType: "REPAIR_ORDER", sourceId: a.roId });
  return { costCents, unitCostCents: out.unitCostCents };
}

/** Parts not fitted come back to the shelf at the cost they left with (the PMP blends them back in). */
export async function returnPartsFromRepairOrder(
  ctx: ServiceContext,
  a: { siteId: string; partId: string; partNumber: string; qty: Decimal; costCents: number; roId: string; roNumber: string },
) {
  await moveStock(ctx, {
    siteId: a.siteId,
    partId: a.partId,
    kind: "RETURN_RO",
    change: { in: a.qty, valueCents: a.costCents },
    sourceType: "REPAIR_ORDER",
    sourceId: a.roId,
    reference: a.roNumber,
  });
  await postStockValue(ctx, { siteId: a.siteId, valueCents: a.costCents, label: `${a.roNumber} — ${a.partNumber} returned`, sourceType: "REPAIR_ORDER", sourceId: a.roId });
}
