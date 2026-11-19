import type { ServiceContext } from "@/lib/context";
import { DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { nextDocumentNumber } from "@/modules/core";
import { buildReversal, describeEntryError, validateEntry, type EntryDraft, type ResolvedLine } from "../domain/entry";
import { manualEntrySchema, type ManualEntryInput } from "../schemas/accounting";
import { loadAccountInfo, resolveAccountRefs } from "./chart";
import { assertPeriodOpen } from "./periods";

declare module "@/lib/events" {
  interface DomainEventMap {
    JournalEntryPosted: { entryId: string; number: string; journalCode: string; sourceType: string; totalCents: number };
  }
}

/** Journals reserved for automatic postings (invoices, payments, opening). */
const AUTOMATIC_JOURNALS = new Set(["VE", "AN"]);

/**
 * Resolve, validate and write a journal entry. The only way entries get into the ledger.
 * Checks: mapping keys resolve, accounts exist and are postable, analytic and party rules,
 * balance, open period. The database re-checks balance (deferred trigger) and period lock.
 */
export async function postEntry(ctx: ServiceContext, draft: EntryDraft, opts: { brandId?: string | null } = {}) {
  const resolved = await resolveAccountRefs(ctx.tx, draft.lines.map((l) => l.account), { siteId: draft.siteId, brandId: opts.brandId });
  const lines: ResolvedLine[] = draft.lines.map(({ account, ...l }) => ({
    ...l,
    accountCode: "key" in account ? resolved.get(account.key)! : account.code,
  }));
  const accounts = await loadAccountInfo(ctx.tx, lines.map((l) => l.accountCode));
  const errors = validateEntry(lines, accounts);
  if (errors.length) {
    throw new DomainError("invalid_entry", errors.map(describeEntryError).join(" · "), { errors });
  }
  const journal = await ctx.tx.journal.findUnique({ where: { code: draft.journalCode } });
  if (!journal) throw new NotFoundError("Journal", draft.journalCode);
  const period = await assertPeriodOpen(ctx.tx, draft.entryDate);
  const number = await nextDocumentNumber(ctx, { docType: `JOURNAL_${draft.journalCode}`, scope: "GROUP", date: draft.entryDate });

  const entry = await ctx.tx.journalEntry.create({
    data: {
      number,
      journalCode: draft.journalCode,
      periodId: period.id,
      siteId: draft.siteId,
      entryDate: draft.entryDate,
      label: draft.label,
      sourceType: draft.sourceType,
      sourceId: draft.sourceId ?? null,
      reversalOfId: draft.sourceType === "REVERSAL" ? draft.sourceId ?? null : null,
      createdById: ctx.actor.userId,
      lines: {
        create: lines.map((l, i) => ({
          lineNo: i + 1,
          accountCode: l.accountCode,
          departmentCode: l.departmentCode ?? null,
          partyType: l.partyType ?? null,
          partyId: l.partyId ?? null,
          debitCents: l.debitCents,
          creditCents: l.creditCents,
          label: (l.label || draft.label).slice(0, 200),
          siteId: draft.siteId,
          entryDate: draft.entryDate,
        })),
      },
    },
  });
  const totalCents = lines.reduce((s, l) => s + l.debitCents, 0);
  await ctx.emit({
    type: "JournalEntryPosted",
    aggregateType: "JournalEntry",
    aggregateId: entry.id,
    siteId: draft.siteId,
    payload: { entryId: entry.id, number, journalCode: draft.journalCode, sourceType: draft.sourceType, totalCents },
  });
  return entry;
}

/** Manual OD entry typed by an accountant. */
export async function postManualEntry(ctx: ServiceContext, input: ManualEntryInput) {
  const data = parseInput(manualEntrySchema, input);
  ctx.require("accounting.entry", "create", data.siteId);
  if (AUTOMATIC_JOURNALS.has(data.journalCode)) {
    throw new ValidationError(`Journal ${data.journalCode} is reserved for automatic postings`, { journalCode: ["Reserved journal"] });
  }
  const entry = await postEntry(ctx, {
    journalCode: data.journalCode,
    siteId: data.siteId,
    entryDate: data.entryDate,
    label: data.label,
    sourceType: "MANUAL",
    lines: data.lines
      .filter((l) => l.debitCents !== 0 || l.creditCents !== 0)
      .map((l) => ({
        account: { code: l.accountCode },
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        label: l.label ?? data.label,
        departmentCode: l.departmentCode,
        partyType: l.partyType,
        partyId: l.partyId,
      })),
  });
  await ctx.audit({ action: "journal_entry.post", entityType: "JournalEntry", entityId: entry.id, siteId: data.siteId, after: data });
  return entry;
}

/**
 * Reverse a manual (or opening) entry at the business date. Entries generated from invoices
 * and payments are corrected through credit notes / payment cancellation instead.
 */
export async function reverseEntry(ctx: ServiceContext, entryId: string, reason: string) {
  const original = await ctx.tx.journalEntry.findUnique({ where: { id: entryId }, include: { lines: { orderBy: { lineNo: "asc" } }, reversedBy: true } });
  if (!original) throw new NotFoundError("JournalEntry", entryId);
  ctx.require("accounting.entry", "validate", original.siteId);
  if (original.reversedBy) throw new DomainError("already_reversed", `Entry ${original.number} is already reversed by ${original.reversedBy.number}`);
  if (original.sourceType !== "MANUAL" && original.sourceType !== "OPENING") {
    throw new DomainError("not_reversible", "Only manual entries can be reversed; use a credit note for invoices");
  }
  if (original.lines.some((l) => l.letteringCode)) throw new DomainError("lettered", "Unletter the entry's lines before reversing it");
  const draft = buildReversal(
    {
      id: original.id,
      number: original.number,
      journalCode: original.journalCode,
      siteId: original.siteId,
      lines: original.lines.map((l) => ({ ...l })),
    },
    ctx.businessDate,
    reason.trim(),
  );
  const reversal = await postEntry(ctx, draft);
  await ctx.audit({
    action: "journal_entry.reverse",
    entityType: "JournalEntry",
    entityId: original.id,
    siteId: original.siteId,
    after: { reversal: reversal.number, reason },
  });
  return reversal;
}
