import type { ServiceContext } from "@/lib/context";
import { DomainError, NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { nextDocumentNumber } from "@/modules/core";
import { buildInvoiceEntry, type DepartmentCode } from "../domain/entry";
import { computeLine, computeMarginLine, dueDate, invoiceTotals } from "../domain/vat";
import { invoiceInputSchema, type InvoiceInput } from "../schemas/accounting";
import { postEntry } from "./posting";
import { letterSettlement } from "./lettering";

declare module "@/lib/events" {
  interface DomainEventMap {
    InvoiceIssued: {
      invoiceId: string;
      number: string;
      kind: "INVOICE" | "CREDIT_NOTE";
      sourceType: string;
      sourceId: string | null;
      customerId: string;
      totalInclVatCents: number;
    };
  }
}

/** `trusted`: the calling module already checked its own permission (e.g. a delivery by a salesperson). */
export interface InvoiceOptions {
  trusted?: boolean;
}

async function vatRates(ctx: ServiceContext, siteId: string) {
  const site = await ctx.tx.site.findUniqueOrThrow({ where: { id: siteId } });
  const rates = await ctx.tx.vatRate.findMany({
    where: {
      countryCode: site.countryCode,
      validFrom: { lte: ctx.businessDate },
      OR: [{ validTo: null }, { validTo: { gte: ctx.businessDate } }],
    },
  });
  return { site, rates: new Map(rates.map((r) => [r.code, r.rateBp])) };
}

/** Create a draft invoice. Totals are computed here; no number until issued. */
export async function createInvoice(ctx: ServiceContext, input: InvoiceInput, opts: InvoiceOptions = {}) {
  const data = parseInput(invoiceInputSchema, input);
  if (!opts.trusted) ctx.require("accounting.invoice", "create", data.siteId);
  const customer = await ctx.tx.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) throw new NotFoundError("Customer", data.customerId);
  const { rates } = await vatRates(ctx, data.siteId);

  const lines = data.lines.map((l, i) => {
    const vatRateBp = rates.get(l.vatRateCode);
    if (vatRateBp === undefined) throw new DomainError("unknown_vat_rate", `Unknown VAT rate ${l.vatRateCode}`);
    let amounts: { lineExclVatCents: number; vatCents: number };
    if (data.vatRegime === "MARGIN") {
      if (l.purchasePriceCents === undefined) throw new DomainError("purchase_price_required", "Margin-regime lines need the purchase price");
      amounts = computeMarginLine({ salePriceInclCents: l.unitPriceExclVatCents, purchasePriceCents: l.purchasePriceCents, rateBp: vatRateBp });
    } else {
      amounts = computeLine({ quantity: l.quantity, unitPriceExclVatCents: l.unitPriceExclVatCents, discountBp: l.discountBp, vatRateBp });
    }
    return {
      lineNo: i + 1,
      label: l.label,
      quantity: l.quantity,
      unitPriceExclVatCents: l.unitPriceExclVatCents,
      discountBp: l.discountBp,
      vatRateCode: l.vatRateCode,
      vatRateBp,
      departmentCode: l.departmentCode,
      revenueKey: l.revenueKey,
      ...amounts,
    };
  });
  const totals = invoiceTotals(lines);
  if (totals.totalInclVatCents <= 0) throw new DomainError("invoice_not_positive", "An invoice total must be positive; issue a credit note instead");

  const invoice = await ctx.tx.invoice.create({
    data: {
      sourceType: data.sourceType,
      sourceId: data.sourceId ?? null,
      siteId: data.siteId,
      customerId: data.customerId,
      vatRegime: data.vatRegime,
      notes: data.notes,
      totalExclVatCents: totals.totalExclVatCents,
      vatCents: totals.vatCents,
      totalInclVatCents: totals.totalInclVatCents,
      createdById: ctx.actor.userId,
      lines: { create: lines },
    },
  });
  await ctx.audit({ action: "invoice.create", entityType: "Invoice", entityId: invoice.id, siteId: data.siteId, after: { ...data, totals } });
  return invoice;
}

export async function deleteDraftInvoice(ctx: ServiceContext, id: string) {
  const invoice = await ctx.tx.invoice.findUnique({ where: { id } });
  if (!invoice) throw new NotFoundError("Invoice", id);
  ctx.require("accounting.invoice", "create", invoice.siteId);
  if (invoice.status !== "DRAFT") throw new DomainError("invoice_issued", "Issued invoices cannot be deleted; issue a credit note");
  await ctx.tx.invoice.delete({ where: { id } });
  await ctx.audit({ action: "invoice.delete_draft", entityType: "Invoice", entityId: id, siteId: invoice.siteId, before: invoice });
}

/**
 * Issue a draft: take the gap-free number of the site series, set dates, post the sales entry
 * (Dr 411 / Cr 7xx / Cr 4457x) and link it. All in the caller's transaction.
 */
export async function issueInvoice(ctx: ServiceContext, id: string, opts: InvoiceOptions = {}) {
  const invoice = await ctx.tx.invoice.findUnique({
    where: { id },
    include: { lines: { orderBy: { lineNo: "asc" } }, customer: true, site: true },
  });
  if (!invoice) throw new NotFoundError("Invoice", id);
  if (!opts.trusted) ctx.require("accounting.invoice", "validate", invoice.siteId);
  if (invoice.status !== "DRAFT") throw new DomainError("invoice_issued", `Invoice ${invoice.number} is already issued`);

  const isCredit = invoice.kind === "CREDIT_NOTE";
  const number = await nextDocumentNumber(ctx, {
    docType: isCredit ? "CREDIT_NOTE" : "INVOICE",
    scope: invoice.siteId,
    sitePrefix: invoice.site.code,
  });
  const issueDate = ctx.businessDate;
  const entry = await postEntry(
    ctx,
    buildInvoiceEntry({
      id: invoice.id,
      number,
      kind: invoice.kind,
      siteId: invoice.siteId,
      issueDate,
      customerId: invoice.customerId,
      customerName: invoice.customer.displayName,
      receivableKey: invoice.customer.kind === "OEM" ? "RECEIVABLE_OEM" : "RECEIVABLE_CUSTOMER",
      vatRegime: invoice.vatRegime,
      totalInclVatCents: invoice.totalInclVatCents,
      lines: invoice.lines.map((l) => ({
        label: l.label,
        lineExclVatCents: l.lineExclVatCents,
        vatCents: l.vatCents,
        vatRateCode: l.vatRateCode,
        departmentCode: l.departmentCode as DepartmentCode,
        revenueKey: l.revenueKey,
      })),
    }),
  );
  const issued = await ctx.tx.invoice.update({
    where: { id },
    data: {
      number,
      status: "ISSUED",
      issueDate,
      dueDate: dueDate(issueDate, invoice.customer.paymentTermsDays),
      journalEntryId: entry.id,
    },
  });
  await ctx.audit({ action: "invoice.issue", entityType: "Invoice", entityId: id, siteId: invoice.siteId, after: { number, entry: entry.number } });
  await ctx.emit({
    type: "InvoiceIssued",
    aggregateType: "Invoice",
    aggregateId: id,
    siteId: invoice.siteId,
    payload: {
      invoiceId: id,
      number,
      kind: invoice.kind,
      sourceType: invoice.sourceType,
      sourceId: invoice.sourceId,
      customerId: invoice.customerId,
      totalInclVatCents: invoice.totalInclVatCents,
    },
  });
  return issued;
}

/** Create and issue in one step (used by operational modules). */
export async function createAndIssueInvoice(ctx: ServiceContext, input: InvoiceInput, opts: InvoiceOptions = {}) {
  const draft = await createInvoice(ctx, input, opts);
  return issueInvoice(ctx, draft.id, opts);
}

export function settledStatus(totalCents: number, paidCents: number): "ISSUED" | "PARTIALLY_PAID" | "PAID" {
  return paidCents <= 0 ? "ISSUED" : paidCents >= totalCents ? "PAID" : "PARTIALLY_PAID";
}

/**
 * Full credit note for an issued invoice. It is issued at once and offsets what is still due on the
 * invoice; any surplus (invoice already paid) stays open on the credit note for a refund.
 */
export async function creditInvoice(ctx: ServiceContext, invoiceId: string, reason: string, opts: InvoiceOptions = {}) {
  const invoice = await ctx.tx.invoice.findUnique({ where: { id: invoiceId }, include: { lines: { orderBy: { lineNo: "asc" } }, creditNotes: true } });
  if (!invoice) throw new NotFoundError("Invoice", invoiceId);
  if (!opts.trusted) ctx.require("accounting.invoice", "validate", invoice.siteId);
  if (invoice.kind !== "INVOICE" || invoice.status === "DRAFT") throw new DomainError("not_creditable", "Only issued invoices can be credited");
  if (invoice.creditNotes.length) throw new DomainError("already_credited", `Invoice ${invoice.number} already has a credit note`);

  const note = await ctx.tx.invoice.create({
    data: {
      kind: "CREDIT_NOTE",
      sourceType: invoice.sourceType,
      sourceId: invoice.sourceId,
      siteId: invoice.siteId,
      customerId: invoice.customerId,
      vatRegime: invoice.vatRegime,
      notes: `Credit note for ${invoice.number}${reason ? ` — ${reason}` : ""}`,
      totalExclVatCents: invoice.totalExclVatCents,
      vatCents: invoice.vatCents,
      totalInclVatCents: invoice.totalInclVatCents,
      creditedInvoiceId: invoice.id,
      createdById: ctx.actor.userId,
      lines: {
        create: invoice.lines.map((l) => ({
          lineNo: l.lineNo,
          label: l.label,
          quantity: l.quantity,
          unitPriceExclVatCents: l.unitPriceExclVatCents,
          discountBp: l.discountBp,
          lineExclVatCents: l.lineExclVatCents,
          vatRateCode: l.vatRateCode,
          vatRateBp: l.vatRateBp,
          vatCents: l.vatCents,
          departmentCode: l.departmentCode,
          revenueKey: l.revenueKey,
        })),
      },
    },
  });
  const issued = await issueInvoice(ctx, note.id, { trusted: true });

  // Offset: the credit note settles what is still due on the invoice.
  const offset = Math.min(invoice.totalInclVatCents - invoice.paidCents, issued.totalInclVatCents);
  if (offset > 0) {
    await ctx.tx.invoice.update({
      where: { id: invoice.id },
      data: { paidCents: { increment: offset }, status: settledStatus(invoice.totalInclVatCents, invoice.paidCents + offset) },
    });
    await ctx.tx.invoice.update({
      where: { id: issued.id },
      data: { paidCents: offset, status: settledStatus(issued.totalInclVatCents, offset) },
    });
  }
  await letterSettlement(ctx, [invoice.id]);
  await ctx.audit({ action: "invoice.credit", entityType: "Invoice", entityId: invoice.id, siteId: invoice.siteId, after: { creditNote: issued.number, reason } });
  return ctx.tx.invoice.findUniqueOrThrow({ where: { id: issued.id } });
}
