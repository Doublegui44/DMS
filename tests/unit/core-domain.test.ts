import { describe, expect, it } from "vitest";
import {
  ageingLevel,
  allowedNextStatuses,
  canTransition,
  customerAccountCode,
  customerDisplayName,
  formatDocumentNumber,
  frenchVatNumber,
  generateFrenchPlate,
  generateVin,
  isValidFrenchPlate,
  isValidFrenchVatNumber,
  isValidSiren,
  isValidVin,
  normalisePlate,
  vinCheckDigit,
} from "@/modules/core";
import { addDays, daysBetween, toDateOnly } from "@/lib/dates";

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe("VIN", () => {
  it("validates structure (17 chars, no I/O/Q)", () => {
    expect(isValidVin("VF3UAC652LM858414")).toBe(true);
    expect(isValidVin("vf3uac652lm858414")).toBe(true);
    expect(isValidVin("VF3UAC652LM85841")).toBe(false);
    expect(isValidVin("VF3UAC652LM85841O")).toBe(false);
    expect(isValidVin("IF3UAC652LM858414")).toBe(false);
  });

  it("computes the ISO 3779 check digit", () => {
    expect(vinCheckDigit("1M8GDM9AXKP042788")).toBe("X");
    expect(vinCheckDigit("11111111111111111")).toBe("1");
  });

  it("generates valid VINs with the WMI and a correct check digit", () => {
    const rnd = seeded(7);
    for (let i = 0; i < 200; i++) {
      const vin = generateVin("VF1", rnd);
      expect(vin.startsWith("VF1")).toBe(true);
      expect(isValidVin(vin)).toBe(true);
      expect(vin[8]).toBe(vinCheckDigit(vin));
    }
  });
});

describe("French plates (SIV)", () => {
  it("validates AB-123-CD", () => {
    expect(isValidFrenchPlate("AB-123-CD")).toBe(true);
    expect(isValidFrenchPlate("ab123cd")).toBe(true);
    expect(isValidFrenchPlate("AB-000-CD")).toBe(false);
    expect(isValidFrenchPlate("AI-123-CD")).toBe(false); // no I
    expect(isValidFrenchPlate("AO-123-CD")).toBe(false); // no O
    expect(isValidFrenchPlate("AU-123-CD")).toBe(false); // no U
    expect(isValidFrenchPlate("SS-123-CD")).toBe(false);
    expect(isValidFrenchPlate("WW-123-CD")).toBe(false); // temporary series
    expect(isValidFrenchPlate("1234 AB 44")).toBe(false); // old FNI format
  });
  it("normalises spacing", () => {
    expect(normalisePlate("ab 123 cd")).toBe("AB-123-CD");
  });
  it("generates valid plates", () => {
    const rnd = seeded(3);
    for (let i = 0; i < 500; i++) expect(isValidFrenchPlate(generateFrenchPlate(rnd))).toBe(true);
  });
});

describe("vehicle lifecycle", () => {
  it("follows the VN path", () => {
    expect(canTransition("ORDERED", "IN_TRANSIT", "VN")).toBe(true);
    expect(canTransition("IN_TRANSIT", "IN_STOCK", "VN")).toBe(true);
    expect(canTransition("IN_STOCK", "RESERVED", "VN")).toBe(true);
    expect(canTransition("RESERVED", "SOLD", "VN")).toBe(true);
    expect(canTransition("SOLD", "DELIVERED", "VN")).toBe(true);
  });
  it("follows the VO path", () => {
    expect(canTransition("INTAKE", "RECONDITIONING", "VO")).toBe(true);
    expect(canTransition("RECONDITIONING", "FOR_SALE", "VO")).toBe(true);
    expect(canTransition("FOR_SALE", "RESERVED", "VO")).toBe(true);
  });
  it("releases a reservation back to the right stock status", () => {
    expect(allowedNextStatuses("RESERVED", "VN")).toContain("IN_STOCK");
    expect(allowedNextStatuses("RESERVED", "VN")).not.toContain("FOR_SALE");
    expect(allowedNextStatuses("RESERVED", "VO")).toContain("FOR_SALE");
    expect(allowedNextStatuses("RESERVED", "VO")).not.toContain("IN_STOCK");
  });
  it("forbids skipping steps or mixing lifecycles", () => {
    expect(canTransition("ORDERED", "DELIVERED", "VN")).toBe(false);
    expect(canTransition("INTAKE", "SOLD", "VO")).toBe(false);
    expect(canTransition("IN_STOCK", "FOR_SALE", "VN")).toBe(false);
    expect(canTransition("DELIVERED", "IN_STOCK", "VN")).toBe(false);
  });
  it("turns a delivered car into a customer car, and a customer car into a trade-in", () => {
    expect(canTransition("DELIVERED", "CUSTOMER", "VN")).toBe(true);
    expect(canTransition("CUSTOMER", "INTAKE", "NONE")).toBe(true);
  });
});

describe("stock ageing", () => {
  it.each([
    [0, "ok"],
    [59, "ok"],
    [60, "watch"],
    [90, "warning"],
    [119, "warning"],
    [120, "critical"],
  ] as const)("%d days → %s", (days, level) => expect(ageingLevel(days)).toBe(level));
  it("accepts custom thresholds", () => expect(ageingLevel(30, [30, 45, 60])).toBe("watch"));
});

describe("customers", () => {
  it("builds display names", () => {
    expect(customerDisplayName({ kind: "INDIVIDUAL", firstName: "Jeanne", lastName: "Martin" })).toBe("Jeanne MARTIN");
    expect(customerDisplayName({ kind: "COMPANY", companyName: " Transports Leroy " })).toBe("Transports Leroy");
  });
  it("derives the auxiliary account", () => expect(customerAccountCode("C000042")).toBe("411C000042"));
  it("validates SIREN with Luhn", () => {
    expect(isValidSiren("552081317")).toBe(true);
    expect(isValidSiren("552 081 317")).toBe(true);
    expect(isValidSiren("552081318")).toBe(false);
    expect(isValidSiren("12345")).toBe(false);
  });
  it("derives and validates French VAT numbers", () => {
    expect(frenchVatNumber("552081317")).toBe("FR03552081317");
    expect(isValidFrenchVatNumber("FR 03 552081317")).toBe(true);
    expect(isValidFrenchVatNumber("FR04552081317")).toBe(false);
  });
});

describe("document numbers", () => {
  it("formats yearly and perpetual series", () => {
    expect(formatDocumentNumber({ prefix: "NTE-FA", fiscalYear: 2026, padding: 6, value: 123 })).toBe("NTE-FA-2026-000123");
    expect(formatDocumentNumber({ prefix: "C", fiscalYear: 0, padding: 6, value: 7 })).toBe("C000007");
  });
  it("rejects invalid values", () => {
    expect(() => formatDocumentNumber({ prefix: "C", fiscalYear: 0, padding: 6, value: 0 })).toThrow();
  });
});

describe("date helpers", () => {
  it("works on calendar days in UTC", () => {
    const d = toDateOnly(new Date("2026-03-31T23:30:00Z"));
    expect(addDays(d, 1).toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(daysBetween(new Date("2026-01-01"), new Date("2026-03-01"))).toBe(59);
  });
});
