/**
 * Financial reports (pure): P&L and gross margin by department, ageing of open items,
 * VAT return and the FEC (fichier des écritures comptables) layout.
 */
import type { Cents } from "@/lib/money";
import { daysBetween } from "@/lib/dates";

// ── P&L by department ───────────────────────────────────────

export const DEPARTMENTS = ["VN", "VO", "WORKSHOP", "PARTS", "ACCOUNTING", "OVERHEAD"] as const;
export type Department = (typeof DEPARTMENTS)[number];
/** Lines posted without a department. */
export const UNALLOCATED = "UNALLOCATED" as const;
export type DepartmentColumn = Department | typeof UNALLOCATED;

export type PnlSection = "REVENUE" | "COST_OF_SALES" | "EXPENSES" | "OTHER_INCOME";

/**
 * Where an income-statement account goes. 70 = sales, 60 = purchases and stock variation
 * (cost of sales), 61–69 = operating, financial and exceptional expenses, 71–79 = other income.
 * Balance-sheet accounts (classes 1–5) return null.
 */
export function pnlSection(accountCode: string): PnlSection | null {
  if (accountCode.startsWith("70")) return "REVENUE";
  if (accountCode.startsWith("60")) return "COST_OF_SALES";
  if (accountCode.startsWith("6")) return "EXPENSES";
  if (accountCode.startsWith("7")) return "OTHER_INCOME";
  return null;
}

export type PnlMovement = {
  accountCode: string;
  label: string;
  departmentCode: string | null;
  debitCents: Cents;
  creditCents: Cents;
};

export type PnlFigures = {
  revenueCents: Cents;
  costOfSalesCents: Cents;
  grossMarginCents: Cents;
  /** Gross margin ÷ revenue, basis points (0 without revenue). */
  grossMarginBp: number;
  expensesCents: Cents;
  otherIncomeCents: Cents;
  resultCents: Cents;
};

export type PnlLine = { section: PnlSection; accountCode: string; label: string; byDepartment: Record<DepartmentColumn, Cents>; totalCents: Cents };

export type ProfitAndLoss = {
  columns: DepartmentColumn[];
  lines: PnlLine[];
  byDepartment: Record<DepartmentColumn, PnlFigures>;
  total: PnlFigures;
};

/** Ratio in basis points, rounded half away from zero; 0 when the base is 0. */
export function ratioBp(part: number, whole: number): number {
  if (!whole) return 0;
  const r = (part * 10000) / whole;
  return Math.sign(r) * Math.round(Math.abs(r));
}

function figures(rev: Cents, cos: Cents, exp: Cents, other: Cents): PnlFigures {
  const gross = rev - cos;
  return {
    revenueCents: rev,
    costOfSalesCents: cos,
    grossMarginCents: gross,
    grossMarginBp: ratioBp(gross, rev),
    expensesCents: exp,
    otherIncomeCents: other,
    resultCents: gross - exp + other,
  };
}

/**
 * P&L by department. Amounts are shown positive in their natural direction:
 * revenue and other income as credit − debit, costs and expenses as debit − credit.
 * Columns: the six departments that have movements, then UNALLOCATED if any line has none.
 */
export function profitAndLoss(movements: PnlMovement[]): ProfitAndLoss {
  const keyOf = (d: string | null): DepartmentColumn => ((DEPARTMENTS as readonly string[]).includes(d ?? "") ? (d as Department) : UNALLOCATED);
  const zero = () => Object.fromEntries([...DEPARTMENTS, UNALLOCATED].map((d) => [d, 0])) as Record<DepartmentColumn, Cents>;
  const lines = new Map<string, PnlLine>();
  const used = new Set<DepartmentColumn>();
  for (const m of movements) {
    const section = pnlSection(m.accountCode);
    if (!section) continue;
    const amount = section === "REVENUE" || section === "OTHER_INCOME" ? m.creditCents - m.debitCents : m.debitCents - m.creditCents;
    if (amount === 0 && m.debitCents === 0) continue;
    const line = lines.get(m.accountCode) ?? { section, accountCode: m.accountCode, label: m.label, byDepartment: zero(), totalCents: 0 };
    const dep = keyOf(m.departmentCode);
    line.byDepartment[dep] += amount;
    line.totalCents += amount;
    used.add(dep);
    lines.set(m.accountCode, line);
  }
  const sorted = [...lines.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const columns = ([...DEPARTMENTS, UNALLOCATED] as DepartmentColumn[]).filter((d) => used.has(d));
  const sum = (section: PnlSection, dep?: DepartmentColumn) =>
    sorted.filter((l) => l.section === section).reduce((s, l) => s + (dep ? l.byDepartment[dep] : l.totalCents), 0);
  const byDepartment = Object.fromEntries(
    [...DEPARTMENTS, UNALLOCATED].map((d) => [d, figures(sum("REVENUE", d), sum("COST_OF_SALES", d), sum("EXPENSES", d), sum("OTHER_INCOME", d))]),
  ) as Record<DepartmentColumn, PnlFigures>;
  return {
    columns,
    lines: sorted,
    byDepartment,
    total: figures(sum("REVENUE"), sum("COST_OF_SALES"), sum("EXPENSES"), sum("OTHER_INCOME")),
  };
}

// ── Ageing ──────────────────────────────────────────────────

export const AGEING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90plus"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];
export type AgeingTotals = Record<AgeingBucket, Cents> & { totalCents: Cents };

/** Bucket of an open item: not yet due, then by days past its due date. */
export function ageingBucket(dueDate: Date, asOf: Date): AgeingBucket {
  const late = daysBetween(dueDate, asOf);
  if (late <= 0) return "current";
  if (late <= 30) return "d1_30";
  if (late <= 60) return "d31_60";
  if (late <= 90) return "d61_90";
  return "d90plus";
}

export function emptyAgeing(): AgeingTotals {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, totalCents: 0 };
}

/** Sum open items into ageing buckets. */
export function ageItems(items: { dueDate: Date; openCents: Cents }[], asOf: Date): AgeingTotals {
  const t = emptyAgeing();
  for (const i of items) {
    if (i.openCents === 0) continue;
    t[ageingBucket(i.dueDate, asOf)] += i.openCents;
    t.totalCents += i.openCents;
  }
  return t;
}

/**
 * Open items of a party account without due dates (FIFO): payments settle the oldest
 * documents first, so the balance is made of the most recent ones. `sign` is +1 for an
 * account whose open side is debit (receivable), −1 for credit (payable).
 * Returns the open part of each line that still carries the balance, newest first.
 */
export function fifoOpenItems<T extends { date: Date; debitCents: Cents; creditCents: Cents }>(lines: T[], sign: 1 | -1): { line: T; openCents: Cents }[] {
  const balance = sign * lines.reduce((s, l) => s + l.debitCents - l.creditCents, 0);
  if (balance <= 0) return [];
  const sameSide = lines
    .map((l) => ({ line: l, amount: sign * (l.debitCents - l.creditCents) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.line.date.getTime() - a.line.date.getTime());
  const out: { line: T; openCents: Cents }[] = [];
  let left = balance;
  for (const x of sameSide) {
    if (left <= 0) break;
    const open = Math.min(left, x.amount);
    out.push({ line: x.line, openCents: open });
    left -= open;
  }
  return out;
}

// ── VAT return ──────────────────────────────────────────────

export type VatAccountMovement = { accountCode: string; label: string; debitCents: Cents; creditCents: Cents };
export type VatReturn = {
  collected: { accountCode: string; label: string; amountCents: Cents }[];
  deductible: { accountCode: string; label: string; amountCents: Cents }[];
  collectedCents: Cents;
  deductibleCents: Cents;
  /** Positive = VAT to pay, negative = credit to carry forward. */
  netDueCents: Cents;
};

/** The period's VAT from the VAT accounts: 4457x collected (credit), 4456x deductible (debit). */
export function vatReturn(movements: VatAccountMovement[]): VatReturn {
  const pick = (prefix: string, sign: 1 | -1) =>
    movements
      .filter((m) => m.accountCode.startsWith(prefix))
      .map((m) => ({ accountCode: m.accountCode, label: m.label, amountCents: sign * (m.creditCents - m.debitCents) }))
      .filter((m) => m.amountCents !== 0)
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const collected = pick("4457", 1);
  const deductible = pick("4456", -1);
  const collectedCents = collected.reduce((s, m) => s + m.amountCents, 0);
  const deductibleCents = deductible.reduce((s, m) => s + m.amountCents, 0);
  return { collected, deductible, collectedCents, deductibleCents, netDueCents: collectedCents - deductibleCents };
}

// ── FEC ─────────────────────────────────────────────────────

export const FEC_COLUMNS = [
  "JournalCode",
  "JournalLib",
  "EcritureNum",
  "EcritureDate",
  "CompteNum",
  "CompteLib",
  "CompAuxNum",
  "CompAuxLib",
  "PieceRef",
  "PieceDate",
  "EcritureLib",
  "Debit",
  "Credit",
  "EcritureLet",
  "DateLet",
  "ValidDate",
  "Montantdevise",
  "Idevise",
] as const;

export type FecLine = {
  journalCode: string;
  journalLabel: string;
  entryNumber: string;
  entryDate: Date;
  accountCode: string;
  accountLabel: string;
  auxAccount: string | null;
  auxLabel: string | null;
  pieceRef: string;
  pieceDate: Date;
  label: string;
  debitCents: Cents;
  creditCents: Cents;
  lettering: string | null;
  letteringDate: Date | null;
  validDate: Date;
};

/** YYYYMMDD. */
export function fecDate(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

/** Amount with a comma as decimal separator and no thousands separator: 1234.5 € → "1234,50". */
export function fecAmount(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Text field: no separator, no line break. */
function fecText(s: string | null): string {
  return (s ?? "").replace(/[|\t\r\n]+/g, " ").replace(/ {2,}/g, " ").trim();
}

export function fecRow(l: FecLine): string {
  return [
    fecText(l.journalCode),
    fecText(l.journalLabel),
    fecText(l.entryNumber),
    fecDate(l.entryDate),
    fecText(l.accountCode),
    fecText(l.accountLabel),
    fecText(l.auxAccount),
    fecText(l.auxLabel),
    fecText(l.pieceRef),
    fecDate(l.pieceDate),
    fecText(l.label),
    fecAmount(l.debitCents),
    fecAmount(l.creditCents),
    fecText(l.lettering),
    fecDate(l.letteringDate),
    fecDate(l.validDate),
    "",
    "",
  ].join("|");
}

/** The whole file: header line, then one row per journal line (CRLF, pipe-separated). */
export function fecFile(lines: FecLine[]): string {
  return [FEC_COLUMNS.join("|"), ...lines.map(fecRow)].join("\r\n") + "\r\n";
}

/** `<SIREN>FEC<closing date YYYYMMDD>.txt`. */
export function fecFileName(siren: string, closingDate: Date): string {
  return `${siren.replace(/\s+/g, "")}FEC${fecDate(closingDate)}.txt`;
}
