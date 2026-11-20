/**
 * Vehicle taxes and pass-through fees (pure). The scales come from settings and are illustrative,
 * not the exact legal ones (business assumption 6). Amounts in cents.
 */
import type { Cents } from "@/lib/money";

export type Fuel = "PETROL" | "DIESEL" | "HYBRID" | "PLUGIN_HYBRID" | "ELECTRIC" | "LPG";

export interface RegistrationFeeRules {
  /** Fixed part: management tax + delivery of the certificate. */
  fixedCents: Cents;
  /** Regional tax per fiscal horsepower (set per site: regions differ). */
  perFiscalHpCents: Cents;
  /** Electric vehicles pay no regional tax. */
  electricExempt: boolean;
}

export interface EcoMalusRules {
  /** [CO₂ g/km from which the amount applies, amount in cents], ascending CO₂. */
  brackets: [number, Cents][];
}

export interface EcoBonusRules {
  amountCents: Cents;
  /** Price incl. VAT (vehicle + options − discount) above which no bonus is granted. */
  maxPriceInclCents: Cents;
  fuels: Fuel[];
  individualsOnly: boolean;
}

export const DEFAULT_REGISTRATION_FEE: RegistrationFeeRules = { fixedCents: 1_376, perFiscalHpCents: 5_100, electricExempt: true };

export const DEFAULT_ECO_MALUS: EcoMalusRules = {
  brackets: [
    [113, 5_000],
    [118, 15_000],
    [123, 40_000],
    [128, 90_000],
    [133, 150_000],
    [138, 230_000],
    [143, 330_000],
    [153, 600_000],
    [173, 1_500_000],
    [193, 6_000_000],
  ],
};

export const DEFAULT_ECO_BONUS: EcoBonusRules = { amountCents: 300_000, maxPriceInclCents: 4_700_000, fuels: ["ELECTRIC"], individualsOnly: true };

/**
 * Administrative horsepower ("chevaux fiscaux"): CO₂/45 + (kW/40)^1.6, rounded, at least 1.
 * Power is entered in hp (1 hp = 0.7355 kW).
 */
export function fiscalHorsepower(args: { co2: number | null; powerHp: number | null }): number {
  const kw = (args.powerHp ?? 0) * 0.7355;
  return Math.max(1, Math.round((args.co2 ?? 0) / 45 + Math.pow(kw / 40, 1.6)));
}

/** Registration certificate: fixed part + regional tax × fiscal horsepower (electric exempt). */
export function registrationFee(v: { fuel: Fuel; co2: number | null; powerHp: number | null }, rules: RegistrationFeeRules): Cents {
  const regional = rules.electricExempt && v.fuel === "ELECTRIC" ? 0 : fiscalHorsepower(v) * rules.perFiscalHpCents;
  return rules.fixedCents + regional;
}

/** CO₂ malus on a first registration in France: amount of the highest bracket reached. */
export function ecoMalus(co2: number | null, rules: EcoMalusRules): Cents {
  if (co2 === null || co2 <= 0) return 0;
  let amount = 0;
  for (const [from, cents] of [...rules.brackets].sort((a, b) => a[0] - b[0])) {
    if (co2 >= from) amount = cents;
  }
  return amount;
}

/** Environmental bonus, advanced by the dealer on the invoice and claimed back from the State. */
export function ecoBonus(
  args: { fuel: Fuel; priceInclVatCents: Cents; customerKind: "INDIVIDUAL" | "COMPANY" | "OEM" },
  rules: EcoBonusRules,
): Cents {
  if (!rules.fuels.includes(args.fuel)) return 0;
  if (rules.individualsOnly && args.customerKind !== "INDIVIDUAL") return 0;
  if (args.priceInclVatCents > rules.maxPriceInclCents) return 0;
  return rules.amountCents;
}

export interface VehicleFees {
  fiscalHp: number;
  registrationFeeCents: Cents;
  ecoMalusCents: Cents;
  ecoBonusCents: Cents;
}

/** Fees of a deal. Malus and bonus apply to new vehicles only; registration to both (optional). */
export function computeFees(
  args: {
    stockType: "VN" | "VO";
    fuel: Fuel;
    co2: number | null;
    powerHp: number | null;
    priceInclVatCents: Cents;
    customerKind: "INDIVIDUAL" | "COMPANY" | "OEM";
    includeRegistration: boolean;
  },
  rules: { registration: RegistrationFeeRules; malus: EcoMalusRules; bonus: EcoBonusRules },
): VehicleFees {
  const isNew = args.stockType === "VN";
  return {
    fiscalHp: fiscalHorsepower(args),
    registrationFeeCents: args.includeRegistration ? registrationFee(args, rules.registration) : 0,
    ecoMalusCents: isNew ? ecoMalus(args.co2, rules.malus) : 0,
    ecoBonusCents: isNew ? ecoBonus(args, rules.bonus) : 0,
  };
}
