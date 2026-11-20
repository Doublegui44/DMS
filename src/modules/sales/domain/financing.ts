/** Car loan / lease (LOA) calculator (pure). Amounts in cents, APR in basis points. */
import { applyRate, roundCents, type Cents } from "@/lib/money";
import { ValidationError } from "@/lib/errors";

export interface FinancingSettings {
  /** Partner lenders offered on quotes (fictional). */
  lenders: string[];
  defaultAprBp: number;
  /** Dealer commission paid by the lender, in bp of the amount financed. */
  commissionBp: number;
  minMonths: number;
  maxMonths: number;
}

export const DEFAULT_FINANCING: FinancingSettings = {
  lenders: ["Atlantique Financement", "Ouest Crédit Auto"],
  defaultAprBp: 590,
  commissionBp: 250,
  minMonths: 12,
  maxMonths: 84,
};

/**
 * Constant monthly payment of a loan with an optional balloon / purchase option (`residualCents`)
 * paid with the last instalment: PMT = (P − R/(1+r)^n) × r / (1 − (1+r)^−n), r = APR / 12.
 */
export function monthlyPayment(args: { principalCents: Cents; aprBp: number; months: number; residualCents?: Cents }): Cents {
  const { principalCents: p, aprBp, months: n } = args;
  const residual = args.residualCents ?? 0;
  if (n <= 0) throw new RangeError("Duration must be positive");
  const r = aprBp / 10_000 / 12;
  if (r === 0) return roundCents((p - residual) / n);
  const factor = Math.pow(1 + r, n);
  return roundCents(((p - residual / factor) * r) / (1 - 1 / factor));
}

export interface FinancingQuote {
  monthlyPaymentCents: Cents;
  /** Everything the customer pays: own contribution + instalments + purchase option. */
  totalPayableCents: Cents;
  /** Cost of credit: instalments + purchase option − amount financed. */
  totalCostCents: Cents;
  dealerCommissionCents: Cents;
}

export function computeFinancing(
  args: { kind: "LOAN" | "LEASE"; principalCents: Cents; aprBp: number; months: number; residualCents: Cents; depositCents: Cents },
  settings: Pick<FinancingSettings, "commissionBp" | "minMonths" | "maxMonths">,
): FinancingQuote {
  const errors: Record<string, string[]> = {};
  if (!Number.isSafeInteger(args.principalCents) || args.principalCents <= 0) errors.principalCents = ["Amount financed must be positive"];
  if (!Number.isInteger(args.months) || args.months < settings.minMonths || args.months > settings.maxMonths) {
    errors.months = [`Duration must be between ${settings.minMonths} and ${settings.maxMonths} months`];
  }
  if (!Number.isInteger(args.aprBp) || args.aprBp < 0 || args.aprBp > 3_000) errors.aprBp = ["APR must be between 0 and 30 %"];
  if (args.residualCents < 0 || args.residualCents >= args.principalCents) errors.residualCents = ["The residual must be lower than the amount financed"];
  if (args.kind === "LOAN" && args.residualCents > 0) errors.residualCents = ["A classic loan has no residual value"];
  if (Object.keys(errors).length) throw new ValidationError(Object.values(errors)[0][0], errors);

  const monthlyPaymentCents = monthlyPayment(args);
  const instalments = monthlyPaymentCents * args.months;
  return {
    monthlyPaymentCents,
    totalPayableCents: args.depositCents + instalments + args.residualCents,
    totalCostCents: instalments + args.residualCents - args.principalCents,
    dealerCommissionCents: applyRate(args.principalCents, settings.commissionBp),
  };
}
