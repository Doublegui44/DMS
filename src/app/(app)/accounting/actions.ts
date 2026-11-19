"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { command } from "@/lib/session";
import { parseEuros } from "@/lib/money";
import { ValidationError } from "@/lib/errors";
import { formDataToObject } from "@/lib/validation";
import {
  REVENUE_KEYS,
  createAccount,
  createInvoice,
  creditInvoice,
  deleteDraftInvoice,
  issueInvoice,
  letterLines,
  lockPeriod,
  postManualEntry,
  recordPayment,
  reopenPeriod,
  reverseEntry,
  unletter,
  updateAccount,
  type AccountInput,
} from "@/modules/accounting";
import type { FormState } from "@/components/shared/form";

/** Euro text from a form → cents; empty → 0. Errors become field errors. */
function cents(value: string | undefined, field: string): number {
  if (value === undefined || value.trim() === "") return 0;
  try {
    return parseEuros(value);
  } catch {
    throw new ValidationError(`Invalid amount: ${value}`, { [field]: ["Invalid amount"] });
  }
}

function percentToBp(value: string | undefined): number {
  if (!value || value.trim() === "") return 0;
  return Math.round(cents(value, "discount")); // "10" → 1000 bp (a percentage parses like euros)
}

const ok = (id: string, redirectTo?: string): FormState => ({ ok: true, data: { id, redirectTo } });

// ── Entries ─────────────────────────────────────────────────

export interface EntryFormInput {
  journalCode: string;
  siteId: string;
  entryDate: string;
  label: string;
  lines: { accountCode: string; debit: string; credit: string; label: string; departmentCode: string; partyType: string; partyId: string }[];
}

export async function postEntryAction(input: EntryFormInput): Promise<FormState> {
  const res = await command((ctx) =>
    postManualEntry(ctx, {
      ...input,
      lines: input.lines.map((l, i) => ({
        accountCode: l.accountCode,
        debitCents: cents(l.debit, `lines.${i}.debit`),
        creditCents: cents(l.credit, `lines.${i}.credit`),
        label: l.label,
        departmentCode: l.departmentCode,
        partyType: l.partyType,
        partyId: l.partyId,
      })),
    }),
  );
  if (!res.ok) return res;
  revalidatePath("/accounting/entries");
  return ok(res.data.id, `/accounting/entries/${res.data.id}`);
}

// The reverse and credit forms disappear once the action succeeds, so a client-side redirect
// would never run: redirect on the server instead.
export async function reverseEntryAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => reverseEntry(ctx, id, String(fd.get("reason") ?? "")));
  if (!res.ok) return res;
  revalidatePath("/accounting/entries");
  redirect(`/accounting/entries/${res.data.id}`);
}

// ── Invoices ────────────────────────────────────────────────

export interface InvoiceFormInput {
  siteId: string;
  customerId: string;
  notes: string;
  issue: boolean;
  lines: { label: string; quantity: string; unitPrice: string; discount: string; vatRateCode: string; revenueKey: string }[];
}

export async function saveInvoiceAction(input: InvoiceFormInput): Promise<FormState> {
  const res = await command(async (ctx) => {
    const invoice = await createInvoice(ctx, {
      siteId: input.siteId,
      customerId: input.customerId,
      notes: input.notes,
      lines: input.lines.map((l, i) => ({
        label: l.label,
        quantity: Number(l.quantity.replace(",", ".")),
        unitPriceExclVatCents: cents(l.unitPrice, `lines.${i}.unitPrice`),
        discountBp: percentToBp(l.discount),
        vatRateCode: l.vatRateCode,
        revenueKey: l.revenueKey,
        departmentCode: REVENUE_KEYS.find((r) => r.key === l.revenueKey)?.department ?? "OVERHEAD",
      })),
    });
    return input.issue ? issueInvoice(ctx, invoice.id) : invoice;
  });
  if (!res.ok) return res;
  revalidatePath("/accounting/invoices");
  return ok(res.data.id, `/accounting/invoices/${res.data.id}`);
}

export async function issueInvoiceAction(id: string): Promise<FormState> {
  const res = await command((ctx) => issueInvoice(ctx, id));
  if (!res.ok) return res;
  revalidatePath("/accounting/invoices");
  return ok(id);
}

export async function deleteDraftInvoiceAction(id: string): Promise<FormState> {
  const res = await command((ctx) => deleteDraftInvoice(ctx, id));
  if (!res.ok) return res;
  revalidatePath("/accounting/invoices");
  return ok(id, "/accounting/invoices");
}

export async function creditInvoiceAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => creditInvoice(ctx, id, String(fd.get("reason") ?? "")));
  if (!res.ok) return res;
  revalidatePath("/accounting/invoices");
  redirect(`/accounting/invoices/${res.data.id}`);
}

// ── Payments ────────────────────────────────────────────────

export interface PaymentFormInput {
  siteId: string;
  direction: "IN" | "OUT";
  method: string;
  customerId: string;
  supplierId: string;
  amount: string;
  reference: string;
  allocations: { invoiceId: string; amount: string }[];
}

export async function recordPaymentAction(input: PaymentFormInput): Promise<FormState> {
  const res = await command((ctx) =>
    recordPayment(ctx, {
      siteId: input.siteId,
      direction: input.direction,
      method: input.method as "CARD",
      customerId: input.customerId,
      supplierId: input.supplierId,
      amountCents: cents(input.amount, "amount"),
      reference: input.reference,
      allocations: input.allocations
        .map((a) => ({ invoiceId: a.invoiceId, amountCents: cents(a.amount, "allocations") }))
        .filter((a) => a.amountCents > 0),
    }),
  );
  if (!res.ok) return res;
  revalidatePath("/accounting/payments");
  revalidatePath("/accounting/invoices");
  return ok(res.data.id, `/accounting/payments/${res.data.id}`);
}

// ── Periods ─────────────────────────────────────────────────

export async function lockPeriodAction(id: string): Promise<FormState> {
  const res = await command((ctx) => lockPeriod(ctx, id));
  if (!res.ok) return res;
  revalidatePath("/accounting/periods");
  return ok(id, `/accounting/periods?period=${id}`); // keep the period selected
}

export async function reopenPeriodAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => reopenPeriod(ctx, id, String(fd.get("reason") ?? "")));
  if (!res.ok) return res;
  revalidatePath("/accounting/periods");
  redirect(`/accounting/periods?period=${id}`);
}

// ── Chart ───────────────────────────────────────────────────

export async function saveAccountAction(code: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const input = formDataToObject(fd) as unknown as AccountInput;
  // Unchecked checkboxes are absent from FormData.
  for (const k of ["postable", "requiresAnalytic", "isReceivable", "isPayable", "active"] as const) {
    (input as Record<string, unknown>)[k] = fd.get(k) === "on";
  }
  const res = await command((ctx) => (code ? updateAccount(ctx, code, input) : createAccount(ctx, input)));
  if (!res.ok) return res;
  revalidatePath("/accounting/chart");
  return ok(res.data.code, `/accounting/chart/${res.data.code}`);
}

// ── Lettering ───────────────────────────────────────────────

export async function letterLinesAction(lineIds: string[]): Promise<FormState> {
  const res = await command((ctx) => letterLines(ctx, lineIds));
  if (!res.ok) return res;
  revalidatePath("/accounting/ledgers");
  return ok(res.data);
}

export async function unletterAction(args: { accountCode: string; partyId: string | null; code: string }): Promise<FormState> {
  const res = await command((ctx) => unletter(ctx, args));
  if (!res.ok) return res;
  revalidatePath("/accounting/ledgers");
  return ok(args.code);
}
