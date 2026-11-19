import type { ServiceContext } from "@/lib/context";
import { DomainError } from "@/lib/errors";
import { canLetter, letteringCode, letteringIndex } from "../domain/entry";

async function nextCode(ctx: ServiceContext, accountCode: string, partyId: string | null): Promise<string> {
  const used = await ctx.tx.journalLine.findMany({
    where: { accountCode, partyId, letteringCode: { not: null } },
    select: { letteringCode: true },
    distinct: ["letteringCode"],
  });
  const max = used.reduce((m, u) => Math.max(m, letteringIndex(u.letteringCode!)), -1);
  return letteringCode(max + 1);
}

/** Manual lettering: lines on one account (and party) that net to zero. */
export async function letterLines(ctx: ServiceContext, lineIds: string[]) {
  ctx.require("accounting.entry", "edit");
  const lines = await ctx.tx.journalLine.findMany({ where: { id: { in: lineIds } } });
  if (lines.length !== lineIds.length) throw new DomainError("not_found", "Some lines were not found");
  if (lines.some((l) => l.letteringCode)) throw new DomainError("already_lettered", "Some lines are already lettered");
  const accounts = new Set(lines.map((l) => `${l.accountCode}|${l.partyId ?? ""}`));
  if (accounts.size !== 1) throw new DomainError("mixed_accounts", "Lettering works on one account and one party at a time");
  if (!canLetter(lines)) throw new DomainError("not_zero", "Selected lines do not net to zero");
  const code = await nextCode(ctx, lines[0].accountCode, lines[0].partyId);
  await ctx.tx.journalLine.updateMany({ where: { id: { in: lineIds } }, data: { letteringCode: code } });
  await ctx.audit({ action: "lettering.letter", entityType: "Account", entityId: lines[0].accountCode, after: { code, lineIds } });
  return code;
}

export async function unletter(ctx: ServiceContext, args: { accountCode: string; partyId: string | null; code: string }) {
  ctx.require("accounting.entry", "edit");
  const { count } = await ctx.tx.journalLine.updateMany({
    where: { accountCode: args.accountCode, partyId: args.partyId, letteringCode: args.code },
    data: { letteringCode: null },
  });
  await ctx.audit({ action: "lettering.unletter", entityType: "Account", entityId: args.accountCode, after: { ...args, count } });
  return count;
}

/**
 * Automatic lettering after a settlement. Starting from the given invoices, follow payment
 * allocations and credit-note links to the whole settlement group; when every invoice and credit
 * note in it is fully settled and every payment fully allocated, letter the group's receivable
 * lines together (per account). No permission check: called by invoice and payment services.
 */
export async function letterSettlement(ctx: ServiceContext, invoiceIds: string[]) {
  const invoiceSet = new Set<string>();
  const paymentSet = new Set<string>();
  const queue = [...invoiceIds];
  while (queue.length) {
    const id = queue.pop()!;
    if (invoiceSet.has(id)) continue;
    invoiceSet.add(id);
    const inv = await ctx.tx.invoice.findUnique({
      where: { id },
      select: { creditedInvoiceId: true, creditNotes: { select: { id: true } }, allocations: { select: { paymentId: true } } },
    });
    if (!inv) continue;
    if (inv.creditedInvoiceId) queue.push(inv.creditedInvoiceId);
    for (const c of inv.creditNotes) queue.push(c.id);
    for (const a of inv.allocations) {
      if (paymentSet.has(a.paymentId)) continue;
      paymentSet.add(a.paymentId);
      const others = await ctx.tx.paymentAllocation.findMany({ where: { paymentId: a.paymentId }, select: { invoiceId: true } });
      for (const o of others) queue.push(o.invoiceId);
    }
  }
  const invoices = await ctx.tx.invoice.findMany({ where: { id: { in: [...invoiceSet] } } });
  const payments = await ctx.tx.payment.findMany({ where: { id: { in: [...paymentSet] } } });
  if (invoices.some((i) => i.status === "DRAFT" || i.paidCents !== i.totalInclVatCents)) return [];
  if (payments.some((p) => p.allocatedCents !== p.amountCents)) return [];

  const entryIds = [...invoices.map((i) => i.journalEntryId), ...payments.map((p) => p.journalEntryId)].filter((x): x is string => !!x);
  const lines = await ctx.tx.journalLine.findMany({
    where: { entryId: { in: entryIds }, partyType: "CUSTOMER", letteringCode: null, account: { isReceivable: true } },
    select: { id: true, accountCode: true, partyId: true, debitCents: true, creditCents: true },
  });
  const groups = new Map<string, typeof lines>();
  for (const l of lines) {
    const k = `${l.accountCode}|${l.partyId}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const codes: string[] = [];
  for (const group of groups.values()) {
    if (!canLetter(group)) continue;
    const code = await nextCode(ctx, group[0].accountCode, group[0].partyId);
    await ctx.tx.journalLine.updateMany({ where: { id: { in: group.map((l) => l.id) } }, data: { letteringCode: code } });
    codes.push(code);
  }
  return codes;
}
