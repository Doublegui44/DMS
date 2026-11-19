import type { ServiceContext } from "@/lib/context";
import type { Tx } from "@/lib/db";
import { DomainError, NotFoundError } from "@/lib/errors";
import { canLock, closeChecklist, periodBounds, periodLabel, periodOf, type CloseCheck } from "../domain/periods";

declare module "@/lib/events" {
  interface DomainEventMap {
    PeriodLocked: { periodId: string; year: number; month: number };
    PeriodReopened: { periodId: string; year: number; month: number };
  }
}

/** Period containing `date`, created OPEN on first use. */
export async function ensurePeriod(tx: Tx, date: Date) {
  const key = periodOf(date);
  return tx.fiscalPeriod.upsert({
    where: { year_month: key },
    update: {},
    create: { ...key, ...periodBounds(key) },
  });
}

/** Create every monthly period between two dates (inclusive). */
export async function ensurePeriods(tx: Tx, from: Date, to: Date) {
  let { year, month } = periodOf(from);
  const end = periodOf(to);
  while (year < end.year || (year === end.year && month <= end.month)) {
    await ensurePeriod(tx, new Date(Date.UTC(year, month - 1, 1)));
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

export async function assertPeriodOpen(tx: Tx, date: Date) {
  const period = await ensurePeriod(tx, date);
  if (period.status === "LOCKED") {
    throw new DomainError("period_locked", `Period ${periodLabel(period)} is locked`, { year: period.year, month: period.month });
  }
  return period;
}

export async function getCloseChecklist(tx: Tx, periodId: string, businessDate: Date): Promise<CloseCheck[]> {
  const period = await tx.fiscalPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new NotFoundError("FiscalPeriod", periodId);
  const previousOpen = await tx.fiscalPeriod.findMany({
    where: {
      status: "OPEN",
      OR: [{ year: { lt: period.year } }, { year: period.year, month: { lt: period.month } }],
      // Only periods that actually hold entries or are within the history window matter.
      entries: { some: {} },
    },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  // Drafts carry no business date yet, so every pending draft is reported (warning only).
  const draftInvoices = await tx.invoice.count({ where: { status: "DRAFT" } });
  const sums = await tx.journalLine.aggregate({
    where: { entry: { periodId } },
    _sum: { debitCents: true, creditCents: true },
  });
  return closeChecklist({
    period,
    previousOpen,
    draftInvoices,
    trialBalance: { debitCents: sums._sum.debitCents ?? 0, creditCents: sums._sum.creditCents ?? 0 },
    businessDate,
  });
}

export async function lockPeriod(ctx: ServiceContext, periodId: string) {
  ctx.require("accounting.period", "validate");
  const checks = await getCloseChecklist(ctx.tx, periodId, ctx.businessDate);
  if (!canLock(checks)) {
    const failed = checks.filter((c) => c.blocking && !c.ok).map((c) => c.message);
    throw new DomainError("period_close_blocked", failed.join(" · "), { checks: failed });
  }
  const after = await ctx.tx.fiscalPeriod.update({
    where: { id: periodId },
    data: { status: "LOCKED", lockedAt: ctx.businessDate, lockedById: ctx.actor.userId },
  });
  await ctx.audit({ action: "period.lock", entityType: "FiscalPeriod", entityId: periodId, after: { checks } });
  await ctx.emit({
    type: "PeriodLocked",
    aggregateType: "FiscalPeriod",
    aggregateId: periodId,
    payload: { periodId, year: after.year, month: after.month },
  });
  return after;
}

/** Reopen the most recently locked period (admin only: accounting.period:delete). */
export async function reopenPeriod(ctx: ServiceContext, periodId: string, reason: string) {
  ctx.require("accounting.period", "delete");
  if (!reason.trim()) throw new DomainError("reason_required", "A reason is required to reopen a period");
  const period = await ctx.tx.fiscalPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new NotFoundError("FiscalPeriod", periodId);
  if (period.status !== "LOCKED") throw new DomainError("period_open", "Period is already open");
  const laterLocked = await ctx.tx.fiscalPeriod.count({
    where: {
      status: "LOCKED",
      OR: [{ year: { gt: period.year } }, { year: period.year, month: { gt: period.month } }],
    },
  });
  if (laterLocked) throw new DomainError("later_locked", "Reopen later periods first");
  const after = await ctx.tx.fiscalPeriod.update({ where: { id: periodId }, data: { status: "OPEN", lockedAt: null, lockedById: null } });
  await ctx.audit({ action: "period.reopen", entityType: "FiscalPeriod", entityId: periodId, after: { reason } });
  await ctx.emit({
    type: "PeriodReopened",
    aggregateType: "FiscalPeriod",
    aggregateId: periodId,
    payload: { periodId, year: after.year, month: after.month },
  });
  return after;
}
