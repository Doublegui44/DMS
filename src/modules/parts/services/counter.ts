/** Counter sales: quote → confirmed (stock reserved) → invoiced (stock issued at PMP), or cancelled. */
import type { CounterSale, PriceClass } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { sumCents } from "@/lib/money";
import { parseInput } from "@/lib/validation";
import { createAndIssueInvoice, recordPayment } from "@/modules/accounting";
import { nextDocumentNumber } from "@/modules/core";
import { counterLine, discountFor } from "../domain/pricing";
import { dec, Decimal } from "../domain/valuation";
import {
  counterInvoiceInputSchema,
  counterLineInputSchema,
  counterSaleInputSchema,
  type CounterInvoiceInput,
  type CounterLineInput,
  type CounterSaleInput,
} from "../schemas/parts";
import { availableAt, currentPart, moveStock, partByNumber, postStockValue, requireUnits, reserveStock, siteCode } from "./shared";

declare module "@/lib/events" {
  interface DomainEventMap {
    CounterSaleInvoiced: { counterSaleId: string; number: string; invoiceId: string; revenueCents: number; costCents: number };
  }
}

/** Revenue account per price class: warranty parts and internal transfers have their own. */
export function partsRevenueKey(priceClass: PriceClass): string {
  return priceClass === "WARRANTY" ? "REVENUE_WARRANTY_PARTS" : priceClass === "INTERNAL" ? "REVENUE_INTERNAL_PARTS" : "REVENUE_PARTS";
}

export async function createCounterSale(ctx: ServiceContext, input: CounterSaleInput) {
  const data = parseInput(counterSaleInputSchema, input);
  ctx.require("parts.counter_sale", "create", data.siteId);
  const customer = await ctx.tx.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) throw new ValidationError("Unknown customer", { customerId: ["Choose a customer"] });
  const number = await nextDocumentNumber(ctx, { docType: "COUNTER_SALE", scope: data.siteId, sitePrefix: await siteCode(ctx.tx, data.siteId) });
  const sale = await ctx.tx.counterSale.create({
    data: {
      number,
      siteId: data.siteId,
      customerId: customer.id,
      priceClass: data.priceClass ?? customer.priceClass,
      reference: data.reference ?? null,
      createdOn: ctx.businessDate,
      createdById: ctx.actor.userId,
    },
  });
  await ctx.audit({ action: "counter_sale.create", entityType: "CounterSale", entityId: sale.id, after: { ...data, number, priceClass: sale.priceClass }, siteId: data.siteId });
  return sale;
}

async function loadSale(ctx: ServiceContext, id: string) {
  const sale = await ctx.tx.counterSale.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" }, include: { part: true } } } });
  if (!sale) throw new NotFoundError("CounterSale", id);
  ctx.require("parts.counter_sale", "edit", sale.siteId);
  return sale;
}

function requireStatus(sale: CounterSale, ...allowed: CounterSale["status"][]) {
  if (!allowed.includes(sale.status)) throw new ConflictError(`Sale ${sale.number} is ${sale.status.toLowerCase()}`);
}

async function refreshTotal(ctx: ServiceContext, saleId: string) {
  const lines = await ctx.tx.counterSaleLine.findMany({ where: { saleId }, select: { lineExclVatCents: true } });
  return ctx.tx.counterSale.update({ where: { id: saleId }, data: { totalExclVatCents: sumCents(lines.map((l) => l.lineExclVatCents)) } });
}

/**
 * Add a part to a quote at its retail price less the discount of the customer's price class.
 * A superseded number is replaced by its successor (the requested number stays on the line).
 */
export async function addCounterLine(ctx: ServiceContext, saleId: string, input: CounterLineInput) {
  const data = parseInput(counterLineInputSchema, input);
  const sale = await loadSale(ctx, saleId);
  requireStatus(sale, "QUOTE");
  const asked = await partByNumber(ctx.tx, data.partNumber);
  const { part, requestedNumber } = await currentPart(ctx.tx, asked, ctx.businessDate);
  if (!part.active) throw new ValidationError(`${part.partNumber} is no longer sold`, { partNumber: ["Inactive part"] });
  const rates = await ctx.tx.discountRate.findMany({ where: { discountCodeId: part.discountCodeId } });
  const discountBp = discountFor(rates, sale.priceClass);
  const existing = sale.lines.find((l) => l.partId === part.id);
  const qty = new Decimal(data.qty).plus(existing ? dec(existing.qty) : 0);
  requireUnits(part, qty);
  const { lineExclVatCents } = counterLine({ qty: qty.toNumber(), unitPriceCents: part.retailPriceCents, discountBp, vatRateBp: 0 });
  const values = { qty: qty.toFixed(3), unitPriceCents: part.retailPriceCents, discountBp, lineExclVatCents };
  const line = existing
    ? await ctx.tx.counterSaleLine.update({ where: { id: existing.id }, data: values })
    : await ctx.tx.counterSaleLine.create({
        data: { saleId, lineNo: Math.max(0, ...sale.lines.map((l) => l.lineNo)) + 1, partId: part.id, requestedNumber, ...values },
      });
  await refreshTotal(ctx, saleId);
  await ctx.audit({ action: "counter_sale.add_line", entityType: "CounterSale", entityId: saleId, after: { partNumber: part.partNumber, requestedNumber, qty: data.qty, discountBp }, siteId: sale.siteId });
  return line;
}

export async function removeCounterLine(ctx: ServiceContext, saleId: string, lineId: string) {
  const sale = await loadSale(ctx, saleId);
  requireStatus(sale, "QUOTE");
  const line = sale.lines.find((l) => l.id === lineId);
  if (!line) throw new NotFoundError("CounterSaleLine", lineId);
  await ctx.tx.counterSaleLine.delete({ where: { id: lineId } });
  await refreshTotal(ctx, saleId);
  await ctx.audit({ action: "counter_sale.remove_line", entityType: "CounterSale", entityId: saleId, before: { partNumber: line.part.partNumber, qty: line.qty }, siteId: sale.siteId });
}

/** The customer accepts the quote: the parts are reserved so nobody else sells them. */
export async function confirmCounterSale(ctx: ServiceContext, saleId: string) {
  const sale = await loadSale(ctx, saleId);
  requireStatus(sale, "QUOTE");
  if (!sale.lines.length) throw new ConflictError("Add at least one part first");
  for (const line of sale.lines) await reserveStock(ctx, { siteId: sale.siteId, part: line.part, qty: dec(line.qty) });
  const saved = await ctx.tx.counterSale.update({ where: { id: saleId }, data: { status: "CONFIRMED", confirmedOn: ctx.businessDate } });
  await ctx.audit({ action: "counter_sale.confirm", entityType: "CounterSale", entityId: saleId, before: { status: sale.status }, after: { status: "CONFIRMED" }, siteId: sale.siteId });
  return saved;
}

/**
 * Hand the parts over and invoice them: stock leaves at PMP (Dr 603730 / Cr 373000), the
 * customer invoice posts the revenue, and a payment taken at the counter settles it at once.
 */
export async function invoiceCounterSale(ctx: ServiceContext, saleId: string, input: CounterInvoiceInput = {}) {
  const data = parseInput(counterInvoiceInputSchema, input);
  const sale = await loadSale(ctx, saleId);
  requireStatus(sale, "QUOTE", "CONFIRMED");
  if (!sale.lines.length) throw new ConflictError("Add at least one part first");
  const reserved = sale.status === "CONFIRMED";

  let costCents = 0;
  for (const [index, line] of sale.lines.entries()) {
    const qty = dec(line.qty);
    if (!reserved) {
      const free = await availableAt(ctx.tx, line.partId, sale.siteId);
      if (qty.gt(free)) throw new ValidationError(`Only ${free.toString()} of ${line.part.partNumber} available`, { [`lines.${index}.qty`]: [`${free.toString()} available`] });
    }
    const out = (await moveStock(ctx, {
      siteId: sale.siteId,
      partId: line.partId,
      kind: "COUNTER_SALE",
      change: { out: qty, releaseReserved: reserved ? qty : undefined },
      sourceType: "COUNTER_SALE",
      sourceId: sale.id,
      reference: sale.number,
    }))!;
    await ctx.tx.counterSaleLine.update({ where: { id: line.id }, data: { unitCostCents: out.unitCostCents.toFixed(4), costCents: -out.valueCents } });
    costCents -= out.valueCents;
  }

  const invoice = await createAndIssueInvoice(
    ctx,
    {
      siteId: sale.siteId,
      customerId: sale.customerId,
      sourceType: "COUNTER_SALE",
      sourceId: sale.id,
      notes: [`Counter sale ${sale.number}`, sale.reference].filter(Boolean).join(" — "),
      lines: sale.lines.map((l) => ({
        label: `${l.part.partNumber} ${l.part.description}`.slice(0, 200),
        quantity: dec(l.qty).toNumber(),
        unitPriceExclVatCents: l.unitPriceCents,
        discountBp: l.discountBp,
        vatRateCode: l.part.vatRateCode,
        departmentCode: "PARTS" as const,
        revenueKey: partsRevenueKey(sale.priceClass),
      })),
    },
    { trusted: true },
  );
  await postStockValue(ctx, { siteId: sale.siteId, valueCents: -costCents, label: `Counter sale ${sale.number} — cost of parts`, sourceType: "COUNTER_SALE", sourceId: sale.id });
  if (data.paymentMethod) {
    await recordPayment(ctx, {
      siteId: sale.siteId,
      direction: "IN",
      method: data.paymentMethod,
      customerId: sale.customerId,
      amountCents: invoice.totalInclVatCents,
      reference: `Counter sale ${sale.number}`,
      allocations: [{ invoiceId: invoice.id, amountCents: invoice.totalInclVatCents }],
    });
  }
  const saved = await ctx.tx.counterSale.update({
    where: { id: saleId },
    data: { status: "INVOICED", invoicedOn: ctx.businessDate, invoiceId: invoice.id, costCents, totalExclVatCents: invoice.totalExclVatCents },
  });
  await ctx.audit({
    action: "counter_sale.invoice",
    entityType: "CounterSale",
    entityId: saleId,
    before: { status: sale.status },
    after: { status: "INVOICED", invoice: invoice.number, costCents, paid: data.paymentMethod ?? null },
    siteId: sale.siteId,
  });
  await ctx.emit({
    type: "CounterSaleInvoiced",
    aggregateType: "CounterSale",
    aggregateId: sale.id,
    siteId: sale.siteId,
    payload: { counterSaleId: sale.id, number: sale.number, invoiceId: invoice.id, revenueCents: invoice.totalExclVatCents, costCents },
  });
  return saved;
}

export async function cancelCounterSale(ctx: ServiceContext, saleId: string) {
  const sale = await loadSale(ctx, saleId);
  requireStatus(sale, "QUOTE", "CONFIRMED");
  if (sale.status === "CONFIRMED") {
    for (const line of sale.lines) await reserveStock(ctx, { siteId: sale.siteId, part: line.part, qty: dec(line.qty).negated() });
  }
  const saved = await ctx.tx.counterSale.update({ where: { id: saleId }, data: { status: "CANCELLED", cancelledOn: ctx.businessDate } });
  await ctx.audit({ action: "counter_sale.cancel", entityType: "CounterSale", entityId: saleId, before: { status: sale.status }, after: { status: "CANCELLED" }, siteId: sale.siteId });
  return saved;
}
