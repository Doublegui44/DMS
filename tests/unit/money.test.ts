import { describe, expect, it } from "vitest";
import {
  allocate,
  applyRate,
  formatMoney,
  inclFromExcl,
  parseEuros,
  ratioBp,
  roundCents,
  splitIncl,
  sumCents,
  vatOnExcl,
} from "@/lib/money";

describe("roundCents (half-up, away from zero)", () => {
  it.each([
    [0.5, 1],
    [1.4999, 1],
    [2.5, 3],
    [-2.5, -3],
    [-0.4, 0],
    [1234.5, 1235],
  ])("%d → %d", (input, expected) => expect(roundCents(input)).toBe(expected));

  it("absorbs binary float noise (1.005 € = 100.49999… cents)", () => {
    expect(roundCents(1.005 * 100)).toBe(101);
  });
});

describe("VAT", () => {
  it("computes 20 % VAT on an excl.-VAT amount", () => {
    expect(vatOnExcl(10_000, 2000)).toBe(2_000);
    expect(vatOnExcl(1_999, 2000)).toBe(400); // 399.8 → 400
    expect(inclFromExcl(2_490_000, 2000)).toBe(2_988_000);
  });

  it("splits an incl.-VAT price so that excl + vat === incl", () => {
    for (const incl of [1, 99, 12_000, 2_490_099, 3_590_000]) {
      const { exclCents, vatCents } = splitIncl(incl, 2000);
      expect(exclCents + vatCents).toBe(incl);
      expect(Math.abs(vatOnExcl(exclCents, 2000) - vatCents)).toBeLessThanOrEqual(1);
    }
    expect(splitIncl(12_000, 2000)).toEqual({ exclCents: 10_000, vatCents: 2_000 });
  });

  it("applies other rates in basis points", () => {
    expect(applyRate(10_000, 550)).toBe(550);
    expect(applyRate(10_000, 0)).toBe(0);
    expect(applyRate(333, 1000)).toBe(33);
  });

  it("rejects non-integer cents", () => {
    expect(() => applyRate(10.5, 2000)).toThrow(RangeError);
  });
});

describe("allocate (largest remainder)", () => {
  it("always sums exactly to the total", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(sumCents(allocate(100, [1, 1, 1]))).toBe(100);
    expect(sumCents(allocate(1_000_001, [3, 7, 11, 13]))).toBe(1_000_001);
    expect(sumCents(allocate(-100, [1, 2]))).toBe(-100);
  });
  it("handles zero weights", () => {
    expect(allocate(50, [0, 0])).toEqual([50, 0]);
  });
});

describe("parseEuros", () => {
  it.each([
    ["1 234,56", 123_456],
    ["1.234,56", 123_456],
    ["1,234.56", 123_456],
    ["12", 1_200],
    ["12,5", 1_250],
    ["0,005", 1],
    ["€ 99.99", 9_999],
    ["-10,00", -1_000],
  ])("%s → %d cents", (input, cents) => expect(parseEuros(input)).toBe(cents));

  it("rejects garbage", () => {
    expect(() => parseEuros("abc")).toThrow();
    expect(() => parseEuros("")).toThrow();
  });
});

describe("formatting and ratios", () => {
  it("formats euros", () => {
    expect(formatMoney(123_456)).toBe("€1,234.56");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(123_456, { decimals: false })).toBe("€1,235");
  });
  it("computes ratios in basis points", () => {
    expect(ratioBp(500, 10_000)).toBe(500);
    expect(ratioBp(1, 0)).toBe(0);
  });
});
