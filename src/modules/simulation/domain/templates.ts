/**
 * What the simulated dealership does, as data: workshop jobs (operation code + the parts they
 * use, matched by the start of the part's description) and the pricing rules of the sales desk.
 * The seed's workshop history (prisma/seed/workshop.ts) uses the same jobs; keep the two in step.
 */

export type PartWant = { name: string; qty: number };
export type JobTemplate = { description: string; op: string; parts: PartWant[]; weight: number };

/** Customer work, weighted by how often it comes in. */
export const JOB_TEMPLATES: JobTemplate[] = [
  { description: "Annual service", op: "OIL-SVC", parts: [{ name: "Oil filter", qty: 1 }, { name: "Engine oil 5W-30", qty: 4.5 }], weight: 30 },
  { description: "Major service", op: "SVC-MAJOR", parts: [{ name: "Oil filter", qty: 1 }, { name: "Air filter", qty: 1 }, { name: "Cabin filter", qty: 1 }, { name: "Engine oil 5W-30", qty: 4.5 }], weight: 10 },
  { description: "Front brakes worn", op: "BRK-PADS-F", parts: [{ name: "Front brake pads", qty: 1 }, { name: "Brake cleaner", qty: 1 }], weight: 10 },
  { description: "Rear brakes worn", op: "BRK-PADS-R", parts: [{ name: "Rear brake pads", qty: 1 }], weight: 5 },
  { description: "Front discs and pads", op: "BRK-DISCS-F", parts: [{ name: "Front brake discs (pair)", qty: 1 }, { name: "Front brake pads", qty: 1 }], weight: 5 },
  { description: "Brake fluid due", op: "BRAKE-FLUID", parts: [{ name: "Brake fluid DOT 4", qty: 1 }], weight: 4 },
  { description: "Timing belt due", op: "TIMING-BELT", parts: [{ name: "Timing belt kit", qty: 1 }, { name: "Water pump", qty: 1 }, { name: "Coolant", qty: 3 }], weight: 4 },
  { description: "Misfire", op: "SPARK-PLUGS", parts: [{ name: "Spark plug", qty: 4 }], weight: 3 },
  { description: "Squealing belt", op: "AUX-BELT", parts: [{ name: "Auxiliary belt", qty: 1 }], weight: 2 },
  { description: "Two new tyres", op: "TYRES-2", parts: [{ name: "Tyre 205/55 R16", qty: 2 }], weight: 8 },
  { description: "Car pulls to one side", op: "ALIGNMENT", parts: [], weight: 3 },
  { description: "Knocking front suspension", op: "ARB-LINKS", parts: [{ name: "Anti-roll bar link", qty: 2 }], weight: 3 },
  { description: "Worn shock absorbers", op: "SHOCKS-F", parts: [{ name: "Front shock absorber", qty: 2 }], weight: 2 },
  { description: "Battery flat", op: "BATTERY", parts: [{ name: "Battery 70 Ah", qty: 1 }], weight: 5 },
  { description: "Headlamp out", op: "BULB", parts: [{ name: "Headlamp bulb H7", qty: 1 }], weight: 3 },
  { description: "Warning light on", op: "DIAG", parts: [], weight: 6 },
  { description: "Air-conditioning not cold", op: "AC-RECHARGE", parts: [{ name: "Air-conditioning cleaner", qty: 1 }], weight: 4 },
  { description: "Wipers smearing", op: "WIPERS", parts: [{ name: "Front wiper blade set", qty: 1 }], weight: 3 },
];

/** Defects the manufacturer pays for on cars under three years old. */
export const WARRANTY_TEMPLATES: JobTemplate[] = [
  { description: "Alternator failure (warranty)", op: "ALTERNATOR", parts: [{ name: "Alternator", qty: 1 }], weight: 2 },
  { description: "Window regulator broken (warranty)", op: "WINDOW-REG", parts: [{ name: "Window regulator", qty: 1 }], weight: 3 },
  { description: "ABS warning light (warranty)", op: "ABS-SENSOR", parts: [{ name: "ABS sensor", qty: 1 }], weight: 3 },
  { description: "Rough idle (warranty)", op: "INJECTOR", parts: [{ name: "Injector", qty: 1 }], weight: 1 },
  { description: "Emissions fault (warranty)", op: "LAMBDA", parts: [{ name: "Lambda sensor", qty: 1 }], weight: 2 },
  { description: "Starter motor failure (warranty)", op: "STARTER", parts: [{ name: "Starter motor", qty: 1 }], weight: 1 },
];

/** What the workshop does to a used car before it goes on sale. */
export const RECONDITIONING_TEMPLATES: JobTemplate[] = [
  { description: "Service before sale", op: "OIL-SVC", parts: [{ name: "Oil filter", qty: 1 }, { name: "Engine oil 5W-30", qty: 4.5 }], weight: 6 },
  { description: "Front brakes", op: "BRK-PADS-F", parts: [{ name: "Front brake pads", qty: 1 }], weight: 3 },
  { description: "Two tyres", op: "TYRES-2", parts: [{ name: "Tyre 205/55 R16", qty: 2 }], weight: 3 },
  { description: "Wiper blades", op: "WIPERS", parts: [{ name: "Front wiper blade set", qty: 1 }], weight: 2 },
  { description: "Battery", op: "BATTERY", parts: [{ name: "Battery 70 Ah", qty: 1 }], weight: 1 },
];

/** The job template behind an appointment's concern, if it came from one. */
export const templateFor = (concern: string) => JOB_TEMPLATES.find((t) => t.description === concern) ?? null;

export const round100 = (cents: number) => Math.round(cents / 10_000) * 10_000; // whole €100
export const endsIn90 = (cents: number) => Math.round(cents / 10_000) * 10_000 - 1_000; // €…90

/** Market value of a used car: 15 % a year off its new price, less 1 % per 10,000 km (capped at 200,000 km). */
export function marketValueCents(newPriceCents: number, ageYears: number, mileage: number): number {
  return round100(newPriceCents * Math.pow(0.85, Math.max(0, ageYears)) * (1 - Math.min(Math.max(0, mileage), 200_000) / 1_000_000));
}

/**
 * Price of a used car going on sale: its market value marked up, but at least 15 % over its
 * cost (on the price incl. VAT when the car is sold under the standard VAT regime).
 */
export function voListPriceCents(a: { marketCents: number; stockValueCents: number; standardVat: boolean; markUp: number }): number {
  const floor = a.standardVat ? a.stockValueCents * 1.2 * 1.15 : a.stockValueCents * 1.15;
  return endsIn90(Math.max(a.marketCents * a.markUp, floor));
}

/** A discount off the list price, in whole €10, as a share between `lo` and `hi` %. */
export const discountCents = (listInclCents: number, pct: number) => Math.floor((listInclCents * pct) / 100 / 1_000) * 1_000;
