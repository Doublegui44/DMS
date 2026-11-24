import { addDays, isoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { generateFrenchPlate, generateVin } from "@/modules/core";
import {
  acceptQuote,
  addVehicleCost,
  cancelOrder,
  createLead,
  createQuote,
  decideQuoteApproval,
  declineQuote,
  DEFAULT_FINANCING,
  deliverOrder,
  invoiceOrder,
  orderForStock,
  purchaseVo,
  receiveVehicle,
  recordOrderPayment,
  reserveQuoteVehicle,
  setForSale,
  setLeadStage,
  shipFactoryOrder,
  startReconditioning,
  submitQuote,
  type QuoteInput,
} from "@/modules/sales";
import { between, chance, pick, poisson, perOpenDay, unit, unitInt, weighted } from "../domain/random";
import { discountCents, marketValueCents, round100, voListPriceCents } from "../domain/templates";
import type { Sim, SiteCast } from "./shared";

export const LOST_REASONS = [
  "Bought elsewhere (better price)",
  "Project postponed",
  "Financing refused",
  "Vehicle not available in time",
  "Kept their current car",
];
const COLOURS = ["Blanc Nacré", "Gris Platine", "Noir Perla", "Bleu Iron", "Rouge Flamme", "Gris Artense"];
const OPEN_QUOTE = ["DRAFT", "PENDING_APPROVAL", "SENT"] as const;
const DAY = 86_400_000;
const daysSince = (sim: Sim, d: Date) => Math.floor((sim.day.getTime() - d.getTime()) / DAY);
const ageYears = (sim: Sim, d: Date | null) => (d ? Math.max(0, (sim.day.getTime() - d.getTime()) / (365 * DAY)) : 6);

/** The sales desk of one site for one day: supply, then the pipeline, then new leads. */
export async function salesDay(sim: Sim, site: SiteCast) {
  await factoryOrders(sim, site);
  if (sim.day.getUTCDay() === 1) await restockVn(sim, site);
  if (chance(sim.rng, perOpenDay(sim.rates.voPurchasesPerWeek))) await buyVo(sim, site);
  await prepareUsedCars(sim, site);
  await advanceLeads(sim, site);
  await advanceQuotes(sim, site);
  await advanceOrders(sim, site);
  const leads = poisson(sim.rng, sim.rates.leadsPerDay);
  for (let i = 0; i < leads; i++) await newLead(sim, site);
}

function seller(sim: Sim, site: SiteCast, userId?: string | null) {
  return site.salespeople.find((a) => a.userId === userId) ?? (site.salesManager?.userId === userId ? site.salesManager : null) ?? site.salespeople[0] ?? site.salesManager;
}

// ── Supply ───────────────────────────────────────────────────────────

/** The manufacturer ships about ten days before the expected date; the car arrives on it. */
async function factoryOrders(sim: Sim, site: SiteCast) {
  const orders = await db.factoryOrder.findMany({ where: { siteId: site.id, status: { in: ["ORDERED", "IN_TRANSIT"] } }, orderBy: { number: "asc" } });
  for (const fo of orders) {
    if (fo.status === "ORDERED" && addDays(fo.expectedOn, -unitInt(sim.rates.seed, fo.id, "ship", 7, 12)) <= sim.day) {
      await sim.step("ship factory order", site.salesManager, site.id, (ctx) => shipFactoryOrder(ctx, fo.id));
    } else if (fo.status === "IN_TRANSIT" && fo.expectedOn <= sim.day) {
      await sim.step("receive new car", site.salesManager, site.id, (ctx) => receiveVehicle(ctx, fo.vehicleId));
    }
  }
}

/** Mondays: order cars for stock when a brand's free stock (in stock or on its way) is low. */
async function restockVn(sim: Sim, site: SiteCast) {
  for (const brandId of site.brandIds) {
    const free = await db.vehicle.count({ where: { siteId: site.id, brandId, stockType: "VN", status: { in: ["IN_STOCK", "ORDERED", "IN_TRANSIT"] }, salesOrders: { none: { status: { not: "CANCELLED" } } } } });
    const missing = Math.min(2, sim.rates.vnStockTarget - free);
    if (missing <= 0) continue;
    const versions = await db.catalogueVersion.findMany({ where: { active: true, model: { brandId } }, include: { options: true }, orderBy: { code: "asc" } });
    for (let i = 0; i < missing && versions.length; i++) {
      const v = pick(sim.rng, versions);
      await sim.step("stock order", site.salesManager, site.id, (ctx) => orderForStock(ctx, { siteId: site.id, catalogueVersionId: v.id, optionIds: options(sim, v.options), colour: pick(sim.rng, COLOURS) }));
    }
  }
}

function options(sim: Sim, list: { id: string; kind: string }[]) {
  const paints = list.filter((o) => o.kind === "PAINT");
  const ids: string[] = [];
  if (paints.length && chance(sim.rng, 0.6)) ids.push(pick(sim.rng, paints).id);
  for (const o of list.filter((x) => x.kind !== "PAINT")) if (chance(sim.rng, 0.25)) ids.push(o.id);
  return ids;
}

/** New price (incl. VAT) of a model from the catalogue, else a typical price. */
async function newPriceCents(make: string, model: string) {
  const v = await db.catalogueVersion.findFirst({ where: { model: { name: model, brand: { name: make } } }, orderBy: { listPriceExclVatCents: "asc" } });
  return v ? Math.round(v.listPriceExclVatCents * 1.2) : 2_800_000;
}

/** A used car bought from a trader the group already buys from, modelled on a car it has handled. */
async function buyVo(sim: Sim, site: SiteCast) {
  const fromPrivate = chance(sim.rng, sim.rates.privateVoShare);
  const [past, privates, total] = await Promise.all([
    db.voPurchase.findMany({ where: { source: "PROFESSIONAL", supplierId: { not: null } }, select: { supplierId: true, vatRegime: true }, distinct: ["supplierId"] }),
    fromPrivate ? db.customer.findMany({ where: { homeSiteId: site.id, kind: "INDIVIDUAL" }, select: { id: true }, orderBy: { number: "asc" } }) : Promise.resolve([]),
    db.vehicle.count({ where: { stockType: "VO" } }),
  ]);
  if (!total || (fromPrivate ? !privates.length : !past.length)) return;
  const seller = fromPrivate ? null : pick(sim.rng, past);
  const privateSeller = fromPrivate ? pick(sim.rng, privates) : null;
  const model = await db.vehicle.findFirstOrThrow({ where: { stockType: "VO" }, orderBy: { vin: "asc" }, skip: Math.floor(sim.rng() * total) });
  const age = between(sim.rng, 1, 5);
  const mileage = Math.round((age * between(sim.rng, 9_000, 18_000)) / 100) * 100;
  const market = marketValueCents(await newPriceCents(model.make, model.model), age, mileage);
  // A private seller accepts a little less than the trade.
  const priceIncl = round100(market * (fromPrivate ? 0.66 + sim.rng() * 0.1 : 0.72 + sim.rng() * 0.1));
  let vin = "";
  for (let i = 0; i < 20 && !vin; i++) {
    const c = generateVin(model.vin.slice(0, 3), sim.rng, "K");
    if (!(await db.vehicle.findUnique({ where: { vin: c }, select: { id: true } }))) vin = c;
  }
  let registration = "";
  for (let i = 0; i < 20 && !registration; i++) {
    const c = generateFrenchPlate(sim.rng);
    if (!(await db.vehicle.findUnique({ where: { registration: c }, select: { id: true } }))) registration = c;
  }
  if (!vin || !registration) return;
  const paymentMethod = chance(sim.rng, 0.8) ? ("TRANSFER" as const) : ("CHEQUE" as const);
  const lot = `LOT-${String(between(sim.rng, 0, 999_999)).padStart(6, "0")}`;
  const terms = privateSeller
    ? { source: "PRIVATE" as const, customerId: privateSeller.id, vatRegime: "MARGIN" as const, priceCents: priceIncl, paymentMethod }
    : { source: "PROFESSIONAL" as const, supplierId: seller!.supplierId!, vatRegime: seller!.vatRegime, priceCents: seller!.vatRegime === "STANDARD" ? round100(priceIncl / 1.2) : priceIncl, supplierReference: lot };
  await sim.step(privateSeller ? "buy used car (private)" : "buy used car", site.salesManager, site.id, (ctx) =>
    purchaseVo(ctx, {
      siteId: site.id,
      ...terms,
      vehicle: {
        vin,
        registration,
        make: model.make,
        model: model.model,
        version: model.version,
        firstRegistration: isoDate(addDays(sim.day, -Math.round(age * 365 + between(sim.rng, 0, 300)))),
        mileage,
        fuel: model.fuel,
        powerHp: model.powerHp ?? undefined,
        colour: model.colour ?? pick(sim.rng, COLOURS),
      },
    }),
  );
}

/** Used cars in intake go to the bodyshop a few days later, then on sale about a week after. */
async function prepareUsedCars(sim: Sim, site: SiteCast) {
  const bodyshop = (await db.vehicleCostLine.findFirst({ where: { kind: "RECONDITIONING", supplierId: { not: null } }, orderBy: { createdAt: "desc" }, select: { supplierId: true } }))?.supplierId;
  const cars = await db.vehicle.findMany({ where: { siteId: site.id, stockType: "VO", status: { in: ["INTAKE", "RECONDITIONING"] }, stockInDate: { not: null } }, orderBy: { vin: "asc" } });
  const seed = sim.rates.seed;
  for (const car of cars) {
    const age = daysSince(sim, car.stockInDate!);
    if (car.status === "INTAKE" && age >= unitInt(seed, car.id, "recondition", 2, 5)) {
      const cost = Math.round((between(sim.rng, 150, 1_100) * 100) / 5_000) * 5_000;
      await sim.step("recondition used car", site.salesManager, site.id, async (ctx) => {
        await startReconditioning(ctx, car.id);
        if (bodyshop) await addVehicleCost(ctx, car.id, { kind: "RECONDITIONING", label: "Bodywork and valeting", amountCents: cost, supplierId: bodyshop, supplierReference: `RC-${car.vin.slice(-5)}` });
        return true;
      });
    } else if (car.status === "RECONDITIONING" && age >= unitInt(seed, car.id, "list", 8, 16)) {
      const appraisal = await db.tradeInAppraisal.findFirst({ where: { vehicleId: car.id }, orderBy: { id: "desc" } });
      const market = appraisal?.marketValueCents ?? marketValueCents(await newPriceCents(car.make, car.model), ageYears(sim, car.firstRegistration), car.mileage);
      const listPriceCents = voListPriceCents({ marketCents: market, stockValueCents: car.stockValueCents, standardVat: car.vatRegime === "STANDARD", markUp: 1.04 + unit(seed, car.id, "markup") * 0.08 });
      await sim.step("put used car on sale", site.salesManager, site.id, (ctx) => setForSale(ctx, car.id, { listPriceCents }));
    }
  }
}

// ── Pipeline ─────────────────────────────────────────────────────────

async function newLead(sim: Sim, site: SiteCast) {
  const customers = await db.customer.findMany({
    where: { homeSiteId: site.id, kind: { in: ["INDIVIDUAL", "COMPANY"] }, leads: { none: { stage: { in: ["NEW", "CONTACTED", "QUOTED"] } } } },
    select: { id: true },
    orderBy: { number: "asc" },
  });
  const actor = sim.rng() < 0.85 && site.salespeople.length ? pick(sim.rng, site.salespeople) : site.salesManager;
  if (!customers.length || !actor) return;
  const vn = chance(sim.rng, sim.rates.vnShare);
  const source = weighted(sim.rng, [
    { value: "WALK_IN" as const, weight: 4 },
    { value: "WEB" as const, weight: 3 },
    { value: "PHONE" as const, weight: 2 },
    { value: "RETURNING" as const, weight: 1 },
    { value: "REFERRAL" as const, weight: 1 },
  ]);
  const description = vn ? pick(sim.rng, ["New car, hybrid preferred", "Replacing a company car", "First new car"]) : pick(sim.rng, ["Used car, budget-conscious", "Second family car", "Low mileage used car"]);
  await sim.step("new lead", actor, site.id, (ctx) => createLead(ctx, { siteId: site.id, customerId: pick(sim.rng, customers).id, source, interest: vn ? "VN" : "VO", description }));
}

/** Leads are called back the next day; a few are lost before any quote, the others get one. */
async function advanceLeads(sim: Sim, site: SiteCast) {
  const seed = sim.rates.seed;
  const leads = await db.lead.findMany({ where: { siteId: site.id, stage: { in: ["NEW", "CONTACTED"] } }, orderBy: { number: "asc" } });
  for (const lead of leads) {
    const actor = seller(sim, site, lead.salespersonId);
    const age = daysSince(sim, lead.openedOn);
    if (lead.stage === "NEW") {
      if (age >= 1) await sim.step("contact lead", actor, site.id, (ctx) => setLeadStage(ctx, lead.id, "CONTACTED"));
      continue;
    }
    if (unit(seed, lead.id, "lost-early") < sim.rates.lostEarlyRate) {
      if (age >= unitInt(seed, lead.id, "lost-day", 4, 12)) await sim.step("lose lead", actor, site.id, (ctx) => setLeadStage(ctx, lead.id, "LOST", LOST_REASONS[unitInt(seed, lead.id, "reason", 0, LOST_REASONS.length - 1)]));
      continue;
    }
    if (age < unitInt(seed, lead.id, "quote-day", 2, 5)) continue;
    const quoted = await quoteLead(sim, site, lead);
    if (!quoted && age > 21) await sim.step("lose lead", actor, site.id, (ctx) => setLeadStage(ctx, lead.id, "LOST", "No suitable car in stock"));
  }
}

async function quoteLead(sim: Sim, site: SiteCast, lead: { id: string; customerId: string; interest: string; salespersonId: string | null }) {
  const vn = lead.interest === "VN";
  const quotedVehicles = (await db.quote.findMany({ where: { status: { in: [...OPEN_QUOTE] }, vehicleId: { not: null } }, select: { vehicleId: true } })).map((q) => q.vehicleId!);
  const stock = await db.vehicle.findMany({
    where: { siteId: site.id, stockType: vn ? "VN" : "VO", status: vn ? "IN_STOCK" : "FOR_SALE", listPriceCents: { not: null }, id: { notIn: quotedVehicles } },
    select: { id: true, listPriceCents: true },
    orderBy: { vin: "asc" },
  });
  const vehicle = stock.length && (!vn || chance(sim.rng, 0.65)) ? pick(sim.rng, stock) : null;
  let version: { id: string; listPriceExclVatCents: number; options: { id: string; kind: string; listPriceExclVatCents: number }[] } | null = null;
  if (!vehicle && vn) {
    const versions = await db.catalogueVersion.findMany({ where: { active: true, model: { brandId: { in: site.brandIds } } }, include: { options: true }, orderBy: { code: "asc" } });
    version = versions.length ? pick(sim.rng, versions) : null;
  }
  if (!vehicle && !version) return false;
  const optionIds = version ? options(sim, version.options) : [];
  const listIncl = vehicle ? vehicle.listPriceCents! : Math.round((version!.listPriceExclVatCents + version!.options.filter((o) => optionIds.includes(o.id)).reduce((t, o) => t + o.listPriceExclVatCents, 0)) * 1.2);
  const [lo, hi] = vn
    ? weighted(sim.rng, [
        { value: [0, 3], weight: 60 },
        { value: [3, 4.8], weight: 25 },
        { value: [5.2, 9.8], weight: 12 },
        { value: [10.2, 12], weight: 3 },
      ])
    : weighted(sim.rng, [
        { value: [0, 2], weight: 85 },
        { value: [2, 4], weight: 15 },
      ]);
  const discount = discountCents(listIncl, lo + sim.rng() * (hi - lo));
  const addOns = await db.addOnProduct.findMany({ where: { active: true }, select: { id: true }, orderBy: { code: "asc" } });
  const tradeIn = chance(sim.rng, sim.rates.tradeInRate) ? await tradeInFor(sim, lead.customerId, Math.round((listIncl - discount) * 0.7)) : undefined;
  let financing: QuoteInput["financing"];
  const toFinance = listIncl - discount - Number(tradeIn?.offerCents ?? 0);
  if (chance(sim.rng, sim.rates.financingRate) && toFinance > 1_500_000) {
    const lease = chance(sim.rng, 0.25);
    const principal = round100(toFinance * (0.5 + sim.rng() * 0.35));
    financing = {
      kind: lease ? "LEASE" : "LOAN",
      lender: pick(sim.rng, DEFAULT_FINANCING.lenders),
      principalCents: principal,
      months: lease ? pick(sim.rng, [36, 48]) : pick(sim.rng, [24, 36, 48, 60]),
      residualCents: lease ? round100(principal * (0.35 + sim.rng() * 0.15)) : 0,
    };
  }
  const input: QuoteInput = {
    leadId: lead.id,
    vehicleId: vehicle?.id ?? null,
    catalogueVersionId: version?.id ?? null,
    optionIds,
    colour: version ? pick(sim.rng, COLOURS) : null,
    accessories: [],
    addOnIds: addOns.length && chance(sim.rng, 0.45) ? [pick(sim.rng, addOns).id] : [],
    discountInclVatCents: discount,
    tradeIn,
    financing,
  };
  const reserve = !!vehicle && chance(sim.rng, 0.3);
  const quote = await sim.step("quote", seller(sim, site, lead.salespersonId), site.id, async (ctx) => {
    const q = await submitQuote(ctx, (await createQuote(ctx, input)).id);
    if (reserve) await reserveQuoteVehicle(ctx, q.id);
    return q;
  });
  return !!quote;
}

/** The customer's own car, offered below its market value; none if worth too much for the deal. */
async function tradeInFor(sim: Sim, customerId: string, maxOfferCents: number): Promise<QuoteInput["tradeIn"]> {
  const own = await db.vehicle.findFirst({ where: { ownerCustomerId: customerId, status: "CUSTOMER", stockType: "NONE" }, orderBy: { vin: "asc" } });
  if (!own) return undefined;
  const market = marketValueCents(await newPriceCents(own.make, own.model), ageYears(sim, own.firstRegistration), own.mileage);
  const repair = Math.round(between(sim.rng, 0, 150_000) / 5_000) * 5_000;
  const offer = round100((market - repair) * (0.82 + sim.rng() * 0.1));
  if (offer < 100_000 || offer > maxOfferCents) return undefined;
  return {
    vehicleId: own.id,
    vin: own.vin,
    registration: own.registration,
    make: own.make,
    model: own.model,
    version: own.version,
    firstRegistration: own.firstRegistration ? isoDate(own.firstRegistration) : null,
    mileage: own.mileage + between(sim.rng, 0, 800),
    fuel: own.fuel,
    marketValueCents: market,
    estimatedRepairCents: repair,
    offerCents: offer,
  };
}

/** Approvals the next working day; customers answer within a week; closed quotes close their lead. */
async function advanceQuotes(sim: Sim, site: SiteCast) {
  const seed = sim.rates.seed;
  const quotes = await db.quote.findMany({
    where: { siteId: site.id, OR: [{ status: { in: ["PENDING_APPROVAL", "SENT"] } }, { status: { in: ["DECLINED", "EXPIRED"] }, lead: { stage: "QUOTED" } }] },
    include: { lead: { select: { id: true, stage: true } } },
    orderBy: { number: "asc" },
  });
  for (const q of quotes) {
    const actor = seller(sim, site, q.salespersonId);
    if (q.status === "PENDING_APPROVAL") {
      const approver = q.discountBp > 1000 || q.salespersonId === site.salesManager?.userId ? sim.cast.dealerPrincipal : site.salesManager;
      await sim.step("approve discount", approver, site.id, (ctx) => decideQuoteApproval(ctx, q.id, "APPROVE", "Agreed"));
    } else if (q.status === "SENT") {
      if (daysSince(sim, q.sentOn ?? q.createdOn) < unitInt(seed, q.id, "decide", 1, 7)) continue;
      if (unit(seed, q.id, "accept") < sim.rates.conversionRate) await acceptDeal(sim, site, q.id, actor);
      else if (unit(seed, q.id, "decline") < 0.7) {
        await sim.step("decline quote", actor, site.id, async (ctx) => {
          await declineQuote(ctx, q.id);
          return setLeadStage(ctx, q.lead.id, "LOST", LOST_REASONS[unitInt(seed, q.id, "reason", 0, LOST_REASONS.length - 1)]);
        });
      } // else: no answer, the quote expires at the end of its validity
    } else {
      await sim.step("lose lead", actor, site.id, (ctx) => setLeadStage(ctx, q.lead.id, "LOST", q.status === "EXPIRED" ? "No answer after follow-ups" : "Quote declined"));
    }
  }
}

async function acceptDeal(sim: Sim, site: SiteCast, quoteId: string, actor: SiteCast["salesManager"]) {
  const order = await sim.step("order signed", actor, site.id, (ctx) => acceptQuote(ctx, quoteId));
  if (!order) return;
  const quote = await db.quote.findUniqueOrThrow({ where: { id: quoteId } });
  if (quote.balanceDueCents >= 100_000) {
    const deposit = Math.min(quote.balanceDueCents, Math.max(50_000, round100(quote.balanceDueCents * (0.05 + sim.rng() * 0.15))));
    const method = weighted(sim.rng, [
      { value: "CARD" as const, weight: 5 },
      { value: "CHEQUE" as const, weight: 3 },
      { value: "TRANSFER" as const, weight: 2 },
    ]);
    await sim.step("deposit", site.salesManager, site.id, (ctx) => recordOrderPayment(ctx, order.id, { amountCents: deposit, method }));
  }
}

/** Orders: a few are cancelled; the others are invoiced once the car is here, paid, then delivered. */
async function advanceOrders(sim: Sim, site: SiteCast) {
  const seed = sim.rates.seed;
  const orders = await db.salesOrder.findMany({
    where: { siteId: site.id, status: { in: ["CONFIRMED", "INVOICED"] } },
    include: { invoice: true, customer: { select: { kind: true } }, vehicle: { select: { mileage: true, stockType: true, factoryOrder: { select: { status: true, arrivedOn: true } } } } },
    orderBy: { number: "asc" },
  });
  for (const o of orders) {
    const fo = o.vehicle.factoryOrder;
    if (o.status === "CONFIRMED") {
      const waiting = fo && (fo.status === "ORDERED" || fo.status === "IN_TRANSIT");
      if (!waiting && unit(seed, o.id, "cancel") < sim.rates.cancellationRate) {
        if (daysSince(sim, o.orderDate) >= 1) await sim.step("cancel order", site.salesManager, site.id, (ctx) => cancelOrder(ctx, o.id, "Customer withdrew within the cooling-off period"));
        continue;
      }
      if (waiting) continue;
      const ready = fo?.arrivedOn && fo.arrivedOn > o.orderDate ? fo.arrivedOn : o.orderDate;
      if (daysSince(sim, ready) >= unitInt(seed, o.id, "invoice", 3, 10)) await sim.step("invoice sale", site.salesManager, site.id, (ctx) => invoiceOrder(ctx, o.id));
      continue;
    }
    if (!o.invoice || !o.invoicedOn) continue;
    const company = o.customer.kind === "COMPANY";
    const payDay = unitInt(seed, o.id, "pay", company ? 3 : 0, company ? 12 : 3);
    const due = o.invoice.totalInclVatCents - o.invoice.paidCents;
    if (due > 0) {
      if (daysSince(sim, o.invoicedOn) >= payDay) {
        const method = company ? ("TRANSFER" as const) : weighted(sim.rng, [
          { value: "TRANSFER" as const, weight: 6 },
          { value: "CHEQUE" as const, weight: 3 },
          { value: "CARD" as const, weight: 1 },
        ]);
        await sim.step("sale payment", site.salesManager, site.id, (ctx) => recordOrderPayment(ctx, o.id, { amountCents: due, method }));
      }
      continue;
    }
    if (daysSince(sim, o.invoicedOn) >= payDay + unitInt(seed, o.id, "deliver", 0, 3)) {
      const mileage = o.vehicle.stockType === "VN" ? o.vehicle.mileage + unitInt(seed, o.id, "km", 3, 25) : undefined;
      await sim.step("deliver car", seller(sim, site, o.salespersonId), site.id, (ctx) => deliverOrder(ctx, o.id, { mileage }));
    }
  }
}
