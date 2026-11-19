/** Trial balance aggregation (pure). */
import type { Cents } from "@/lib/money";

export interface AccountMovement {
  accountCode: string;
  label: string;
  class: number;
  debitCents: Cents;
  creditCents: Cents;
}

export interface TrialBalanceRow extends AccountMovement {
  balanceCents: Cents; // debit − credit
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totals: { debitCents: Cents; creditCents: Cents };
  byClass: { class: number; debitCents: Cents; creditCents: Cents }[];
  balanced: boolean;
}

export function trialBalance(movements: AccountMovement[]): TrialBalance {
  const rows = movements
    .filter((m) => m.debitCents !== 0 || m.creditCents !== 0)
    .map((m) => ({ ...m, balanceCents: m.debitCents - m.creditCents }))
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const totals = rows.reduce(
    (t, r) => ({ debitCents: t.debitCents + r.debitCents, creditCents: t.creditCents + r.creditCents }),
    { debitCents: 0, creditCents: 0 },
  );
  const classes = new Map<number, { class: number; debitCents: Cents; creditCents: Cents }>();
  for (const r of rows) {
    const c = classes.get(r.class) ?? { class: r.class, debitCents: 0, creditCents: 0 };
    c.debitCents += r.debitCents;
    c.creditCents += r.creditCents;
    classes.set(r.class, c);
  }
  return {
    rows,
    totals,
    byClass: [...classes.values()].sort((a, b) => a.class - b.class),
    balanced: totals.debitCents === totals.creditCents,
  };
}

/** Result of the period = income (class 7) − expenses (class 6), from balances. */
export function netResult(rows: TrialBalanceRow[]): Cents {
  return rows.filter((r) => r.class === 6 || r.class === 7).reduce((s, r) => s - r.balanceCents, 0);
}
