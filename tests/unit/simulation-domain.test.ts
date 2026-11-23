import { describe, expect, it } from "vitest";
import { DEFAULT_RATES, simulationInputSchema, simulationRatesSchema } from "@/modules/simulation/domain/config";
import { between, chance, hash, isOpenDay, perOpenDay, pick, poisson, rng, unit, unitInt, weighted } from "@/modules/simulation/domain/random";
import { discountCents, endsIn90, JOB_TEMPLATES, marketValueCents, round100, templateFor, voListPriceCents } from "@/modules/simulation/domain/templates";

describe("simulation randomness", () => {
  it("gives the same stream for the same seed and another for another seed", () => {
    const a = rng(7);
    const b = rng(7);
    const c = rng(8);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(rng("seed")()).toBe(rng(hash("seed"))());
  });

  it("ties a draw to a record: same id and purpose, same answer; another purpose, another draw", () => {
    expect(unit(7, "quote-1", "accept")).toBe(unit(7, "quote-1", "accept"));
    expect(unit(7, "quote-1", "accept")).not.toBe(unit(7, "quote-1", "decline"));
    expect(unit(7, "quote-1", "accept")).not.toBe(unit(8, "quote-1", "accept"));
    for (let i = 0; i < 200; i++) {
      const n = unitInt(7, `r${i}`, "days", 3, 10);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(10);
    }
  });

  it("draws per-record shares close to the rate", () => {
    const hits = Array.from({ length: 4000 }, (_, i) => unit(7, `inv-${i}`, "late") < 0.15).filter(Boolean).length;
    expect(hits / 4000).toBeGreaterThan(0.13);
    expect(hits / 4000).toBeLessThan(0.17);
  });

  it("averages the mean rate with Poisson counts, and zero for a zero rate", () => {
    const r = rng(1);
    const n = 5000;
    const total = Array.from({ length: n }, () => poisson(r, 2.2)).reduce((a, b) => a + b, 0);
    expect(total / n).toBeGreaterThan(2.1);
    expect(total / n).toBeLessThan(2.3);
    expect(poisson(r, 0)).toBe(0);
  });

  it("picks, weighs and bounds", () => {
    const r = rng(3);
    for (let i = 0; i < 100; i++) {
      expect(["a", "b"]).toContain(pick(r, ["a", "b"]));
      const x = between(r, 2, 4);
      expect(x).toBeGreaterThanOrEqual(2);
      expect(x).toBeLessThanOrEqual(4);
    }
    expect(weighted(r, [{ value: "only", weight: 1 }, { value: "never", weight: 0 }])).toBe("only");
    expect(chance(r, 0)).toBe(false);
    expect(chance(r, 1)).toBe(true);
  });

  it("spreads a weekly rate over six open days; Sundays are closed", () => {
    expect(perOpenDay(6)).toBe(1);
    expect(isOpenDay(new Date("2026-11-22"))).toBe(false); // Sunday
    expect(isOpenDay(new Date("2026-11-23"))).toBe(true);
    expect(isOpenDay(new Date("2026-11-28"))).toBe(true); // Saturday
  });
});

describe("simulation pricing", () => {
  it("rounds to €100 and to €…90", () => {
    expect(round100(1_234_567)).toBe(1_230_000);
    expect(endsIn90(1_234_567)).toBe(1_229_000);
  });

  it("values a used car: 15 % a year and 1 % per 10,000 km, mileage capped at 200,000", () => {
    expect(marketValueCents(3_000_000, 0, 0)).toBe(3_000_000);
    expect(marketValueCents(3_000_000, 2, 30_000)).toBe(round100(3_000_000 * 0.85 ** 2 * 0.97));
    expect(marketValueCents(3_000_000, 10, 500_000)).toBe(marketValueCents(3_000_000, 10, 200_000));
    expect(marketValueCents(3_000_000, -1, -5)).toBe(3_000_000);
  });

  it("prices a used car at its marked-up market value but never under cost + 15 %", () => {
    expect(voListPriceCents({ marketCents: 2_000_000, stockValueCents: 1_000_000, standardVat: false, markUp: 1.05 })).toBe(endsIn90(2_100_000));
    // Cost floor, incl. VAT on a standard-VAT car.
    expect(voListPriceCents({ marketCents: 1_000_000, stockValueCents: 1_000_000, standardVat: false, markUp: 1 })).toBe(endsIn90(1_150_000));
    expect(voListPriceCents({ marketCents: 1_000_000, stockValueCents: 1_000_000, standardVat: true, markUp: 1 })).toBe(endsIn90(1_380_000));
  });

  it("rounds a discount down to whole €10", () => {
    expect(discountCents(2_499_000, 4)).toBe(99_000);
    expect(discountCents(2_499_000, 0)).toBe(0);
  });

  it("finds the job template behind an appointment's concern", () => {
    expect(templateFor("Annual service")?.op).toBe("OIL-SVC");
    expect(templateFor("Something else")).toBeNull();
    expect(new Set(JOB_TEMPLATES.map((t) => t.description)).size).toBe(JOB_TEMPLATES.length);
  });
});

describe("simulation input", () => {
  it("defaults every rate and coerces form values", () => {
    expect(simulationRatesSchema.parse({})).toEqual(DEFAULT_RATES);
    const parsed = simulationInputSchema.parse({ days: "30", site: "nantes", rates: { leadsPerDay: "1.5" } });
    expect(parsed).toEqual({ days: 30, site: "nantes", rates: { leadsPerDay: 1.5 } });
  });

  it("refuses out-of-range days and rates", () => {
    expect(simulationInputSchema.safeParse({ days: 0 }).success).toBe(false);
    expect(simulationInputSchema.safeParse({ days: 367 }).success).toBe(false);
    expect(simulationRatesSchema.safeParse({ conversionRate: 1.2 }).success).toBe(false);
    expect(simulationRatesSchema.safeParse({ leadsPerDay: -1 }).success).toBe(false);
  });
});
