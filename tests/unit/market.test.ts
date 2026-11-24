import { describe, expect, it } from "vitest";
import { ageInYears, retailValueCents, TRADE_DISCOUNT, valueOnMarket } from "@/modules/sales/domain/market";

const car = { make: "Peugeot", model: "308", newPriceCents: 3_000_000, ageYears: 3, mileage: 45_000, fuel: "PETROL" as const };

describe("market price feed (D-083)", () => {
  it("depreciates 15 % a year and 1 % per 10,000 km, mileage capped, fuel adjusted", () => {
    expect(retailValueCents(3_000_000, 0, 0, "PETROL")).toBe(3_000_000);
    expect(retailValueCents(3_000_000, 2, 30_000, "PETROL")).toBe(Math.round((3_000_000 * 0.85 ** 2 * 0.97) / 10_000) * 10_000);
    expect(retailValueCents(3_000_000, 10, 500_000, "PETROL")).toBe(retailValueCents(3_000_000, 10, 200_000, "PETROL"));
    expect(retailValueCents(3_000_000, 3, 40_000, "ELECTRIC")).toBeLessThan(retailValueCents(3_000_000, 3, 40_000, "PETROL"));
  });

  it("gives the same answer for the same car, and shares comparables within a model and year", () => {
    const a = valueOnMarket(car, 2026);
    expect(valueOnMarket(car, 2026)).toEqual(a);
    expect(valueOnMarket({ ...car, make: " peugeot " }, 2026).comparables).toEqual(a.comparables);
    expect(valueOnMarket({ ...car, model: "2008" }, 2026).comparables).not.toEqual(a.comparables);
    expect(a.comparables).toHaveLength(6);
    expect(a.comparables.every((c) => c.year === 2023)).toBe(true);
  });

  it("values the car at trade, inside its range, below the retail median", () => {
    const v = valueOnMarket(car, 2026);
    expect(v.estimateCents).toBe(Math.round((v.retailCents * TRADE_DISCOUNT) / 10_000) * 10_000);
    expect(v.lowCents).toBeLessThanOrEqual(v.estimateCents);
    expect(v.highCents).toBeGreaterThanOrEqual(v.estimateCents);
    expect(v.estimateCents % 10_000).toBe(0);
  });

  it("pays less for more kilometres and for an older car", () => {
    expect(valueOnMarket({ ...car, mileage: 120_000 }, 2026).estimateCents).toBeLessThan(valueOnMarket(car, 2026).estimateCents);
    expect(valueOnMarket({ ...car, ageYears: 6 }, 2026).estimateCents).toBeLessThan(valueOnMarket(car, 2026).estimateCents);
  });

  it("counts whole years from the first registration", () => {
    expect(ageInYears(new Date("2023-06-01"), new Date("2026-05-31"))).toBe(2);
    expect(ageInYears(new Date("2023-06-01"), new Date("2026-06-01"))).toBe(3);
    expect(ageInYears(new Date("2027-01-01"), new Date("2026-06-01"))).toBe(0);
  });
});
