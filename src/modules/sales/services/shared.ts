/** Helpers shared by the sales services: VAT rate, settings, vehicle lookups, deterministic identifiers. */
import type { Tx } from "@/lib/db";
import { DomainError, NotFoundError } from "@/lib/errors";
import { generateFrenchPlate, generateVin, getSetting, seededRandom } from "@/modules/core";
import { DEFAULT_COMMISSION_RULES, type CommissionRules } from "../domain/pricing";
import { DEFAULT_FINANCING, type FinancingSettings } from "../domain/financing";
import {
  DEFAULT_ECO_BONUS,
  DEFAULT_ECO_MALUS,
  DEFAULT_REGISTRATION_FEE,
  type EcoBonusRules,
  type EcoMalusRules,
  type RegistrationFeeRules,
} from "../domain/fees";

export async function standardRateBp(tx: Tx, siteId: string, date: Date): Promise<number> {
  const site = await tx.site.findUnique({ where: { id: siteId } });
  if (!site) throw new NotFoundError("Site", siteId);
  const rate = await tx.vatRate.findFirst({
    where: { countryCode: site.countryCode, code: "STANDARD", validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
    orderBy: { validFrom: "desc" },
  });
  if (!rate) throw new DomainError("unknown_vat_rate", "No standard VAT rate is configured for this site's country");
  return rate.rateBp;
}

export interface SalesSettings {
  reservationDays: number;
  quoteValidityDays: number;
  commission: CommissionRules;
  financing: FinancingSettings;
  registrationFee: RegistrationFeeRules;
  ecoMalus: EcoMalusRules;
  ecoBonus: EcoBonusRules;
  ageingThresholdsDays: [number, number, number];
}

/** Sales settings of a site (site overrides win over group defaults; code defaults for empty databases). */
export async function salesSettings(tx: Tx, siteId: string | null): Promise<SalesSettings> {
  return {
    reservationDays: await getSetting(tx, "sales.reservationDays", siteId, 7),
    quoteValidityDays: await getSetting(tx, "sales.quoteValidityDays", siteId, 15),
    commission: await getSetting(tx, "sales.commission", siteId, DEFAULT_COMMISSION_RULES),
    financing: await getSetting(tx, "sales.financing", siteId, DEFAULT_FINANCING),
    registrationFee: await getSetting(tx, "sales.registrationFee", siteId, DEFAULT_REGISTRATION_FEE),
    ecoMalus: await getSetting(tx, "sales.ecoMalus", siteId, DEFAULT_ECO_MALUS),
    ecoBonus: await getSetting(tx, "sales.ecoBonus", siteId, DEFAULT_ECO_BONUS),
    ageingThresholdsDays: await getSetting<[number, number, number]>(tx, "sales.stockAgeingThresholdsDays", siteId, [60, 90, 120]),
  };
}

export function vehicleLabel(v: { make: string; model: string; version: string }): string {
  return `${v.make} ${v.model} ${v.version}`.trim();
}

export function partyAddress(p: { address: string | null; postalCode: string | null; city: string | null }): string | null {
  const town = [p.postalCode, p.city].filter(Boolean).join(" ");
  return [p.address, town].filter(Boolean).join(", ") || null;
}

/** Purchase price of a used vehicle: base of the VAT on margin. Falls back to the stock value. */
export async function voPurchasePrice(tx: Tx, vehicle: { id: string; stockValueCents: number }): Promise<number> {
  const purchase = await tx.voPurchase.findFirst({ where: { vehicleId: vehicle.id, cancelledOn: null }, orderBy: { createdAt: "desc" } });
  return purchase?.priceCents ?? vehicle.stockValueCents;
}

/** Catalogue version of a new vehicle: its factory order's, or the catalogue entry with the same model and version names. */
export async function catalogueVersionFor(tx: Tx, v: { id: string; brandId: string | null; model: string; version: string }) {
  const fo = await tx.factoryOrder.findUnique({ where: { vehicleId: v.id }, include: { catalogueVersion: true } });
  if (fo) return fo.catalogueVersion;
  if (!v.brandId) return null;
  return tx.catalogueVersion.findFirst({ where: { name: v.version, model: { name: v.model, brandId: v.brandId } } });
}

/** A VIN that does not exist yet, drawn deterministically from `seed` (a document number). */
export async function uniqueVin(tx: Tx, wmi: string, seed: string): Promise<string> {
  const random = seededRandom(seed);
  for (;;) {
    const vin = generateVin(wmi, random, "T");
    if (!(await tx.vehicle.findUnique({ where: { vin }, select: { id: true } }))) return vin;
  }
}

/** A registration plate that does not exist yet, drawn deterministically from `seed`. */
export async function uniquePlate(tx: Tx, seed: string): Promise<string> {
  const random = seededRandom(seed);
  for (;;) {
    const registration = generateFrenchPlate(random);
    if (!(await tx.vehicle.findUnique({ where: { registration }, select: { id: true } }))) return registration;
  }
}

/** Approval rules on deal discounts, with the approving role's key. */
export async function discountRules(tx: Tx) {
  const rules = await tx.approvalRule.findMany({ where: { key: "deal.discount", active: true, thresholdBp: { not: null } }, include: { approverRole: true } });
  return rules.map((r) => ({ id: r.id, thresholdBp: r.thresholdBp as number, roleKey: r.approverRole.key, roleName: r.approverRole.name }));
}
