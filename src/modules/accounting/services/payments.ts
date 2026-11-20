import type { ServiceContext } from "@/lib/context";
import { DomainError, NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { nextDocumentNumber } from "@/modules/core";
import { journalForMethod, treasuryIsCounterparty, treasuryKey } from "../domain/default-chart";
import { buildPaymentEntry } from "../domain/entry";
import { paymentInputSchema, type PaymentInput } from "../schemas/accounting";
import { settledStatus } from "./invoices";
import { letterSettlement } from "./lettering";
import { postEntry } from "./posting";

declare module "@/lib/events" {
  interface DomainEventMap {
    PaymentRecorded: { paymentId: string; number: string; direction: "IN" | "OUT"; amountCents: number; customerId: string | null; supplierId: string | null };
  }
}

export interface PaymentOptions {
  /** The calling module checked its own permission. */
  trusted?: boolean;
  /**
   * Counterpart account key instead of the party's receivable/payable (trusted callers only),
   * e.g. PRIVATE_SELLER when paying a private individual for a used car.
   */
  counterKey?: string;
}

/**
 * Record a receipt (IN) or a disbursement (OUT), post it to the treasury journal, optionally
 * allocate it to open invoices / credit notes, then letter what is fully settled.
 */
export async function recordPayment(ctx: ServiceContext, input: PaymentInput, opts: PaymentOptions = {}) {
  const data = parseInput(paymentInputSchema, input);
  if (!opts.trusted) ctx.require("accounting.payment", "create", data.siteId);
  const site = await ctx.tx.site.findUniqueOrThrow({ where: { id: data.siteId } });

  let party: { type: "CUSTOMER" | "SUPPLIER"; id: string; name: string; accountKey: string };
  if (data.customerId) {
    const c = await ctx.tx.customer.findUnique({ where: { id: data.customerId } });
    if (!c) throw new NotFoundError("Customer", data.customerId);
    party = { type: "CUSTOMER", id: c.id, name: c.displayName, accountKey: c.kind === "OEM" ? "RECEIVABLE_OEM" : "RECEIVABLE_CUSTOMER" };
  } else {
    const s = await ctx.tx.supplier.findUnique({ where: { id: data.supplierId! } });
    if (!s) throw new NotFoundError("Supplier", data.supplierId!);
    party = { type: "SUPPLIER", id: s.id, name: s.name, accountKey: s.isOem ? "PAYABLE_OEM" : "PAYABLE_SUPPLIER" };
  }
  if (opts.counterKey) {
    if (!opts.trusted) throw new DomainError("counter_key", "Only trusted callers can choose the counterpart account");
    if (data.allocations.length) throw new DomainError("counter_key", "A payment on another account cannot settle invoices");
    party = { ...party, accountKey: opts.counterKey };
  }

  const number = await nextDocumentNumber(ctx, {
    docType: data.direction === "IN" ? "RECEIPT" : "DISBURSEMENT",
    scope: data.siteId,
    sitePrefix: site.code,
  });
  const journalCode = journalForMethod(data.method);
  const payment = await ctx.tx.payment.create({
    data: {
      number,
      siteId: data.siteId,
      direction: data.direction,
      method: data.method,
      journalCode,
      customerId: data.customerId ?? null,
      supplierId: data.supplierId ?? null,
      amountCents: data.amountCents,
      businessDate: ctx.businessDate,
      reference: data.reference,
      sourceType: data.sourceType ?? null,
      sourceId: data.sourceId ?? null,
      createdById: ctx.actor.userId,
    },
  });
  const entry = await postEntry(
    ctx,
    buildPaymentEntry({
      id: payment.id,
      number,
      siteId: data.siteId,
      date: ctx.businessDate,
      direction: data.direction,
      journalCode,
      treasury: { key: treasuryKey(data.method) },
      treasuryParty: treasuryIsCounterparty(data.method) ? { type: party.type, id: party.id } : null,
      party,
      amountCents: data.amountCents,
    }),
  );
  await ctx.tx.payment.update({ where: { id: payment.id }, data: { journalEntryId: entry.id } });
  if (data.allocations.length) {
    await applyAllocations(ctx, payment.id, data.allocations);
    await letterSettlement(ctx, data.allocations.map((a) => a.invoiceId));
  }

  await ctx.audit({ action: "payment.record", entityType: "Payment", entityId: payment.id, siteId: data.siteId, after: { ...data, number } });
  await ctx.emit({
    type: "PaymentRecorded",
    aggregateType: "Payment",
    aggregateId: payment.id,
    siteId: data.siteId,
    payload: {
      paymentId: payment.id,
      number,
      direction: data.direction,
      amountCents: data.amountCents,
      customerId: data.customerId ?? null,
      supplierId: data.supplierId ?? null,
    },
  });
  return ctx.tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
}

/** Allocate (part of) an existing payment to open invoices of the same customer. */
export async function allocatePayment(
  ctx: ServiceContext,
  paymentId: string,
  allocations: { invoiceId: string; amountCents: number }[],
  opts: { trusted?: boolean } = {},
) {
  const payment = await ctx.tx.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new NotFoundError("Payment", paymentId);
  if (!opts.trusted) ctx.require("accounting.payment", "create", payment.siteId);
  await applyAllocations(ctx, paymentId, allocations);
  await letterSettlement(ctx, allocations.map((a) => a.invoiceId));
  await ctx.audit({ action: "payment.allocate", entityType: "Payment", entityId: paymentId, siteId: payment.siteId, after: { allocations } });
}

async function applyAllocations(ctx: ServiceContext, paymentId: string, allocations: { invoiceId: string; amountCents: number }[]) {
  const payment = await ctx.tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (!payment.customerId) throw new DomainError("supplier_allocation", "Supplier invoices arrive with the purchasing modules");
  let allocated = payment.allocatedCents;
  for (const a of allocations) {
    if (a.amountCents <= 0) throw new DomainError("invalid_amount", "Allocation must be positive");
    const invoice = await ctx.tx.invoice.findUnique({ where: { id: a.invoiceId } });
    if (!invoice) throw new NotFoundError("Invoice", a.invoiceId);
    if (invoice.customerId !== payment.customerId) throw new DomainError("wrong_customer", `Invoice ${invoice.number} belongs to another customer`);
    if (invoice.status === "DRAFT") throw new DomainError("invoice_draft", "Draft invoices cannot be paid");
    // Receipts settle invoices; refunds (OUT) settle credit notes.
    const expectedKind = payment.direction === "IN" ? "INVOICE" : "CREDIT_NOTE";
    if (invoice.kind !== expectedKind) throw new DomainError("wrong_kind", `A ${payment.direction === "IN" ? "receipt" : "refund"} settles ${expectedKind.toLowerCase().replace("_", " ")}s only`);
    const due = invoice.totalInclVatCents - invoice.paidCents;
    if (a.amountCents > due) throw new DomainError("over_allocation", `Only ${(due / 100).toFixed(2)} is due on ${invoice.number}`);
    allocated += a.amountCents;
    if (allocated > payment.amountCents) throw new DomainError("over_allocation", "Allocations exceed the payment amount");
    await ctx.tx.paymentAllocation.create({ data: { paymentId, invoiceId: invoice.id, amountCents: a.amountCents } });
    const paid = invoice.paidCents + a.amountCents;
    await ctx.tx.invoice.update({ where: { id: invoice.id }, data: { paidCents: paid, status: settledStatus(invoice.totalInclVatCents, paid) } });
  }
  await ctx.tx.payment.update({ where: { id: paymentId }, data: { allocatedCents: allocated } });
}
