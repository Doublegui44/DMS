import type { ServiceContext } from "@/lib/context";
import { parseInput } from "@/lib/validation";
import { ageInYears, valueOnMarket, type MarketValuation } from "../domain/market";
import { marketQueryInputSchema, type MarketQueryInput } from "../schemas/sales";

/** Price of a car new, incl. VAT, when the make and model are not in the catalogue (fictional). */
export const FALLBACK_NEW_PRICE_CENTS = 2_800_000;

/**
 * Asks the market price feed (mock, D-083) for a used car's trade value. The new price comes from
 * the catalogue when the group sells that model (cheapest version, incl. standard VAT), else a
 * flat fallback. Reads only: nothing is saved, the salesperson copies the estimate if it suits.
 */
export async function getMarketValuation(ctx: ServiceContext, input: MarketQueryInput): Promise<MarketValuation & { newPriceCents: number; fromCatalogue: boolean; ageYears: number }> {
  ctx.require("sales.trade_in", "view");
  const q = parseInput(marketQueryInputSchema, input);
  const version = await ctx.tx.catalogueVersion.findFirst({
    where: { model: { name: { equals: q.model, mode: "insensitive" }, brand: { name: { equals: q.make, mode: "insensitive" } } } },
    orderBy: { listPriceExclVatCents: "asc" },
    select: { listPriceExclVatCents: true },
  });
  const newPriceCents = version ? Math.round(version.listPriceExclVatCents * 1.2) : FALLBACK_NEW_PRICE_CENTS;
  const ageYears = ageInYears(q.firstRegistration, ctx.businessDate);
  const valuation = valueOnMarket({ make: q.make, model: q.model, newPriceCents, ageYears, mileage: q.mileage, fuel: q.fuel }, ctx.businessDate.getUTCFullYear());
  return { ...valuation, newPriceCents, fromCatalogue: !!version, ageYears };
}
