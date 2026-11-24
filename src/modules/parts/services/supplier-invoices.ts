/** Supplier invoices for parts: matched to goods receipts, posted, approved when off tolerance, paid. */
import type { ServiceContext } from "@/lib/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatMoney, sumCents } from "@/lib/money";
import { parseInput } from "@/lib/validation";
import { buildSupplierInvoiceEntry, dueDate, letterLines, postEntry, recordPayment } from "@/modules/accounting";
import { nextDocumentNumber } from "@/modules/core";
import { matchLine, supplierInvoiceTotals, withinTolerance } from "../domain/purchasing";
import { dec, Decimal } from "../domain/valuation";
import { supplierInvoiceInputSchema, supplierPaymentInputSchema, type SupplierInvoiceInput, type SupplierPaymentInput } from "../schemas/parts";
import { partsSettings, siteCode, vatRateBp } from "./shared";

declare module "@/lib/events" {
  interface DomainEventMap {
    SupplierInvoiceRecorded: { supplierInvoiceId: string; number: string; status: "VARIANCE" | "MATCHED"; varianceCents: number };
  }
}

/**
 * Record a supplier's invoice against the receipt lines it bills. Each line clears its share of the
 * receipt value; the difference with the invoiced price is the variance. Within tolerance the
 * invoice is matched and posted at once; above it, it waits for a manager's decision.
 */
export async function recordSupplierInvoice(ctx: ServiceContext, input: SupplierInvoiceInput) {
  const data = parseInput(supplierInvoiceInputSchema, input);
  ctx.require("parts.purchase_order", "create", data.siteId);
  const supplier = await ctx.tx.supplier.findUnique({ where: { id: data.supplierId } });
  if (!supplier) throw new ValidationError("Unknown supplier", { supplierId: ["Choose a supplier"] });
  if (data.invoiceDate.getTime() > ctx.businessDate.getTime()) throw new ValidationError("The invoice cannot be dated in the future", { invoiceDate: ["After today"] });
  const duplicate = await ctx.tx.supplierInvoice.findUnique({ where: { supplierId_supplierReference: { supplierId: supplier.id, supplierReference: data.supplierReference } } });
  if (duplicate) throw new ValidationError(`${supplier.name} invoice ${data.supplierReference} is already recorded as ${duplicate.number}`, { supplierReference: ["Already recorded"] });

  const settings = await partsSettings(ctx.tx, data.siteId);
  const rateBp = await vatRateBp(ctx.tx, data.siteId, "STANDARD", data.invoiceDate);
  const number = await nextDocumentNumber(ctx, { docType: "SUPPLIER_INVOICE", scope: data.siteId, sitePrefix: await siteCode(ctx.tx, data.siteId) });
  const invoice = await ctx.tx.supplierInvoice.create({
    data: {
      number,
      siteId: data.siteId,
      supplierId: supplier.id,
      supplierReference: data.supplierReference,
      invoiceDate: data.invoiceDate,
      dueDate: dueDate(data.invoiceDate, supplier.paymentTermsDays),
      status: "VARIANCE",
      totalExclVatCents: 0,
      vatCents: 0,
      totalInclVatCents: 0,
      receiptValueCents: 0,
      varianceCents: 0,
      notes: data.notes ?? null,
      createdById: ctx.actor.userId,
    },
  });

  const matched: { amountCents: number; receiptValueCents: number; varianceCents: number }[] = [];
  const seen = new Set<string>();
  for (const [index, line] of data.lines.entries()) {
    const field = `lines.${index}.qty`;
    if (seen.has(line.receiptLineId)) throw new ValidationError("A receipt line is listed twice", { [field]: ["Listed twice"] });
    seen.add(line.receiptLineId);
    await ctx.tx.$queryRaw`SELECT 1 FROM goods_receipt_line WHERE id = ${line.receiptLineId} FOR UPDATE`;
    const rl = await ctx.tx.goodsReceiptLine.findUnique({ where: { id: line.receiptLineId }, include: { receipt: true, poLine: { include: { part: true } } } });
    if (!rl) throw new NotFoundError("GoodsReceiptLine", line.receiptLineId);
    if (rl.receipt.supplierId !== supplier.id || rl.receipt.siteId !== data.siteId) {
      throw new ValidationError(`Receipt ${rl.receipt.number} is not from ${supplier.name} at this site`, { [field]: ["Another supplier's receipt"] });
    }
    const billed = await ctx.tx.supplierInvoiceLine.aggregate({
      where: { receiptLineId: rl.id, invoice: { status: { not: "REJECTED" } } },
      _sum: { receiptValueCents: true },
    });
    const remainingQty = dec(rl.qty).minus(dec(rl.qtyInvoiced));
    const qty = new Decimal(line.qty);
    if (qty.gt(remainingQty)) {
      throw new ValidationError(`Only ${remainingQty.toString()} of ${rl.poLine.part.partNumber} on ${rl.receipt.number} left to invoice`, { [field]: [`At most ${remainingQty.toString()}`] });
    }
    const unitCostCents = line.unitCostCents ?? rl.unitCostCents;
    const m = matchLine({
      qty,
      unitCostCents,
      receiptUnitCostCents: rl.unitCostCents,
      remainingQty,
      remainingValueCents: rl.valueCents - (billed._sum.receiptValueCents ?? 0),
    });
    await ctx.tx.supplierInvoiceLine.create({
      data: { invoiceId: invoice.id, receiptLineId: rl.id, partId: rl.partId, qty: qty.toFixed(3), unitCostCents, ...m },
    });
    await ctx.tx.goodsReceiptLine.update({ where: { id: rl.id }, data: { qtyInvoiced: dec(rl.qtyInvoiced).plus(qty).toFixed(3) } });
    matched.push(m);
  }

  const totals = supplierInvoiceTotals(matched, rateBp);
  const receiptValueCents = sumCents(matched.map((m) => m.receiptValueCents));
  const varianceCents = sumCents(matched.map((m) => m.varianceCents));
  const status = withinTolerance(varianceCents, receiptValueCents, settings.invoiceTolerance) ? "MATCHED" : "VARIANCE";
  let saved = await ctx.tx.supplierInvoice.update({
    where: { id: invoice.id },
    data: { ...totals, receiptValueCents, varianceCents, status },
  });
  if (status === "MATCHED") saved = await postInvoice(ctx, saved.id);
  await ctx.audit({
    action: "supplier_invoice.record",
    entityType: "SupplierInvoice",
    entityId: invoice.id,
    after: { number, supplierReference: data.supplierReference, lines: data.lines, ...totals, varianceCents, status },
    siteId: data.siteId,
  });
  await ctx.emit({
    type: "SupplierInvoiceRecorded",
    aggregateType: "SupplierInvoice",
    aggregateId: invoice.id,
    siteId: data.siteId,
    payload: { supplierInvoiceId: invoice.id, number, status, varianceCents },
  });
  return saved;
}

/** Post a matched invoice: Dr 408100 (receipt value) ± 607300 (variance) + deductible VAT / Cr supplier. */
async function postInvoice(ctx: ServiceContext, id: string) {
  const inv = await ctx.tx.supplierInvoice.findUniqueOrThrow({ where: { id }, include: { supplier: true } });
  const entry = await postEntry(
    ctx,
    buildSupplierInvoiceEntry({
      siteId: inv.siteId,
      date: ctx.businessDate,
      label: `${inv.supplier.name} invoice ${inv.supplierReference} — ${inv.number}`,
      sourceType: "SUPPLIER_INVOICE",
      sourceId: inv.id,
      supplierId: inv.supplierId,
      payable: { key: inv.supplier.isOem ? "PAYABLE_OEM" : "PAYABLE_SUPPLIER" },
      receiptValueCents: inv.receiptValueCents,
      varianceCents: inv.varianceCents,
      vatCents: inv.vatCents,
      purchaseAccount: { key: "PURCHASE_PARTS" },
      departmentCode: "PARTS",
    }),
  );
  return ctx.tx.supplierInvoice.update({ where: { id }, data: { entryId: entry.id, status: "MATCHED" } });
}

/** A manager accepts an invoice whose price variance is above tolerance (it is then posted) or rejects it. */
export async function decideSupplierInvoice(ctx: ServiceContext, id: string, decision: "APPROVE" | "REJECT", notes: string | null) {
  const inv = await ctx.tx.supplierInvoice.findUnique({ where: { id }, include: { lines: true } });
  if (!inv) throw new NotFoundError("SupplierInvoice", id);
  ctx.require("parts.purchase_order", "validate", inv.siteId);
  if (inv.status !== "VARIANCE") throw new ConflictError(`Invoice ${inv.number} is ${inv.status.toLowerCase()}: nothing to decide`);
  if (decision === "REJECT" && !notes?.trim()) throw new ValidationError("Say why the invoice is rejected", { notes: ["Required to reject"] });
  const decided = { decidedById: ctx.actor.userId, decidedOn: ctx.businessDate, notes: notes?.trim() ? notes.trim() : inv.notes };
  let saved;
  if (decision === "APPROVE") {
    await ctx.tx.supplierInvoice.update({ where: { id }, data: decided });
    saved = await postInvoice(ctx, id);
  } else {
    // The receipt lines can be billed again by the corrected invoice.
    for (const l of inv.lines) {
      const rl = await ctx.tx.goodsReceiptLine.findUniqueOrThrow({ where: { id: l.receiptLineId } });
      await ctx.tx.goodsReceiptLine.update({ where: { id: rl.id }, data: { qtyInvoiced: Decimal.max(dec(rl.qtyInvoiced).minus(dec(l.qty)), 0).toFixed(3) } });
    }
    saved = await ctx.tx.supplierInvoice.update({ where: { id }, data: { ...decided, status: "REJECTED" } });
  }
  await ctx.audit({
    action: decision === "APPROVE" ? "supplier_invoice.approve" : "supplier_invoice.reject",
    entityType: "SupplierInvoice",
    entityId: id,
    before: { status: inv.status },
    after: { status: saved.status, notes, varianceCents: inv.varianceCents },
    siteId: inv.siteId,
  });
  return saved;
}

/** Pay a posted invoice in full and letter the supplier's account (invoice against payment). */
export async function paySupplierInvoice(ctx: ServiceContext, id: string, input: SupplierPaymentInput) {
  const data = parseInput(supplierPaymentInputSchema, input);
  const inv = await ctx.tx.supplierInvoice.findUnique({ where: { id }, include: { supplier: true } });
  if (!inv) throw new NotFoundError("SupplierInvoice", id);
  ctx.require("accounting.payment", "create", inv.siteId);
  if (inv.status !== "MATCHED" || !inv.entryId) {
    throw new ConflictError(inv.status === "PAID" ? `Invoice ${inv.number} is already paid` : `Invoice ${inv.number} must be matched before it is paid`);
  }
  const payment = await recordPayment(
    ctx,
    {
      siteId: inv.siteId,
      direction: "OUT",
      method: data.method,
      supplierId: inv.supplierId,
      amountCents: inv.totalInclVatCents,
      reference: `${inv.number} — ${inv.supplier.name} ${inv.supplierReference}`,
      sourceType: "SUPPLIER_INVOICE",
      sourceId: inv.id,
    },
    { trusted: true },
  );
  const lines = await ctx.tx.journalLine.findMany({
    where: { entryId: { in: [inv.entryId, payment.journalEntryId!] }, partyType: "SUPPLIER", partyId: inv.supplierId, letteringCode: null, account: { isPayable: true } },
    select: { id: true },
  });
  if (lines.length >= 2) await letterLines(ctx, lines.map((l) => l.id), { trusted: true });
  const saved = await ctx.tx.supplierInvoice.update({ where: { id }, data: { status: "PAID", paymentId: payment.id } });
  await ctx.audit({
    action: "supplier_invoice.pay",
    entityType: "SupplierInvoice",
    entityId: id,
    after: { payment: payment.number, amount: formatMoney(inv.totalInclVatCents, { locale: "en-GB" }), method: data.method },
    siteId: inv.siteId,
  });
  return saved;
}
