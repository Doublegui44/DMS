import type { Cents } from "@/lib/money";

/**
 * Used-car market price feed (mock, D-083). A real dealer asks a valuation service (cote) for a
 * car's trade value; here a pure function plays that service. Values are fictional but behave:
 * 15 % a year, 1 % per 10,000 km (mileage capped at 200,000), and a fuel adjustment. The listings
 * that back the estimate are drawn from the car's make, model and year, so the same car always
 * gets the same answer and two cars of the same model share their comparables.
 */
export type MarketFuel = "PETROL" | "DIESEL" | "HYBRID" | "PLUGIN_HYBRID" | "ELECTRIC" | "LPG";

export interface MarketQuery {
  make: string;
  model: string;
  /** Price of the car new, incl. VAT (from the catalogue, or a fallback). */
  newPriceCents: Cents;
  ageYears: number;
  mileage: number;
  fuel: MarketFuel;
}

export interface Comparable {
  ref: string;
  year: number;
  mileage: number;
  priceCents: Cents;
  daysListed: number;
  seller: "DEALER" | "PRIVATE";
}

export interface MarketValuation {
  /** Trade value: what a dealer pays for this car (retail median less the dealer's margin). */
  estimateCents: Cents;
  lowCents: Cents;
  highCents: Cents;
  /** Median asking price of the comparables, adjusted to this car's mileage. */
  retailCents: Cents;
  comparables: Comparable[];
}

/** Retail to trade: a dealer buys about 15 % under the asking prices it will sell at. */
export const TRADE_DISCOUNT = 0.85;
const MILEAGE_CAP = 200_000;
const FUEL_FACTOR: Record<MarketFuel, number> = { PETROL: 1, DIESEL: 0.96, HYBRID: 1.04, PLUGIN_HYBRID: 1.02, ELECTRIC: 0.93, LPG: 0.94 };

const round100 = (c: number) => Math.round(c / 10_000) * 10_000;

/** Retail value of a car of this age and mileage (before comparables). */
export function retailValueCents(newPriceCents: Cents, ageYears: number, mileage: number, fuel: MarketFuel): Cents {
  const km = Math.min(Math.max(0, mileage), MILEAGE_CAP);
  return round100(newPriceCents * Math.pow(0.85, Math.max(0, ageYears)) * (1 - km / 1_000_000) * FUEL_FACTOR[fuel]);
}

/** FNV-1a, then a small PRNG: the comparables of a make/model/year are always the same. */
function stream(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Six listings of the same make, model and year, and the trade value they give this car. */
export function valueOnMarket(q: MarketQuery, currentYear: number): MarketValuation {
  const age = Math.max(0, Math.round(q.ageYears));
  const year = currentYear - age;
  const r = stream(`${q.make.trim().toUpperCase()}|${q.model.trim().toUpperCase()}|${year}`);
  const typicalKm = Math.max(5_000, age * 13_000);
  const comparables: Comparable[] = Array.from({ length: 6 }, (_, i) => {
    const mileage = Math.round((typicalKm * (0.6 + r() * 0.8)) / 100) * 100;
    const noise = 0.92 + r() * 0.16;
    return {
      ref: `${q.make.trim().slice(0, 3).toUpperCase()}-${year}-${String(1000 + Math.floor(r() * 9000))}`,
      year,
      mileage,
      priceCents: round100(retailValueCents(q.newPriceCents, age, mileage, q.fuel) * noise),
      daysListed: 3 + Math.floor(r() * 75) + i,
      seller: r() < 0.7 ? "DEALER" : "PRIVATE",
    };
  });
  // Each listing brought to this car's mileage, then the median: one outlier does not move it.
  const adjusted = comparables.map((c) => c.priceCents * (retailValueCents(q.newPriceCents, age, q.mileage, q.fuel) / Math.max(1, retailValueCents(q.newPriceCents, age, c.mileage, q.fuel))));
  const retail = round100(median(adjusted));
  const sorted = [...adjusted].sort((a, b) => a - b);
  return {
    retailCents: retail,
    estimateCents: round100(retail * TRADE_DISCOUNT),
    lowCents: round100(sorted[1] * TRADE_DISCOUNT),
    highCents: round100(sorted[sorted.length - 2] * TRADE_DISCOUNT),
    comparables: comparables.sort((a, b) => a.priceCents - b.priceCents),
  };
}

/** Whole years between first registration and the business date. */
export function ageInYears(firstRegistration: Date, asOf: Date): number {
  const months = (asOf.getUTCFullYear() - firstRegistration.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - firstRegistration.getUTCMonth());
  return Math.max(0, Math.floor(months / 12));
}
