/** Vehicle rules (pure): VIN, French plates, status lifecycle, stock ageing. */

export type VehicleStatus =
  | "ORDERED"
  | "IN_TRANSIT"
  | "IN_STOCK"
  | "INTAKE"
  | "RECONDITIONING"
  | "FOR_SALE"
  | "RESERVED"
  | "SOLD"
  | "DELIVERED"
  | "CUSTOMER";

export type StockType = "VN" | "VO" | "NONE";

// ── VIN (ISO 3779) ───────────────────────────────────────────

const VIN_ALPHABET = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789"; // no I, O, Q
const VIN_TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function normaliseVin(vin: string): string {
  return vin.replace(/\s/g, "").toUpperCase();
}

/** Structural VIN check: 17 chars, no I/O/Q. (EU VINs do not require the check digit.) */
export function isValidVin(vin: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(normaliseVin(vin));
}

/** North-American check digit (position 9). Used by the generator so seeded VINs look right everywhere. */
export function vinCheckDigit(vin: string): string {
  const v = normaliseVin(vin);
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = v[i];
    const value = /\d/.test(ch) ? Number(ch) : VIN_TRANSLIT[ch] ?? 0;
    sum += value * VIN_WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? "X" : String(r);
}

/** Build a valid-looking VIN from a 3-char WMI and a random source in [0, 1). */
export function generateVin(wmi: string, random: () => number, modelYearCode = "R"): string {
  const pick = () => VIN_ALPHABET[Math.floor(random() * VIN_ALPHABET.length)];
  const digit = () => String(Math.floor(random() * 10));
  const vds = Array.from({ length: 5 }, pick).join("");
  const plant = pick();
  const serial = Array.from({ length: 6 }, digit).join("");
  const draft = `${wmi}${vds}0${modelYearCode}${plant}${serial}`;
  return draft.slice(0, 8) + vinCheckDigit(draft) + draft.slice(9);
}

// ── French registration plates (SIV, AB-123-CD) ─────────────

const PLATE_LETTERS = "ABCDEFGHJKLMNPQRSTVWXYZ"; // no I, O, U
const FORBIDDEN_PAIRS = new Set(["SS", "WW"]);

export function normalisePlate(plate: string): string {
  const p = plate.replace(/[\s-]/g, "").toUpperCase();
  return p.length === 7 ? `${p.slice(0, 2)}-${p.slice(2, 5)}-${p.slice(5)}` : plate.toUpperCase();
}

export function isValidFrenchPlate(plate: string): boolean {
  const p = normalisePlate(plate);
  const m = /^([A-HJ-NP-TV-Z]{2})-(\d{3})-([A-HJ-NP-TV-Z]{2})$/.exec(p);
  if (!m) return false;
  if (m[2] === "000") return false;
  return !FORBIDDEN_PAIRS.has(m[1]) && m[3] !== "SS";
}

export function generateFrenchPlate(random: () => number): string {
  const letter = () => PLATE_LETTERS[Math.floor(random() * PLATE_LETTERS.length)];
  for (;;) {
    const num = String(1 + Math.floor(random() * 999)).padStart(3, "0");
    const plate = `${letter()}${letter()}-${num}-${letter()}${letter()}`;
    if (isValidFrenchPlate(plate)) return plate;
  }
}

// ── Status lifecycle ─────────────────────────────────────────

const TRANSITIONS: Record<VehicleStatus, VehicleStatus[]> = {
  ORDERED: ["IN_TRANSIT", "IN_STOCK", "RESERVED"],
  IN_TRANSIT: ["IN_STOCK", "RESERVED"],
  IN_STOCK: ["RESERVED", "SOLD"],
  INTAKE: ["RECONDITIONING", "FOR_SALE"],
  RECONDITIONING: ["FOR_SALE"],
  FOR_SALE: ["RESERVED", "SOLD", "RECONDITIONING"],
  RESERVED: ["SOLD", "IN_STOCK", "FOR_SALE", "ORDERED", "IN_TRANSIT"],
  SOLD: ["DELIVERED", "RESERVED", "IN_STOCK", "FOR_SALE"],
  DELIVERED: ["CUSTOMER"],
  CUSTOMER: ["INTAKE"], // a customer car becomes a trade-in
};

/** Statuses valid for each stock type. */
const STATUSES_BY_STOCK: Record<StockType, VehicleStatus[]> = {
  VN: ["ORDERED", "IN_TRANSIT", "IN_STOCK", "RESERVED", "SOLD", "DELIVERED"],
  VO: ["INTAKE", "RECONDITIONING", "FOR_SALE", "RESERVED", "SOLD", "DELIVERED"],
  NONE: ["CUSTOMER", "INTAKE"],
};

export function initialStatuses(stockType: StockType): VehicleStatus[] {
  if (stockType === "VN") return ["ORDERED", "IN_TRANSIT", "IN_STOCK"];
  if (stockType === "VO") return ["INTAKE", "RECONDITIONING", "FOR_SALE"];
  return ["CUSTOMER"];
}

export function canTransition(from: VehicleStatus, to: VehicleStatus, stockType: StockType): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  // Leaving delivery to CUSTOMER changes stock type, everything else must stay in the same lifecycle.
  if (from === "DELIVERED" && to === "CUSTOMER") return true;
  if (from === "CUSTOMER" && to === "INTAKE") return true;
  return STATUSES_BY_STOCK[stockType].includes(to);
}

/** Next statuses offered in the UI for a manual change. */
export function allowedNextStatuses(from: VehicleStatus, stockType: StockType): VehicleStatus[] {
  return TRANSITIONS[from].filter((to) => canTransition(from, to, stockType));
}

export function isInStock(status: VehicleStatus): boolean {
  return ["IN_STOCK", "INTAKE", "RECONDITIONING", "FOR_SALE", "RESERVED"].includes(status);
}

// ── Stock ageing ─────────────────────────────────────────────

export type AgeingLevel = "ok" | "watch" | "warning" | "critical";

/** Default thresholds 60/90/120 days (configurable via settings). */
export function ageingLevel(daysInStock: number, thresholds: [number, number, number] = [60, 90, 120]): AgeingLevel {
  if (daysInStock >= thresholds[2]) return "critical";
  if (daysInStock >= thresholds[1]) return "warning";
  if (daysInStock >= thresholds[0]) return "watch";
  return "ok";
}
