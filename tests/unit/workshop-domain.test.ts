import { describe, expect, it } from "vitest";
import { clockedCentiHours, formatMinute, hoursToCentiHours, minutesToCentiHours, parseHhmm } from "@/modules/workshop/domain/time";
import { jobTotal, labourAmount, labourRateFor, partAmount, partsPriceClassFor, revenueKeysFor } from "@/modules/workshop/domain/pricing";
import { canHandOver, checkMileage, invoiceableJobs, jobMayProceed, readyForQualityCheck } from "@/modules/workshop/domain/workflow";
import { fitsCapacity, technicianKpis, weekOf, workingDays } from "@/modules/workshop/domain/productivity";
import { parseDamages } from "@/modules/workshop/domain/checkin";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const rates = { customerCents: 9500, warrantyCents: 8000, internalCents: 6000 };

describe("workshop time", () => {
  it("parses and formats clock times", () => {
    expect(parseHhmm("08:30")).toBe(510);
    expect(parseHhmm("7:05")).toBe(425);
    expect(formatMinute(510)).toBe("08:30");
    expect(() => parseHhmm("24:00")).toThrow();
    expect(() => parseHhmm("8h30")).toThrow();
  });
  it("converts minutes to centi-hours", () => {
    expect(minutesToCentiHours(45)).toBe(75);
    expect(minutesToCentiHours(20)).toBe(33);
    expect(clockedCentiHours(480, 570)).toBe(150);
    expect(() => clockedCentiHours(600, 500)).toThrow();
    expect(hoursToCentiHours("1,5")).toBe(150);
    expect(hoursToCentiHours(0.8)).toBe(80);
  });
});

describe("labour billing", () => {
  it("picks the rate of whoever pays", () => {
    expect(labourRateFor("CUSTOMER", rates)).toBe(9500);
    expect(labourRateFor("INSURANCE", rates)).toBe(9500);
    expect(labourRateFor("WARRANTY", rates)).toBe(8000);
    expect(labourRateFor("INTERNAL", rates)).toBe(6000);
  });
  it("bills standard time × rate, less discount", () => {
    expect(labourAmount({ centiHours: 150, rateCents: 9500 })).toBe(14250);
    expect(labourAmount({ centiHours: 33, rateCents: 9500 })).toBe(3135);
    expect(labourAmount({ centiHours: 100, rateCents: 9500, discountBp: 1000 })).toBe(8550);
    expect(() => labourAmount({ centiHours: 0, rateCents: 9500 })).toThrow();
  });
  it("prices parts for the payer and books revenue per payer", () => {
    expect(partsPriceClassFor("CUSTOMER", "TRADE")).toBe("TRADE");
    expect(partsPriceClassFor("WARRANTY", "RETAIL")).toBe("WARRANTY");
    expect(partsPriceClassFor("INTERNAL", "RETAIL")).toBe("INTERNAL");
    expect(partsPriceClassFor("INSURANCE", "TRADE")).toBe("RETAIL");
    expect(revenueKeysFor("CUSTOMER").labour).toBe("REVENUE_LABOUR");
    expect(revenueKeysFor("WARRANTY")).toMatchObject({ labour: "REVENUE_WARRANTY_LABOUR", parts: "REVENUE_WARRANTY_PARTS" });
    expect(revenueKeysFor("INTERNAL").parts).toBe("REVENUE_INTERNAL_PARTS");
    expect(partAmount({ qty: 3, unitPriceCents: 1999, discountBp: 500 })).toBe(5697);
    expect(jobTotal({ labour: [{ amountCents: 100 }], parts: [{ amountCents: 50 }], sublet: [{ priceCents: 25 }] })).toBe(175);
  });
});

describe("repair order workflow", () => {
  const job = (approval: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "DECLINED", status: "OPEN" | "DONE" | "DECLINED" = "OPEN") => ({ approval, status });
  it("lets only approved work proceed", () => {
    expect(jobMayProceed(job("NOT_REQUIRED"))).toBe(true);
    expect(jobMayProceed(job("APPROVED"))).toBe(true);
    expect(jobMayProceed(job("PENDING"))).toBe(false);
    expect(jobMayProceed(job("DECLINED", "DECLINED"))).toBe(false);
  });
  it("splits out declined jobs and gates quality control", () => {
    const jobs = [job("NOT_REQUIRED", "DONE"), job("DECLINED", "DECLINED")];
    expect(invoiceableJobs(jobs)).toHaveLength(1);
    expect(readyForQualityCheck(jobs).ok).toBe(true);
    expect(readyForQualityCheck([...jobs, job("PENDING")]).ok).toBe(false);
    expect(readyForQualityCheck([job("NOT_REQUIRED", "OPEN")]).ok).toBe(false);
    expect(readyForQualityCheck([job("DECLINED", "DECLINED")]).ok).toBe(false);
  });
  it("hands the car over once paid, or on account", () => {
    expect(canHandOver({ status: "READY", customerBalanceCents: 0, customerTermsDays: 0 }).ok).toBe(false);
    expect(canHandOver({ status: "INVOICED", customerBalanceCents: 100, customerTermsDays: 0 }).ok).toBe(false);
    expect(canHandOver({ status: "INVOICED", customerBalanceCents: 100, customerTermsDays: 30 }).ok).toBe(true);
    expect(canHandOver({ status: "INVOICED", customerBalanceCents: 0, customerTermsDays: 0 }).ok).toBe(true);
  });
  it("refuses an odometer reading that goes backwards", () => {
    expect(checkMileage(50_000, 49_000).ok).toBe(true);
    expect(checkMileage(48_000, 49_000).ok).toBe(false);
    expect(checkMileage(1.5, 0).ok).toBe(false);
  });
  it("parses damage notes", () => {
    expect(parseDamages("front: scratch\n\nWHEELS")).toEqual([{ zone: "FRONT", note: "scratch" }, { zone: "WHEELS", note: "" }]);
    expect(() => parseDamages("boot: dent")).toThrow();
  });
});

describe("productivity and efficiency", () => {
  it("counts working days Monday to Friday", () => {
    expect(workingDays(d("2026-03-02"), d("2026-03-08"))).toBe(5); // Mon → Sun
    expect(workingDays(d("2026-03-07"), d("2026-03-08"))).toBe(0);
  });
  it("computes productivity (clocked/available) and efficiency (billed/clocked)", () => {
    const k = technicianKpis({ availableCentiHours: 3900, clockedCentiHours: 3120, billedCentiHours: 3432 });
    expect(k.productivityBp).toBe(8000);
    expect(k.efficiencyBp).toBe(11000);
    expect(k.utilisedBp).toBe(8800);
    expect(technicianKpis({ availableCentiHours: 0, clockedCentiHours: 0, billedCentiHours: 0 })).toEqual({ productivityBp: 0, efficiencyBp: 0, utilisedBp: 0 });
  });
  it("checks capacity and builds the week", () => {
    expect(fitsCapacity({ capacityCentiHours: 780, bookedCentiHours: 600, addCentiHours: 180 })).toBe(true);
    expect(fitsCapacity({ capacityCentiHours: 780, bookedCentiHours: 600, addCentiHours: 181 })).toBe(false);
    const week = weekOf(d("2026-03-08")); // Sunday
    expect(week[0].toISOString().slice(0, 10)).toBe("2026-03-02");
    expect(week).toHaveLength(6);
  });
});
