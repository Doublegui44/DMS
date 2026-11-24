import { formatLocale } from "./format-locale";
/**
 * Money helpers. All amounts are integer cents. This is the ONLY place that rounds.
 * Rounding rule: half-up away from zero, to the cent (ROUND_HALF_UP).
 * Rates are expressed in basis points (bp): 2000 bp = 20.00 %.
 */

export type Cents = number;

const BP_DIVISOR = 10_000;

export function assertCents(value: number, label = "amount"): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of cents, got ${value}`);
  }
}

/** Round a fractional cents value to an integer, half away from zero. */
export function roundCents(value: number): Cents {
  if (!Number.isFinite(value)) throw new RangeError(`Cannot round ${value}`);
  const sign = value < 0 ? -1 : 1;
  // Add a tiny epsilon to absorb binary representation errors (e.g. 0.5 stored as 0.49999…).
  const rounded = Math.floor(Math.abs(value) + 0.5 + 1e-9);
  return rounded === 0 ? 0 : sign * rounded;
}

/** `cents × bp / 10 000`, rounded. E.g. VAT on an excl.-VAT amount. */
export function applyRate(cents: Cents, rateBp: number): Cents {
  assertCents(cents);
  return roundCents((cents * rateBp) / BP_DIVISOR);
}

/** VAT amount on an amount excluding VAT. */
export function vatOnExcl(exclCents: Cents, rateBp: number): Cents {
  return applyRate(exclCents, rateBp);
}

/** Split an amount including VAT into excl. VAT + VAT, so that excl + vat === incl. */
export function splitIncl(inclCents: Cents, rateBp: number): { exclCents: Cents; vatCents: Cents } {
  assertCents(inclCents);
  const exclCents = roundCents((inclCents * BP_DIVISOR) / (BP_DIVISOR + rateBp));
  return { exclCents, vatCents: inclCents - exclCents };
}

/** Amount including VAT from an amount excluding VAT. */
export function inclFromExcl(exclCents: Cents, rateBp: number): Cents {
  return exclCents + vatOnExcl(exclCents, rateBp);
}

/** Sum of cents; throws on non-integers. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  return total;
}

/**
 * Split `total` across `weights` proportionally, using the largest-remainder
 * method so that the parts always add up exactly to `total`.
 */
export function allocate(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total);
  if (weights.length === 0) return [];
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    const parts = weights.map(() => 0);
    parts[0] = total;
    return parts;
  }
  const raw = weights.map((w) => (total * w) / weightSum);
  const floored = raw.map((r) => Math.trunc(r));
  let remainder = total - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: Math.abs(r - Math.trunc(r)) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const step = remainder >= 0 ? 1 : -1;
  for (let k = 0; remainder !== 0; k = (k + 1) % order.length) {
    floored[order[k].i] += step;
    remainder -= step;
  }
  return floored;
}

/** Percentage of `base` represented by `part`, in basis points (rounded). */
export function ratioBp(part: Cents, base: Cents): number {
  if (base === 0) return 0;
  return Math.round((part * BP_DIVISOR) / base);
}

/** Parse a user-entered euro amount ("1 234,56", "1234.5", "€12") into cents. */
export function parseEuros(input: string | number): Cents {
  if (typeof input === "number") return roundCents(input * 100);
  const cleaned = input.replace(/[€\s  ]/g, "");
  if (cleaned === "") throw new RangeError("Empty amount");
  // Accept both "1.234,56" (fr) and "1,234.56" (en): the last separator is the decimal one.
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalSep = lastComma > lastDot ? "," : ".";
  const thousandsSep = decimalSep === "," ? "." : ",";
  const normalised = cleaned.split(thousandsSep).join("").replace(decimalSep, ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) throw new RangeError(`Invalid amount: ${input}`);
  const [intPart, frac = ""] = normalised.split(".");
  const negative = intPart.startsWith("-");
  const whole = Math.abs(parseInt(intPart, 10));
  // Round the fractional part on the third decimal digit, half-up.
  const fracDigits = (frac + "000").slice(0, 3);
  let cents = whole * 100 + parseInt(fracDigits.slice(0, 2), 10);
  if (parseInt(fracDigits[2], 10) >= 5) cents += 1;
  return negative ? -cents : cents;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Format cents for display, e.g. 123456 → "€1,234.56". */
export function formatMoney(cents: Cents | null | undefined, opts?: { locale?: string; currency?: string; decimals?: boolean }): string {
  if (cents === null || cents === undefined) return "—";
  const locale = opts?.locale ?? formatLocale();
  const currency = opts?.currency ?? "EUR";
  const decimals = opts?.decimals ?? true;
  const key = `${locale}|${currency}|${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
    });
    formatters.set(key, f);
  }
  return f.format(cents / 100);
}

/** Format basis points as a percentage string, e.g. 2000 → "20.00 %". */
export function formatBp(bp: number, decimals = 2, locale?: string): string {
  return `${(bp / 100).toLocaleString(locale ?? formatLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} %`;
}
