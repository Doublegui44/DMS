/** Financial reports: P&L by department, VAT return, ageing balances, FEC export. */
import type { Prisma } from "@prisma/client";
import { siteScopeWhere, type ServiceContext } from "@/lib/context";
import { addDays, toDateOnly } from "@/lib/dates";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { ListParams } from "@/lib/list";
import {
  ageItems,
  emptyAgeing,
  fecFile,
  fecFileName,
  fifoOpenItems,
  profitAndLoss,
  vatReturn,
  AGEING_BUCKETS,
  type AgeingTotals,
  type FecLine,
} from "../domain/reports";

export type ReportRange = { from: Date; to: Date; siteId?: string | null };

function lineWhere(ctx: ServiceContext, r: ReportRange): Prisma.JournalLineWhereInput {
  const where: Prisma.JournalLineWhereInput = { ...siteScopeWhere(ctx.actor), entryDate: { gte: r.from, lte: r.to } };
  if (r.siteId) where.siteId = r.siteId;
  return where;
}

async function accountLabels(ctx: ServiceContext, codes: string[]) {
  const accounts = await ctx.tx.account.findMany({ where: { code: { in: codes } }, select: { code: true, label: true } });
  return new Map(accounts.map((a) => [a.code, a.label]));
}

/** First and last day of a month (UTC dates). */
export function monthRange(year: number, month: number): { from: Date; to: Date } {
  if (!Number.isInteger(year) || month < 1 || month > 12) throw new ValidationError("Invalid period", { period: ["Invalid period"] });
  return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 0)) };
}

// ── P&L ─────────────────────────────────────────────────────

export async function getProfitAndLoss(ctx: ServiceContext, r: ReportRange) {
  ctx.require("accounting.report", "view");
  const sums = await ctx.tx.journalLine.groupBy({
    by: ["accountCode", "departmentCode"],
    where: { ...lineWhere(ctx, r), OR: [{ accountCode: { startsWith: "6" } }, { accountCode: { startsWith: "7" } }] },
    _sum: { debitCents: true, creditCents: true },
  });
  const labels = await accountLabels(ctx, [...new Set(sums.map((s) => s.accountCode))]);
  return profitAndLoss(
    sums.map((s) => ({
      accountCode: s.accountCode,
      label: labels.get(s.accountCode) ?? s.accountCode,
      departmentCode: s.departmentCode,
      debitCents: s._sum.debitCents ?? 0,
      creditCents: s._sum.creditCents ?? 0,
    })),
  );
}

/** Gross margin per department for each month of a range (dashboards). */
export async function getMonthlyGrossMargin(ctx: ServiceContext, r: ReportRange) {
  ctx.require("accounting.report", "view");
  const where = { ...lineWhere(ctx, r), OR: [{ accountCode: { startsWith: "60" } }, { accountCode: { startsWith: "70" } }] };
  const lines = await ctx.tx.journalLine.groupBy({
    by: ["entryDate", "departmentCode"],
    where,
    _sum: { debitCents: true, creditCents: true },
  });
  const months = new Map<string, Record<string, number>>();
  for (const l of lines) {
    const key = l.entryDate.toISOString().slice(0, 7);
    const m = months.get(key) ?? {};
    const dep = l.departmentCode ?? "UNALLOCATED";
    m[dep] = (m[dep] ?? 0) + (l._sum.creditCents ?? 0) - (l._sum.debitCents ?? 0);
    months.set(key, m);
  }
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, byDepartment]) => ({ month, byDepartment }));
}

// ── VAT ─────────────────────────────────────────────────────

export async function getVatReport(ctx: ServiceContext, a: { year: number; month: number; siteId?: string | null }) {
  ctx.require("accounting.report", "view");
  const range = { ...monthRange(a.year, a.month), siteId: a.siteId };
  const sums = await ctx.tx.journalLine.groupBy({
    by: ["accountCode"],
    where: { ...lineWhere(ctx, range), accountCode: { startsWith: "445" } },
    _sum: { debitCents: true, creditCents: true },
  });
  const labels = await accountLabels(ctx, sums.map((s) => s.accountCode));
  const ret = vatReturn(
    sums.map((s) => ({ accountCode: s.accountCode, label: labels.get(s.accountCode) ?? s.accountCode, debitCents: s._sum.debitCents ?? 0, creditCents: s._sum.creditCents ?? 0 })),
  );

  // Sales by regime and rate, from the invoices and credit notes issued in the month.
  const invoiceWhere: Prisma.InvoiceWhereInput = { ...siteScopeWhere(ctx.actor), status: { not: "DRAFT" }, issueDate: { gte: range.from, lte: range.to } };
  if (a.siteId) invoiceWhere.siteId = a.siteId;
  const lines = await ctx.tx.invoiceLine.groupBy({
    by: ["vatRegime", "vatRateBp", "vatRateCode"],
    where: { invoice: { ...invoiceWhere, kind: "INVOICE" } },
    _sum: { lineExclVatCents: true, vatCents: true },
  });
  const credits = await ctx.tx.invoiceLine.groupBy({
    by: ["vatRegime", "vatRateBp", "vatRateCode"],
    where: { invoice: { ...invoiceWhere, kind: "CREDIT_NOTE" } },
    _sum: { lineExclVatCents: true, vatCents: true },
  });
  const bases = new Map<string, { vatRegime: string; vatRateCode: string; vatRateBp: number; baseCents: number; vatCents: number }>();
  for (const [rows, sign] of [
    [lines, 1],
    [credits, -1],
  ] as const) {
    for (const l of rows) {
      const key = `${l.vatRegime}|${l.vatRateCode}`;
      const b = bases.get(key) ?? { vatRegime: l.vatRegime, vatRateCode: l.vatRateCode, vatRateBp: l.vatRateBp, baseCents: 0, vatCents: 0 };
      b.baseCents += sign * (l._sum.lineExclVatCents ?? 0);
      b.vatCents += sign * (l._sum.vatCents ?? 0);
      bases.set(key, b);
    }
  }
  const sales = [...bases.values()].sort((x, y) => x.vatRegime.localeCompare(y.vatRegime) || y.vatRateBp - x.vatRateBp);
  const invoicedVatCents = sales.reduce((s, b) => s + b.vatCents, 0);
  const period = await ctx.tx.fiscalPeriod.findUnique({ where: { year_month: { year: a.year, month: a.month } } });
  return { ...ret, ...range, year: a.year, month: a.month, sales, invoicedVatCents, unexplainedCents: ret.collectedCents - invoicedVatCents, periodStatus: period?.status ?? "OPEN" };
}

// ── Ageing ──────────────────────────────────────────────────

/** `totalCents` = open documents aged; `unappliedCents` = money not matched to them; `balanceCents` = the account balance. */
type AgeingRow = AgeingTotals & { partyId: string; name: string; accountCode: string; unappliedCents: number; balanceCents: number };
export type AgeingSummary = AgeingTotals & { unappliedCents: number; balanceCents: number };

function addInto(t: AgeingTotals, a: AgeingTotals) {
  for (const b of AGEING_BUCKETS) t[b] += a[b];
  t.totalCents += a.totalCents;
}

function page<T>(rows: T[], p: ListParams, all?: boolean) {
  if (all) return rows;
  const start = (p.page - 1) * p.pageSize;
  return rows.slice(start, start + p.pageSize);
}

/**
 * Receivables: open invoices (less open credit notes) by days past due, per customer. Money received
 * but not yet matched to an invoice (deposits, payments on account) shows as `unappliedCents`, so
 * `balanceCents` equals the customer's balance on 411.
 */
export async function getReceivablesAgeing(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("accounting.report", "view");
  const asOf = ctx.businessDate;
  const where: Prisma.InvoiceWhereInput = { ...siteScopeWhere(ctx.actor), status: { in: ["ISSUED", "PARTIALLY_PAID"] } };
  const glWhere: Prisma.JournalLineWhereInput = { ...siteScopeWhere(ctx.actor), partyType: "CUSTOMER", accountCode: { startsWith: "411" } };
  if (p.filters.site) where.siteId = glWhere.siteId = p.filters.site;
  const [open, gl] = await Promise.all([
    ctx.tx.invoice.findMany({ where, select: { customerId: true, kind: true, issueDate: true, dueDate: true, totalInclVatCents: true, paidCents: true } }),
    ctx.tx.journalLine.groupBy({ by: ["partyId"], where: glWhere, _sum: { debitCents: true, creditCents: true } }),
  ]);
  const ids = [...new Set([...open.map((i) => i.customerId), ...gl.map((g) => g.partyId!).filter(Boolean)])];
  const customers = new Map(
    (await ctx.tx.customer.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, accountCode: true, kind: true } })).map((c) => [c.id, c]),
  );
  const items = new Map<string, { dueDate: Date; openCents: number }[]>();
  for (const i of open) {
    const sign = i.kind === "CREDIT_NOTE" ? -1 : 1;
    items.set(i.customerId, [...(items.get(i.customerId) ?? []), { dueDate: i.dueDate ?? i.issueDate ?? asOf, openCents: sign * (i.totalInclVatCents - i.paidCents) }]);
  }
  const glBalance = new Map(gl.map((g) => [g.partyId!, (g._sum.debitCents ?? 0) - (g._sum.creditCents ?? 0)]));
  const rows: AgeingRow[] = [];
  for (const id of ids) {
    const c = customers.get(id);
    if (!c || (p.filters.kind && c.kind !== p.filters.kind)) continue;
    const aged = ageItems(items.get(id) ?? [], asOf);
    const balance = glBalance.get(id) ?? 0;
    rows.push({ ...aged, partyId: id, name: c.displayName, accountCode: c.accountCode, unappliedCents: balance - aged.totalCents, balanceCents: balance });
  }
  return ageingResult(rows, p, opts.all, asOf);
}

/** Payables: supplier balances on 40x, open documents found FIFO and due after the supplier's terms. */
export async function getPayablesAgeing(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("accounting.report", "view");
  const asOf = ctx.businessDate;
  const where: Prisma.JournalLineWhereInput = { ...siteScopeWhere(ctx.actor), partyType: "SUPPLIER", accountCode: { startsWith: "40" }, NOT: { accountCode: { startsWith: "408" } } };
  if (p.filters.site) where.siteId = p.filters.site;
  const lines = await ctx.tx.journalLine.findMany({ where, select: { partyId: true, entryDate: true, debitCents: true, creditCents: true } });
  const suppliers = await ctx.tx.supplier.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.partyId!).filter(Boolean))] } },
    select: { id: true, name: true, accountCode: true, paymentTermsDays: true },
  });
  const rows: AgeingRow[] = [];
  for (const s of suppliers) {
    const mine = lines.filter((l) => l.partyId === s.id).map((l) => ({ date: l.entryDate, debitCents: l.debitCents, creditCents: l.creditCents }));
    const items = fifoOpenItems(mine, -1).map((o) => ({ dueDate: addDays(o.line.date, s.paymentTermsDays), openCents: o.openCents }));
    const totals = ageItems(items, asOf);
    const balance = -mine.reduce((t, l) => t + l.debitCents - l.creditCents, 0);
    if (totals.totalCents || balance) rows.push({ ...totals, partyId: s.id, name: s.name, accountCode: s.accountCode, unappliedCents: balance - totals.totalCents, balanceCents: balance });
  }
  return ageingResult(rows, p, opts.all, asOf);
}

function ageingResult(rows: AgeingRow[], p: ListParams, all: boolean | undefined, asOf: Date) {
  let list = rows.filter((r) => r.totalCents !== 0 || r.balanceCents !== 0);
  if (p.q) {
    const q = p.q.toLowerCase();
    list = list.filter((r) => r.name.toLowerCase().includes(q) || r.accountCode.toLowerCase().includes(q));
  }
  if (p.filters.overdue === "1") list = list.filter((r) => r.totalCents - r.current !== 0);
  list.sort((a, b) => b.balanceCents - a.balanceCents || a.name.localeCompare(b.name));
  const totals: AgeingSummary = { ...emptyAgeing(), unappliedCents: 0, balanceCents: 0 };
  for (const r of list) {
    addInto(totals, r);
    totals.unappliedCents += r.unappliedCents;
    totals.balanceCents += r.balanceCents;
  }
  return { rows: page(list, p, all), total: list.length, totals, asOf, page: p.page, pageSize: p.pageSize };
}

// ── FEC ─────────────────────────────────────────────────────

/** Every journal line of a fiscal year in the FEC layout. Group-wide: the file is per legal entity. */
export async function getFecExport(ctx: ServiceContext, year: number) {
  ctx.require("accounting.report", "view");
  // The file covers the whole legal entity: only group-wide users may export it.
  if (ctx.actor.siteIds !== "ALL") throw new ForbiddenError("accounting.report", "view");
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31));
  const [group, entries, journals, accounts] = await Promise.all([
    ctx.tx.group.findFirst(),
    ctx.tx.journalEntry.findMany({
      where: { entryDate: { gte: from, lte: to } },
      orderBy: [{ entryDate: "asc" }, { number: "asc" }],
      include: { lines: { orderBy: { lineNo: "asc" } } },
    }),
    ctx.tx.journal.findMany({ select: { code: true, label: true } }),
    ctx.tx.account.findMany({ select: { code: true, label: true } }),
  ]);
  const journalLabel = new Map(journals.map((j) => [j.code, j.label]));
  const accountLabel = new Map(accounts.map((a) => [a.code, a.label]));
  const lines = entries.flatMap((e) => e.lines);

  // Auxiliary accounts.
  const customerIds = [...new Set(lines.filter((l) => l.partyType === "CUSTOMER").map((l) => l.partyId!))];
  const supplierIds = [...new Set(lines.filter((l) => l.partyType === "SUPPLIER").map((l) => l.partyId!))];
  const [customers, suppliers] = await Promise.all([
    ctx.tx.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, displayName: true, accountCode: true } }),
    ctx.tx.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true, accountCode: true } }),
  ]);
  const aux = new Map<string, { code: string; name: string }>([
    ...customers.map((c) => [c.id, { code: c.accountCode, name: c.displayName }] as const),
    ...suppliers.map((s) => [s.id, { code: s.accountCode, name: s.name }] as const),
  ]);

  // Supporting documents: the invoice or payment number when the entry comes from one.
  const ids = (type: string) => entries.filter((e) => e.sourceType === type && e.sourceId).map((e) => e.sourceId!);
  const [invoices, payments] = await Promise.all([
    ctx.tx.invoice.findMany({ where: { id: { in: ids("INVOICE") } }, select: { id: true, number: true, issueDate: true } }),
    ctx.tx.payment.findMany({ where: { id: { in: ids("PAYMENT") } }, select: { id: true, number: true, businessDate: true } }),
  ]);
  const pieces = new Map<string, { ref: string; date: Date }>([
    ...invoices.filter((i) => i.number).map((i) => [i.id, { ref: i.number!, date: i.issueDate! }] as const),
    ...payments.map((pm) => [pm.id, { ref: pm.number, date: pm.businessDate }] as const),
  ]);

  // A lettering is dated by its last line.
  const letteredOn = new Map<string, Date>();
  const lettered = await ctx.tx.journalLine.groupBy({ by: ["accountCode", "letteringCode"], where: { letteringCode: { not: null } }, _max: { entryDate: true } });
  for (const l of lettered) letteredOn.set(`${l.accountCode}|${l.letteringCode}`, l._max.entryDate!);

  const fec: FecLine[] = entries.flatMap((e) => {
    const piece = (e.sourceId && pieces.get(e.sourceId)) || { ref: e.number, date: e.entryDate };
    return e.lines.map((l) => {
      const party = l.partyId ? aux.get(l.partyId) : undefined;
      return {
        journalCode: e.journalCode,
        journalLabel: journalLabel.get(e.journalCode) ?? e.journalCode,
        entryNumber: e.number,
        entryDate: e.entryDate,
        accountCode: l.accountCode,
        accountLabel: accountLabel.get(l.accountCode) ?? l.accountCode,
        auxAccount: party?.code ?? null,
        auxLabel: party?.name ?? null,
        pieceRef: piece.ref,
        pieceDate: toDateOnly(piece.date),
        label: l.label || e.label,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        lettering: l.letteringCode,
        letteringDate: l.letteringCode ? (letteredOn.get(`${l.accountCode}|${l.letteringCode}`) ?? null) : null,
        validDate: e.entryDate,
      };
    });
  });
  const siren = group?.siren ?? "000000000";
  const closing = to;
  return {
    fileName: fecFileName(siren, closing),
    content: fecFile(fec),
    lineCount: fec.length,
    debitCents: fec.reduce((s, l) => s + l.debitCents, 0),
    creditCents: fec.reduce((s, l) => s + l.creditCents, 0),
  };
}

/** Debit − credit per site of the accounts starting with each prefix (e.g. "371"), up to a date. */
export async function getAccountBalancesBySite(ctx: ServiceContext, a: { prefixes: string[]; to?: Date }) {
  ctx.require("accounting.report", "view");
  const rows = await ctx.tx.journalLine.groupBy({
    by: ["siteId", "accountCode"],
    where: { ...siteScopeWhere(ctx.actor), OR: a.prefixes.map((p) => ({ accountCode: { startsWith: p } })), ...(a.to ? { entryDate: { lte: a.to } } : {}) },
    _sum: { debitCents: true, creditCents: true },
  });
  const out: { siteId: string; prefix: string; balanceCents: number }[] = [];
  for (const r of rows) {
    const prefix = a.prefixes.find((p) => r.accountCode.startsWith(p))!;
    const cur = out.find((o) => o.siteId === r.siteId && o.prefix === prefix);
    const amount = (r._sum.debitCents ?? 0) - (r._sum.creditCents ?? 0);
    if (cur) cur.balanceCents += amount;
    else out.push({ siteId: r.siteId, prefix, balanceCents: amount });
  }
  return out;
}
