/** Fiscal periods and month-end close rules (pure). Calendar-year monthly periods (assumption #4). */

export interface PeriodKey {
  year: number;
  month: number; // 1..12
}

export function periodOf(date: Date): PeriodKey {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function periodBounds(p: PeriodKey): { startDate: Date; endDate: Date } {
  return {
    startDate: new Date(Date.UTC(p.year, p.month - 1, 1)),
    endDate: new Date(Date.UTC(p.year, p.month, 0)),
  };
}

export function periodLabel(p: PeriodKey): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

export function comparePeriods(a: PeriodKey, b: PeriodKey): number {
  return a.year - b.year || a.month - b.month;
}

export interface CloseCheckInput {
  period: PeriodKey & { status: "OPEN" | "LOCKED" };
  previousOpen: PeriodKey[]; // earlier periods still open
  draftInvoices: number; // pending drafts (warning only)
  trialBalance: { debitCents: number; creditCents: number };
  businessDate: Date;
}

export interface CloseCheck {
  key: "already_locked" | "previous_open" | "period_not_ended" | "draft_invoices" | "trial_balance";
  ok: boolean;
  blocking: boolean;
  message: string;
}

/** Month-end checklist. Locking is allowed only when every blocking check passes. */
export function closeChecklist(i: CloseCheckInput): CloseCheck[] {
  const { endDate } = periodBounds(i.period);
  return [
    {
      key: "already_locked",
      ok: i.period.status === "OPEN",
      blocking: true,
      message: i.period.status === "OPEN" ? "Period is open" : "Period is already locked",
    },
    {
      key: "previous_open",
      ok: i.previousOpen.length === 0,
      blocking: true,
      message: i.previousOpen.length
        ? `Lock earlier periods first: ${i.previousOpen.map(periodLabel).join(", ")}`
        : "All earlier periods are locked",
    },
    {
      key: "period_not_ended",
      ok: i.businessDate.getTime() > endDate.getTime(),
      blocking: true,
      message:
        i.businessDate.getTime() > endDate.getTime()
          ? "Period has ended"
          : "The period has not ended yet (business date is inside it)",
    },
    {
      key: "draft_invoices",
      ok: i.draftInvoices === 0,
      blocking: false,
      message: i.draftInvoices ? `${i.draftInvoices} draft invoice(s) not issued` : "No draft invoices",
    },
    {
      key: "trial_balance",
      ok: i.trialBalance.debitCents === i.trialBalance.creditCents,
      blocking: true,
      message:
        i.trialBalance.debitCents === i.trialBalance.creditCents
          ? "Trial balance balances"
          : "Trial balance does not balance",
    },
  ];
}

export function canLock(checks: CloseCheck[]): boolean {
  return checks.every((c) => c.ok || !c.blocking);
}
