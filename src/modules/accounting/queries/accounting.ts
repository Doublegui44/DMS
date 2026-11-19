import type { Prisma } from "@prisma/client";
import { siteScopeWhere, type ServiceContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { orderBy, pageArgs, type ListParams } from "@/lib/list";
import { trialBalance, netResult } from "../domain/trial-balance";
import { getCloseChecklist } from "../services/periods";
import { canLock } from "../domain/periods";

const dateRange = (p: ListParams): Prisma.DateTimeFilter | undefined => {
  const from = p.filters.from ? new Date(p.filters.from) : undefined;
  const to = p.filters.to ? new Date(p.filters.to) : undefined;
  return from || to ? { gte: from, lte: to } : undefined;
};

// ── Chart ───────────────────────────────────────────────────

export const ACCOUNT_SORTS = ["code", "label", "class"] as const;

export async function listAccounts(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("accounting.chart", "view");
  const w: Prisma.AccountWhereInput = {};
  if (p.q) w.OR = [{ code: { startsWith: p.q } }, { label: { contains: p.q, mode: "insensitive" } }];
  if (p.filters.class) w.class = Number(p.filters.class);
  if (p.filters.type) w.type = p.filters.type as Prisma.AccountWhereInput["type"];
  const [rows, total] = await Promise.all([
    ctx.tx.account.findMany({ where: w, orderBy: orderBy(p, ACCOUNT_SORTS, "code"), ...pageArgs(p, opts.all) }),
    ctx.tx.account.count({ where: w }),
  ]);
  const sums = await ctx.tx.journalLine.groupBy({
    by: ["accountCode"],
    where: { accountCode: { in: rows.map((r) => r.code) }, ...siteScopeWhere(ctx.actor) },
    _sum: { debitCents: true, creditCents: true },
  });
  const bal = new Map(sums.map((s) => [s.accountCode, (s._sum.debitCents ?? 0) - (s._sum.creditCents ?? 0)]));
  return { rows: rows.map((r) => ({ ...r, balanceCents: bal.get(r.code) ?? 0 })), total, page: p.page, pageSize: p.pageSize };
}

export async function getAccount(ctx: ServiceContext, code: string) {
  ctx.require("accounting.chart", "view");
  const account = await ctx.tx.account.findUnique({ where: { code }, include: { mappings: { include: { site: true, brand: true } } } });
  if (!account) throw new NotFoundError("Account", code);
  return account;
}

/** Postable accounts for pickers. */
export async function listPostableAccounts(ctx: ServiceContext) {
  ctx.require("accounting.entry", "view");
  return ctx.tx.account.findMany({ where: { postable: true, active: true }, orderBy: { code: "asc" } });
}

export async function listJournals(ctx: ServiceContext) {
  return ctx.tx.journal.findMany({ orderBy: { code: "asc" } });
}

export async function listMappings(ctx: ServiceContext) {
  ctx.require("accounting.chart", "view");
  return ctx.tx.accountMapping.findMany({ include: { account: true, site: true, brand: true }, orderBy: [{ key: "asc" }] });
}

// ── Entries ─────────────────────────────────────────────────

export const ENTRY_SORTS = ["number", "entryDate", "journalCode", "createdAt"] as const;

function entryWhere(ctx: ServiceContext, p: ListParams): Prisma.JournalEntryWhereInput {
  const w: Prisma.JournalEntryWhereInput = { ...siteScopeWhere(ctx.actor) };
  if (p.q) {
    w.OR = [
      { number: { contains: p.q, mode: "insensitive" } },
      { label: { contains: p.q, mode: "insensitive" } },
      { lines: { some: { accountCode: { startsWith: p.q } } } },
    ];
  }
  if (p.filters.journal) w.journalCode = p.filters.journal;
  if (p.filters.site) w.siteId = p.filters.site;
  if (p.filters.source) w.sourceType = p.filters.source;
  if (p.filters.period) w.periodId = p.filters.period;
  const range = dateRange(p);
  if (range) w.entryDate = range;
  return w;
}

export async function listEntries(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("accounting.entry", "view");
  const w = entryWhere(ctx, p);
  const [rows, total] = await Promise.all([
    ctx.tx.journalEntry.findMany({
      where: w,
      orderBy: [orderBy(p, ENTRY_SORTS, "entryDate"), { number: "desc" }],
      ...pageArgs(p, opts.all),
      include: { site: { select: { code: true } }, reversedBy: { select: { number: true } }, period: { select: { status: true } } },
    }),
    ctx.tx.journalEntry.count({ where: w }),
  ]);
  const totals = await ctx.tx.journalLine.groupBy({
    by: ["entryId"],
    where: { entryId: { in: rows.map((r) => r.id) } },
    _sum: { debitCents: true },
  });
  const t = new Map(totals.map((x) => [x.entryId, x._sum.debitCents ?? 0]));
  return { rows: rows.map((r) => ({ ...r, totalCents: t.get(r.id) ?? 0 })), total, page: p.page, pageSize: p.pageSize };
}

export async function getEntry(ctx: ServiceContext, id: string) {
  ctx.require("accounting.entry", "view");
  const entry = await ctx.tx.journalEntry.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { lineNo: "asc" }, include: { account: { select: { label: true } } } },
      site: true,
      journal: true,
      period: true,
      reversalOf: { select: { id: true, number: true } },
      reversedBy: { select: { id: true, number: true } },
    },
  });
  if (!entry) throw new NotFoundError("JournalEntry", id);
  ctx.require("accounting.entry", "view", entry.siteId);
  const parties = await partyNames(ctx, entry.lines);
  const createdBy = entry.createdById ? await ctx.tx.user.findUnique({ where: { id: entry.createdById }, select: { firstName: true, lastName: true } }) : null;
  return { ...entry, parties, createdBy };
}

async function partyNames(ctx: ServiceContext, lines: { partyType: string | null; partyId: string | null }[]) {
  const customerIds = lines.filter((l) => l.partyType === "CUSTOMER" && l.partyId).map((l) => l.partyId!);
  const supplierIds = lines.filter((l) => l.partyType === "SUPPLIER" && l.partyId).map((l) => l.partyId!);
  const [customers, suppliers] = await Promise.all([
    customerIds.length ? ctx.tx.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, displayName: true, accountCode: true } }) : [],
    supplierIds.length ? ctx.tx.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true, accountCode: true } }) : [],
  ]);
  const map = new Map<string, { name: string; accountCode: string; type: "CUSTOMER" | "SUPPLIER" }>();
  for (const c of customers) map.set(c.id, { name: c.displayName, accountCode: c.accountCode, type: "CUSTOMER" });
  for (const s of suppliers) map.set(s.id, { name: s.name, accountCode: s.accountCode, type: "SUPPLIER" });
  return map;
}

/** Entries generated by a business document (invoice, payment…). */
export async function entriesForSource(ctx: ServiceContext, sourceType: string, sourceId: string) {
  return ctx.tx.journalEntry.findMany({ where: { sourceType, sourceId }, select: { id: true, number: true, entryDate: true } });
}

// ── Invoices ────────────────────────────────────────────────

export const INVOICE_SORTS = ["number", "issueDate", "dueDate", "totalInclVatCents", "createdAt"] as const;

function invoiceWhere(ctx: ServiceContext, p: ListParams): Prisma.InvoiceWhereInput {
  const w: Prisma.InvoiceWhereInput = { ...siteScopeWhere(ctx.actor) };
  if (p.q) {
    w.OR = [
      { number: { contains: p.q, mode: "insensitive" } },
      { customer: { displayName: { contains: p.q, mode: "insensitive" } } },
      { customer: { number: { contains: p.q, mode: "insensitive" } } },
    ];
  }
  if (p.filters.status) w.status = p.filters.status as Prisma.InvoiceWhereInput["status"];
  if (p.filters.kind) w.kind = p.filters.kind as Prisma.InvoiceWhereInput["kind"];
  if (p.filters.site) w.siteId = p.filters.site;
  if (p.filters.source) w.sourceType = p.filters.source;
  if (p.filters.customer) w.customerId = p.filters.customer;
  if (p.filters.overdue === "1") {
    w.status = { in: ["ISSUED", "PARTIALLY_PAID"] };
    w.kind = "INVOICE";
    w.dueDate = { lt: ctx.businessDate };
  }
  const range = dateRange(p);
  if (range) w.issueDate = range;
  return w;
}

export async function listInvoices(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("accounting.invoice", "view");
  const w = invoiceWhere(ctx, p);
  const [rows, total] = await Promise.all([
    ctx.tx.invoice.findMany({
      where: w,
      orderBy: [orderBy(p, INVOICE_SORTS, "createdAt"), { createdAt: "desc" }],
      ...pageArgs(p, opts.all),
      include: { site: { select: { code: true } }, customer: { select: { id: true, displayName: true, number: true } } },
    }),
    ctx.tx.invoice.count({ where: w }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getInvoice(ctx: ServiceContext, id: string) {
  ctx.require("accounting.invoice", "view");
  const invoice = await ctx.tx.invoice.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { lineNo: "asc" } },
      site: true,
      customer: true,
      creditedInvoice: { select: { id: true, number: true } },
      creditNotes: { select: { id: true, number: true, status: true } },
      allocations: { include: { payment: { select: { id: true, number: true, method: true, businessDate: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!invoice) throw new NotFoundError("Invoice", id);
  ctx.require("accounting.invoice", "view", invoice.siteId);
  const entry = invoice.journalEntryId
    ? await ctx.tx.journalEntry.findUnique({ where: { id: invoice.journalEntryId }, select: { id: true, number: true } })
    : null;
  return { ...invoice, entry };
}

/** Open (unpaid) invoices or credit notes of a customer, for allocation. */
export async function listOpenItems(ctx: ServiceContext, customerId: string) {
  ctx.require("accounting.payment", "view");
  return ctx.tx.invoice.findMany({
    where: { customerId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
    orderBy: [{ dueDate: "asc" }],
    select: { id: true, number: true, kind: true, issueDate: true, dueDate: true, totalInclVatCents: true, paidCents: true, siteId: true },
  });
}

// ── Payments ────────────────────────────────────────────────

export const PAYMENT_SORTS = ["number", "businessDate", "amountCents"] as const;

export async function listPayments(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("accounting.payment", "view");
  const w: Prisma.PaymentWhereInput = { ...siteScopeWhere(ctx.actor) };
  if (p.q) {
    w.OR = [
      { number: { contains: p.q, mode: "insensitive" } },
      { reference: { contains: p.q, mode: "insensitive" } },
      { customer: { displayName: { contains: p.q, mode: "insensitive" } } },
      { supplier: { name: { contains: p.q, mode: "insensitive" } } },
    ];
  }
  if (p.filters.direction) w.direction = p.filters.direction as Prisma.PaymentWhereInput["direction"];
  if (p.filters.method) w.method = p.filters.method as Prisma.PaymentWhereInput["method"];
  if (p.filters.site) w.siteId = p.filters.site;
  const range = dateRange(p);
  if (range) w.businessDate = range;
  const [rows, total] = await Promise.all([
    ctx.tx.payment.findMany({
      where: w,
      orderBy: [orderBy(p, PAYMENT_SORTS, "businessDate"), { number: "desc" }],
      ...pageArgs(p, opts.all),
      include: { site: { select: { code: true } }, customer: { select: { id: true, displayName: true } }, supplier: { select: { id: true, name: true } } },
    }),
    ctx.tx.payment.count({ where: w }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getPayment(ctx: ServiceContext, id: string) {
  ctx.require("accounting.payment", "view");
  const payment = await ctx.tx.payment.findUnique({
    where: { id },
    include: {
      site: true,
      customer: true,
      supplier: true,
      allocations: { include: { invoice: { select: { id: true, number: true, kind: true, totalInclVatCents: true } } } },
    },
  });
  if (!payment) throw new NotFoundError("Payment", id);
  const entry = payment.journalEntryId
    ? await ctx.tx.journalEntry.findUnique({ where: { id: payment.journalEntryId }, select: { id: true, number: true } })
    : null;
  return { ...payment, entry };
}

// ── Periods ─────────────────────────────────────────────────

export async function listPeriods(ctx: ServiceContext) {
  ctx.require("accounting.period", "view");
  const periods = await ctx.tx.fiscalPeriod.findMany({ orderBy: [{ year: "desc" }, { month: "desc" }] });
  const counts = await ctx.tx.journalEntry.groupBy({ by: ["periodId"], _count: { _all: true } });
  const c = new Map(counts.map((x) => [x.periodId, x._count._all]));
  return periods.map((p) => ({ ...p, entryCount: c.get(p.id) ?? 0 }));
}

export async function getPeriodChecklist(ctx: ServiceContext, periodId: string) {
  ctx.require("accounting.period", "view");
  const checks = await getCloseChecklist(ctx.tx, periodId, ctx.businessDate);
  return { checks, canLock: canLock(checks) };
}

// ── Reports ─────────────────────────────────────────────────

export async function getTrialBalance(ctx: ServiceContext, args: { from?: Date; to?: Date; siteId?: string }) {
  ctx.require("accounting.report", "view");
  const where: Prisma.JournalLineWhereInput = { ...siteScopeWhere(ctx.actor) };
  if (args.siteId) where.siteId = args.siteId;
  if (args.from || args.to) where.entryDate = { gte: args.from, lte: args.to };
  const sums = await ctx.tx.journalLine.groupBy({ by: ["accountCode"], where, _sum: { debitCents: true, creditCents: true } });
  const accounts = await ctx.tx.account.findMany({ where: { code: { in: sums.map((s) => s.accountCode) } } });
  const acc = new Map(accounts.map((a) => [a.code, a]));
  const tb = trialBalance(
    sums.map((s) => ({
      accountCode: s.accountCode,
      label: acc.get(s.accountCode)?.label ?? s.accountCode,
      class: acc.get(s.accountCode)?.class ?? Number(s.accountCode[0]),
      debitCents: s._sum.debitCents ?? 0,
      creditCents: s._sum.creditCents ?? 0,
    })),
  );
  return { ...tb, resultCents: netResult(tb.rows) };
}

/** Customer or supplier balances (auxiliary ledger). Positive = the party owes us. */
export async function listPartyBalances(ctx: ServiceContext, partyType: "CUSTOMER" | "SUPPLIER", p: ListParams) {
  ctx.require("accounting.report", "view");
  const where: Prisma.JournalLineWhereInput = { partyType, ...siteScopeWhere(ctx.actor) };
  if (p.filters.site) where.siteId = p.filters.site;
  const sums = await ctx.tx.journalLine.groupBy({
    by: ["partyId"],
    where,
    _sum: { debitCents: true, creditCents: true },
  });
  const ids = sums.map((s) => s.partyId!).filter(Boolean);
  const names =
    partyType === "CUSTOMER"
      ? (await ctx.tx.customer.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, accountCode: true } })).map((c) => ({ id: c.id, name: c.displayName, accountCode: c.accountCode }))
      : (await ctx.tx.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, accountCode: true } }));
  const n = new Map(names.map((x) => [x.id, x]));
  let rows = sums.map((s) => ({
    partyId: s.partyId!,
    name: n.get(s.partyId!)?.name ?? "?",
    accountCode: n.get(s.partyId!)?.accountCode ?? "",
    debitCents: s._sum.debitCents ?? 0,
    creditCents: s._sum.creditCents ?? 0,
    balanceCents: (s._sum.debitCents ?? 0) - (s._sum.creditCents ?? 0),
  }));
  if (p.q) rows = rows.filter((r) => r.name.toLowerCase().includes(p.q.toLowerCase()) || r.accountCode.includes(p.q.toUpperCase()));
  if (p.filters.open === "1") rows = rows.filter((r) => r.balanceCents !== 0);
  rows.sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents) || a.name.localeCompare(b.name));
  const total = rows.length;
  const start = (p.page - 1) * p.pageSize;
  return { rows: rows.slice(start, start + p.pageSize), total, page: p.page, pageSize: p.pageSize };
}

/** Statement of one party: every line with running balance and lettering. */
export async function getPartyStatement(ctx: ServiceContext, partyType: "CUSTOMER" | "SUPPLIER", partyId: string) {
  ctx.require("accounting.report", "view");
  const lines = await ctx.tx.journalLine.findMany({
    where: { partyType, partyId, ...siteScopeWhere(ctx.actor) },
    orderBy: [{ entryDate: "asc" }, { entry: { number: "asc" } }],
    include: { entry: { select: { id: true, number: true, journalCode: true, sourceType: true, sourceId: true } } },
  });
  let running = 0;
  return lines.map((l) => {
    running += l.debitCents - l.creditCents;
    return { ...l, runningCents: running };
  });
}

/** Account summary shown on the customer page. */
export async function getCustomerAccount(ctx: ServiceContext, customerId: string) {
  if (!ctx.can("accounting.invoice", "view")) return null;
  const [balance, open, recent] = await Promise.all([
    ctx.tx.journalLine.aggregate({ where: { partyType: "CUSTOMER", partyId: customerId }, _sum: { debitCents: true, creditCents: true } }),
    ctx.tx.invoice.findMany({
      where: { customerId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
      orderBy: { dueDate: "asc" },
      select: { id: true, number: true, kind: true, dueDate: true, totalInclVatCents: true, paidCents: true },
    }),
    ctx.tx.invoice.findMany({
      where: { customerId, status: { not: "DRAFT" } },
      orderBy: { issueDate: "desc" },
      take: 10,
      select: { id: true, number: true, kind: true, status: true, issueDate: true, totalInclVatCents: true },
    }),
  ]);
  return {
    balanceCents: (balance._sum.debitCents ?? 0) - (balance._sum.creditCents ?? 0),
    open,
    recent,
    overdueCents: open
      .filter((i) => i.kind === "INVOICE" && i.dueDate && i.dueDate < ctx.businessDate)
      .reduce((s, i) => s + i.totalInclVatCents - i.paidCents, 0),
  };
}

export async function listSuppliers(ctx: ServiceContext) {
  return ctx.tx.supplier.findMany({ orderBy: { name: "asc" } });
}

/** Headline figures for the accounting dashboard tiles. */
export async function getAccountingKpis(ctx: ServiceContext) {
  ctx.require("accounting.report", "view");
  const scope = siteScopeWhere(ctx.actor);
  const [receivables, overdue, drafts, openPeriods] = await Promise.all([
    ctx.tx.invoice.aggregate({ where: { ...scope, kind: "INVOICE", status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, _sum: { totalInclVatCents: true, paidCents: true } }),
    ctx.tx.invoice.aggregate({
      where: { ...scope, kind: "INVOICE", status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: ctx.businessDate } },
      _sum: { totalInclVatCents: true, paidCents: true },
    }),
    ctx.tx.invoice.count({ where: { ...scope, status: "DRAFT" } }),
    ctx.tx.fiscalPeriod.count({ where: { status: "OPEN", endDate: { lt: ctx.businessDate } } }),
  ]);
  return {
    receivablesCents: (receivables._sum.totalInclVatCents ?? 0) - (receivables._sum.paidCents ?? 0),
    overdueCents: (overdue._sum.totalInclVatCents ?? 0) - (overdue._sum.paidCents ?? 0),
    drafts,
    periodsToClose: openPeriods,
  };
}

/** Customers and suppliers for pickers. */
export async function listPartyOptions(ctx: ServiceContext) {
  const [customers, suppliers] = await Promise.all([
    ctx.tx.customer.findMany({ select: { id: true, displayName: true, number: true, kind: true }, orderBy: { displayName: "asc" } }),
    ctx.tx.supplier.findMany({ select: { id: true, name: true, number: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    customers: customers.map((c) => ({ value: c.id, label: `${c.displayName} (${c.number})` })),
    suppliers: suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.number})` })),
  };
}

/** VAT rates in force at the business date. */
export async function listVatRates(ctx: ServiceContext) {
  return ctx.tx.vatRate.findMany({
    where: { validFrom: { lte: ctx.businessDate }, OR: [{ validTo: null }, { validTo: { gte: ctx.businessDate } }] },
    orderBy: { rateBp: "desc" },
  });
}

/** Lines posted to an account (general ledger detail), newest first. */
export async function listAccountLines(ctx: ServiceContext, accountCode: string, p: ListParams) {
  ctx.require("accounting.chart", "view");
  const where: Prisma.JournalLineWhereInput = { accountCode, ...siteScopeWhere(ctx.actor) };
  if (p.q) where.label = { contains: p.q, mode: "insensitive" };
  const [rows, total] = await Promise.all([
    ctx.tx.journalLine.findMany({
      where,
      orderBy: [{ entryDate: "desc" }, { entry: { number: "desc" } }],
      ...pageArgs(p),
      include: { entry: { select: { id: true, number: true } } },
    }),
    ctx.tx.journalLine.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getParty(ctx: ServiceContext, partyType: "CUSTOMER" | "SUPPLIER", id: string) {
  ctx.require("accounting.report", "view");
  return partyType === "CUSTOMER"
    ? ctx.tx.customer.findUnique({ where: { id }, select: { displayName: true, accountCode: true } }).then((c) => c && { name: c.displayName, accountCode: c.accountCode })
    : ctx.tx.supplier.findUnique({ where: { id }, select: { name: true, accountCode: true } });
}
