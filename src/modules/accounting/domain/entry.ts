/**
 * Journal entry drafts, validation and builders (pure).
 * Builders turn business documents into balanced drafts; the posting service resolves
 * mapping keys to accounts, validates and writes them.
 */
import { sumCents, type Cents } from "@/lib/money";

export type DepartmentCode = "VN" | "VO" | "WORKSHOP" | "PARTS" | "ACCOUNTING" | "OVERHEAD";
export type PartyType = "CUSTOMER" | "SUPPLIER";

/** Either a mapping key (resolved through AccountMapping) or an explicit account code. */
export type AccountRef = { key: string } | { code: string };

export interface DraftLine {
  account: AccountRef;
  debitCents: Cents;
  creditCents: Cents;
  label: string;
  departmentCode?: DepartmentCode | null;
  partyType?: PartyType | null;
  partyId?: string | null;
}

export interface EntryDraft {
  journalCode: string;
  siteId: string;
  entryDate: Date;
  label: string;
  sourceType: string;
  sourceId?: string | null;
  lines: DraftLine[];
}

export interface ResolvedLine extends Omit<DraftLine, "account"> {
  accountCode: string;
}

export interface AccountInfo {
  code: string;
  postable: boolean;
  active: boolean;
  requiresAnalytic: boolean;
  isReceivable: boolean;
  isPayable: boolean;
}

export type EntryError =
  | { code: "TOO_FEW_LINES" }
  | { code: "UNBALANCED"; debitCents: Cents; creditCents: Cents }
  | { code: "EMPTY_ENTRY" }
  | { code: "INVALID_AMOUNT"; line: number }
  | { code: "UNKNOWN_ACCOUNT"; line: number; accountCode: string }
  | { code: "NOT_POSTABLE"; line: number; accountCode: string }
  | { code: "ANALYTIC_REQUIRED"; line: number; accountCode: string }
  | { code: "PARTY_REQUIRED"; line: number; accountCode: string; partyType: PartyType };

/** Validate a resolved entry. Returns every problem found (empty array = valid). */
export function validateEntry(lines: ResolvedLine[], accounts: Map<string, AccountInfo>): EntryError[] {
  const errors: EntryError[] = [];
  if (lines.length < 2) errors.push({ code: "TOO_FEW_LINES" });
  lines.forEach((l, i) => {
    const n = i + 1;
    const oneSided = (l.debitCents === 0) !== (l.creditCents === 0);
    if (!Number.isSafeInteger(l.debitCents) || !Number.isSafeInteger(l.creditCents) || l.debitCents < 0 || l.creditCents < 0 || !oneSided) {
      errors.push({ code: "INVALID_AMOUNT", line: n });
    }
    const a = accounts.get(l.accountCode);
    if (!a) {
      errors.push({ code: "UNKNOWN_ACCOUNT", line: n, accountCode: l.accountCode });
      return;
    }
    if (!a.postable || !a.active) errors.push({ code: "NOT_POSTABLE", line: n, accountCode: a.code });
    if (a.requiresAnalytic && !l.departmentCode) errors.push({ code: "ANALYTIC_REQUIRED", line: n, accountCode: a.code });
    if (a.isReceivable && (l.partyType !== "CUSTOMER" || !l.partyId)) {
      errors.push({ code: "PARTY_REQUIRED", line: n, accountCode: a.code, partyType: "CUSTOMER" });
    }
    if (a.isPayable && (l.partyType !== "SUPPLIER" || !l.partyId)) {
      errors.push({ code: "PARTY_REQUIRED", line: n, accountCode: a.code, partyType: "SUPPLIER" });
    }
  });
  const debitCents = sumCents(lines.map((l) => (Number.isSafeInteger(l.debitCents) ? l.debitCents : 0)));
  const creditCents = sumCents(lines.map((l) => (Number.isSafeInteger(l.creditCents) ? l.creditCents : 0)));
  if (debitCents !== creditCents) errors.push({ code: "UNBALANCED", debitCents, creditCents });
  if (lines.length >= 2 && debitCents === 0) errors.push({ code: "EMPTY_ENTRY" });
  return errors;
}

export function describeEntryError(e: EntryError): string {
  switch (e.code) {
    case "TOO_FEW_LINES":
      return "An entry needs at least two lines";
    case "UNBALANCED":
      return `Entry does not balance: debit ${(e.debitCents / 100).toFixed(2)} ≠ credit ${(e.creditCents / 100).toFixed(2)}`;
    case "EMPTY_ENTRY":
      return "Entry amounts are zero";
    case "INVALID_AMOUNT":
      return `Line ${e.line}: enter either a debit or a credit, positive`;
    case "UNKNOWN_ACCOUNT":
      return `Line ${e.line}: unknown account ${e.accountCode}`;
    case "NOT_POSTABLE":
      return `Line ${e.line}: account ${e.accountCode} cannot be posted to`;
    case "ANALYTIC_REQUIRED":
      return `Line ${e.line}: account ${e.accountCode} needs a department`;
    case "PARTY_REQUIRED":
      return `Line ${e.line}: account ${e.accountCode} needs a ${e.partyType.toLowerCase()}`;
  }
}

/** Swap debit and credit on every line (used for credit notes and reversals). */
export function mirrorLines<T extends { debitCents: Cents; creditCents: Cents }>(lines: T[]): T[] {
  return lines.map((l) => ({ ...l, debitCents: l.creditCents, creditCents: l.debitCents }));
}

function signed(amount: Cents): { debitCents: Cents; creditCents: Cents } {
  return amount >= 0 ? { debitCents: amount, creditCents: 0 } : { debitCents: 0, creditCents: -amount };
}

/** Drop zero lines; merge lines with identical account/department/party/label. */
export function compactLines(lines: DraftLine[]): DraftLine[] {
  const map = new Map<string, DraftLine & { net: number }>();
  for (const l of lines) {
    const ref = "key" in l.account ? `k:${l.account.key}` : `c:${l.account.code}`;
    const k = [ref, l.departmentCode ?? "", l.partyType ?? "", l.partyId ?? "", l.label].join("|");
    const net = l.debitCents - l.creditCents;
    const prev = map.get(k);
    if (prev) prev.net += net;
    else map.set(k, { ...l, net });
  }
  return [...map.values()]
    .filter((l) => l.net !== 0)
    .map(({ net, ...l }) => ({ ...l, ...signed(net) }));
}

// ── Builders ────────────────────────────────────────────────

export interface InvoiceForPosting {
  id: string;
  number: string;
  kind: "INVOICE" | "CREDIT_NOTE";
  siteId: string;
  issueDate: Date;
  customerId: string;
  customerName: string;
  /** RECEIVABLE_CUSTOMER or RECEIVABLE_OEM */
  receivableKey: string;
  vatRegime: "STANDARD" | "MARGIN";
  totalInclVatCents: Cents;
  lines: {
    label: string;
    lineExclVatCents: Cents;
    vatCents: Cents;
    vatRateCode: string;
    departmentCode: DepartmentCode;
    revenueKey: string;
    /** Defaults to the invoice regime. */
    vatRegime?: "STANDARD" | "MARGIN";
  }[];
}

/**
 * Sales invoice: Dr receivable (incl. VAT) / Cr revenue per line (excl. VAT, with department) / Cr VAT collected per rate.
 * Credit note: same entry mirrored.
 */
export function buildInvoiceEntry(inv: InvoiceForPosting, journalCode = "VE"): EntryDraft {
  const label = `${inv.kind === "CREDIT_NOTE" ? "Credit note" : "Invoice"} ${inv.number} ${inv.customerName}`.slice(0, 120);
  const lines: DraftLine[] = [
    {
      account: { key: inv.receivableKey },
      debitCents: inv.totalInclVatCents,
      creditCents: 0,
      label,
      partyType: "CUSTOMER",
      partyId: inv.customerId,
    },
  ];
  for (const l of inv.lines) {
    lines.push({ account: { key: l.revenueKey }, debitCents: 0, creditCents: l.lineExclVatCents, label, departmentCode: l.departmentCode });
    if (l.vatCents !== 0) {
      const vatKey = (l.vatRegime ?? inv.vatRegime) === "MARGIN" ? "VAT_COLLECTED_MARGIN" : `VAT_COLLECTED_${l.vatRateCode}`;
      lines.push({ account: { key: vatKey }, debitCents: 0, creditCents: l.vatCents, label });
    }
  }
  // Negative lines (e.g. discounts) end up on the right side after compaction.
  let compacted = compactLines(lines);
  if (inv.kind === "CREDIT_NOTE") compacted = mirrorLines(compacted);
  return {
    journalCode,
    siteId: inv.siteId,
    entryDate: inv.issueDate,
    label,
    sourceType: "INVOICE",
    sourceId: inv.id,
    lines: compacted,
  };
}

export interface PaymentForPosting {
  id: string;
  number: string;
  siteId: string;
  date: Date;
  direction: "IN" | "OUT";
  journalCode: string;
  treasury: AccountRef; // bank / cash / finance-company account
  /**
   * Set when the treasury side is itself a third-party account: a trade-in settles what the
   * dealer owes the customer for their car (467400) against what the customer owes (411).
   */
  treasuryParty?: { type: PartyType; id: string } | null;
  party: { type: PartyType; id: string; name: string; accountKey: string };
  amountCents: Cents;
}

/** Customer receipt: Dr treasury / Cr receivable. Supplier payment: Dr payable / Cr treasury. */
export function buildPaymentEntry(p: PaymentForPosting): EntryDraft {
  if (p.amountCents <= 0) throw new RangeError("Payment amount must be positive");
  const label = `${p.direction === "IN" ? "Receipt" : "Payment"} ${p.number} ${p.party.name}`.slice(0, 120);
  const treasuryLine: DraftLine = {
    account: p.treasury,
    debitCents: 0,
    creditCents: 0,
    label,
    ...(p.treasuryParty ? { partyType: p.treasuryParty.type, partyId: p.treasuryParty.id } : {}),
  };
  const partyLine: DraftLine = {
    account: { key: p.party.accountKey },
    debitCents: 0,
    creditCents: 0,
    label,
    partyType: p.party.type,
    partyId: p.party.id,
  };
  if (p.direction === "IN") {
    treasuryLine.debitCents = p.amountCents;
    partyLine.creditCents = p.amountCents;
  } else {
    partyLine.debitCents = p.amountCents;
    treasuryLine.creditCents = p.amountCents;
  }
  return {
    journalCode: p.journalCode,
    siteId: p.siteId,
    entryDate: p.date,
    label,
    sourceType: "PAYMENT",
    sourceId: p.id,
    lines: p.direction === "IN" ? [treasuryLine, partyLine] : [partyLine, treasuryLine],
  };
}

/**
 * Vehicle stock movement (perpetual inventory, D-005), journal OD.
 * IN / COST: Dr 37x stock / Cr 603x stock variation · OUT: Dr 603x / Cr 37x.
 */
export function buildStockMovementEntry(m: {
  siteId: string;
  date: Date;
  stockType: "VN" | "VO";
  movement: "IN" | "COST" | "OUT";
  amountCents: Cents;
  label: string;
  sourceType: string;
  sourceId: string | null;
}): EntryDraft {
  if (!Number.isSafeInteger(m.amountCents) || m.amountCents <= 0) throw new RangeError("Stock movement must be positive");
  const label = m.label.slice(0, 120);
  const stock: DraftLine = { account: { key: `STOCK_${m.stockType}` }, debitCents: 0, creditCents: 0, label };
  const variation: DraftLine = {
    account: { key: `STOCK_VARIATION_${m.stockType}` },
    debitCents: 0,
    creditCents: 0,
    label,
    departmentCode: m.stockType,
  };
  if (m.movement === "OUT") {
    variation.debitCents = m.amountCents;
    stock.creditCents = m.amountCents;
  } else {
    stock.debitCents = m.amountCents;
    variation.creditCents = m.amountCents;
  }
  return {
    journalCode: "OD",
    siteId: m.siteId,
    entryDate: m.date,
    label,
    sourceType: m.sourceType,
    sourceId: m.sourceId,
    lines: m.movement === "OUT" ? [variation, stock] : [stock, variation],
  };
}

/**
 * Parts stock movement (perpetual inventory): the parts stock account against stock variation
 * (receipts, sales, count variances) or against the liaison account (transfers between sites).
 * `valueCents` is signed: positive when value enters the site's stock. Journal OD.
 */
export function buildPartsStockEntry(m: {
  siteId: string;
  date: Date;
  valueCents: Cents;
  counterpart: "VARIATION" | "LIAISON";
  label: string;
  sourceType: string;
  sourceId: string | null;
}): EntryDraft {
  if (!Number.isSafeInteger(m.valueCents) || m.valueCents === 0) throw new RangeError("A stock movement needs a non-zero amount in cents");
  const label = m.label.slice(0, 120);
  const amount = Math.abs(m.valueCents);
  const entering = m.valueCents > 0;
  const stock: DraftLine = { account: { key: "STOCK_PARTS" }, debitCents: entering ? amount : 0, creditCents: entering ? 0 : amount, label };
  const other: DraftLine =
    m.counterpart === "VARIATION"
      ? { account: { key: "STOCK_VARIATION_PARTS" }, debitCents: stock.creditCents, creditCents: stock.debitCents, label, departmentCode: "PARTS" }
      : { account: { key: "SITE_LIAISON" }, debitCents: stock.creditCents, creditCents: stock.debitCents, label };
  return {
    journalCode: "OD",
    siteId: m.siteId,
    entryDate: m.date,
    label,
    sourceType: m.sourceType,
    sourceId: m.sourceId,
    lines: entering ? [stock, other] : [other, stock],
  };
}

/**
 * A supplier invoice matched to goods receipts: clears the goods-received-not-invoiced accrual at
 * receipt value, books the price variance to purchases, the deductible VAT and the supplier payable.
 * Journal AC.
 */
export function buildSupplierInvoiceEntry(p: {
  siteId: string;
  date: Date;
  label: string;
  sourceType: string;
  sourceId: string | null;
  supplierId: string;
  payable: AccountRef;
  receiptValueCents: Cents;
  varianceCents: Cents;
  vatCents: Cents;
  purchaseAccount: AccountRef;
  departmentCode: DepartmentCode;
}): EntryDraft {
  for (const v of [p.receiptValueCents, p.varianceCents, p.vatCents]) {
    if (!Number.isSafeInteger(v)) throw new RangeError("Amounts must be integer cents");
  }
  if (p.receiptValueCents < 0 || p.vatCents < 0) throw new RangeError("Receipt value and VAT cannot be negative");
  const total = p.receiptValueCents + p.varianceCents + p.vatCents;
  if (total <= 0) throw new RangeError("A supplier invoice must be positive");
  const label = p.label.slice(0, 120);
  const supplier = { partyType: "SUPPLIER" as const, partyId: p.supplierId };
  const lines: DraftLine[] = [
    { account: { key: "GOODS_RECEIVED_NOT_INVOICED" }, debitCents: p.receiptValueCents, creditCents: 0, label, ...supplier },
    {
      account: p.purchaseAccount,
      debitCents: Math.max(p.varianceCents, 0),
      creditCents: Math.max(-p.varianceCents, 0),
      label: `${label} — price variance`.slice(0, 120),
      departmentCode: p.departmentCode,
    },
    { account: { key: "VAT_DEDUCTIBLE_GOODS" }, debitCents: p.vatCents, creditCents: 0, label },
    { account: p.payable, debitCents: 0, creditCents: total, label, ...supplier },
  ];
  return {
    journalCode: "AC",
    siteId: p.siteId,
    entryDate: p.date,
    label,
    sourceType: p.sourceType,
    sourceId: p.sourceId,
    lines: compactLines(lines),
  };
}

/**
 * Purchase or cost accrual: Dr expense lines (with department) + Dr deductible VAT / Cr one counterpart
 * (supplier payable, private seller, goods-received-not-invoiced…). Journal AC by default.
 */
export function buildPurchaseEntry(p: {
  siteId: string;
  date: Date;
  label: string;
  sourceType: string;
  sourceId: string | null;
  journalCode?: string;
  lines: { account: AccountRef; amountCents: Cents; departmentCode: DepartmentCode }[];
  vatCents?: Cents;
  credit: { account: AccountRef; partyType?: PartyType | null; partyId?: string | null };
}): EntryDraft {
  const label = p.label.slice(0, 120);
  const vat = p.vatCents ?? 0;
  if (p.lines.some((l) => !Number.isSafeInteger(l.amountCents)) || !Number.isSafeInteger(vat) || vat < 0) {
    throw new RangeError("Amounts must be integer cents");
  }
  const total = sumCents(p.lines.map((l) => l.amountCents)) + vat;
  if (total <= 0) throw new RangeError("A purchase must be positive");
  const lines: DraftLine[] = p.lines.map((l) => ({
    account: l.account,
    debitCents: l.amountCents,
    creditCents: 0,
    label,
    departmentCode: l.departmentCode,
  }));
  if (vat > 0) lines.push({ account: { key: "VAT_DEDUCTIBLE_GOODS" }, debitCents: vat, creditCents: 0, label });
  lines.push({ account: p.credit.account, debitCents: 0, creditCents: total, label, partyType: p.credit.partyType ?? null, partyId: p.credit.partyId ?? null });
  return {
    journalCode: p.journalCode ?? "AC",
    siteId: p.siteId,
    entryDate: p.date,
    label,
    sourceType: p.sourceType,
    sourceId: p.sourceId,
    lines: compactLines(lines),
  };
}

/**
 * Work done by one department for another (OD): the workshop "sells" its labour and parts to
 * used-car reconditioning at the internal rate. Dr the buyer's account (one amount), Cr each
 * internal revenue line on its department. Group-wide it nets to zero; per department it shows
 * the workshop's internal production and the true reconditioning cost.
 */
export function buildInternalWorkEntry(p: {
  siteId: string;
  date: Date;
  label: string;
  sourceType: string;
  sourceId: string | null;
  debit: { account: AccountRef; departmentCode: DepartmentCode };
  credits: { account: AccountRef; amountCents: Cents; departmentCode: DepartmentCode }[];
}): EntryDraft {
  const label = p.label.slice(0, 120);
  if (p.credits.some((c) => !Number.isSafeInteger(c.amountCents) || c.amountCents < 0)) throw new RangeError("Amounts must be positive integer cents");
  const total = sumCents(p.credits.map((c) => c.amountCents));
  if (total <= 0) throw new RangeError("Internal work must have a positive value");
  const lines: DraftLine[] = [
    { account: p.debit.account, debitCents: total, creditCents: 0, label, departmentCode: p.debit.departmentCode },
    ...p.credits.filter((c) => c.amountCents > 0).map((c) => ({ account: c.account, debitCents: 0, creditCents: c.amountCents, label, departmentCode: c.departmentCode })),
  ];
  return { journalCode: "OD", siteId: p.siteId, entryDate: p.date, label, sourceType: p.sourceType, sourceId: p.sourceId, lines: compactLines(lines) };
}

/** Reversal of a posted entry: same lines, sides swapped, new date. */
export function buildReversal(
  original: { id: string; number: string; journalCode: string; siteId: string; lines: ResolvedLine[] },
  date: Date,
  reason: string,
): EntryDraft {
  const label = `Reversal of ${original.number}${reason ? ` — ${reason}` : ""}`.slice(0, 120);
  return {
    journalCode: original.journalCode,
    siteId: original.siteId,
    entryDate: date,
    label,
    sourceType: "REVERSAL",
    sourceId: original.id,
    lines: mirrorLines(original.lines).map((l) => ({
      account: { code: l.accountCode },
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      label,
      departmentCode: l.departmentCode,
      partyType: l.partyType,
      partyId: l.partyId,
    })),
  };
}

/** Opening balances: one line per balance; the difference goes to the balancing account. */
export function buildOpeningEntry(args: {
  siteId: string;
  date: Date;
  balances: { account: AccountRef; amountCents: Cents; label: string; partyType?: PartyType; partyId?: string }[];
  balancingAccount: AccountRef;
}): EntryDraft {
  const lines: DraftLine[] = args.balances
    .filter((b) => b.amountCents !== 0)
    .map((b) => ({ account: b.account, ...signed(b.amountCents), label: b.label, partyType: b.partyType, partyId: b.partyId }));
  const net = sumCents(lines.map((l) => l.debitCents - l.creditCents));
  if (net !== 0) lines.push({ account: args.balancingAccount, ...signed(-net), label: "Opening balance" });
  return { journalCode: "AN", siteId: args.siteId, entryDate: args.date, label: "Opening balances", sourceType: "OPENING", lines };
}

/** Lines can be lettered (matched) together only if they net to zero. */
export function canLetter(lines: { debitCents: Cents; creditCents: Cents }[]): boolean {
  return lines.length >= 2 && sumCents(lines.map((l) => l.debitCents - l.creditCents)) === 0;
}

/** Lettering codes: A..Z, AA..ZZ, AAA… (spreadsheet-style). */
export function letteringCode(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Inverse of `letteringCode` (A → 0, AA → 26). */
export function letteringIndex(code: string): number {
  let n = 0;
  for (const ch of code) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
