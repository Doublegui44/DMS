/**
 * Seed — sales (Phase 3). Reference data (catalogue, add-ons, used-car suppliers), then six months
 * of sales activity run day by day inside the accounting history, so document numbers stay
 * chronological:
 *  - supply: stock orders to the manufacturers (shipped, then received), used cars bought at
 *    auction or from a lessor, reconditioned and put on sale;
 *  - deals: lead → contact → quote (approved when the discount needs it) → order (trade-in,
 *    deposit) → invoice → payment → delivery, or lost / declined / expired / cancelled;
 *  - the vehicles already on order or in VO stock when the history starts get their factory
 *    order or police-register entry on the day they were ordered or bought.
 * Commands run as the sites' own users, so permissions, approvals and commissions are real.
 * Deals still running on the seed's business date are left as they are (open pipeline).
 * A separate Faker instance (seed 4242) keeps the earlier seed data identical.
 */
import { Faker, base, en, fr } from "@faker-js/faker";
import { loadActor } from "@/lib/actor";
import { runCommand, SYSTEM_ACTOR, type Actor, type ServiceContext } from "@/lib/context";
import { addDays, isoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { createSupplier, generateFrenchPlate, generateVin } from "@/modules/core";
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
  expireQuotes,
  expireReservations,
  invoiceOrder,
  orderForStock,
  purchaseVo,
  receiveVehicle,
  recordOrderPayment,
  registerOpeningFactoryOrder,
  registerOpeningVo,
  registerPastArrival,
  registerPastVoPurchase,
  reserveQuoteVehicle,
  setForSale,
  setLeadStage,
  shipFactoryOrder,
  startReconditioning,
  submitQuote,
  type QuoteInput,
} from "@/modules/sales";
import type { HistoryHooks } from "./accounting";
import { ACCESSORIES, ADD_ONS, BRANDS, COLOURS, LOST_REASONS, OPTION_TEMPLATES, SITES, VN_MODELS, VO_MODELS, VO_SUPPLIERS } from "./data";

/** A scheduled step; it receives the day it actually runs (later than planned when that day had passed). */
type Task = (on: Date) => Promise<void>;
type Fuel = "PETROL" | "DIESEL" | "HYBRID" | "PLUGIN_HYBRID" | "ELECTRIC" | "LPG";
type Customer = { id: string; kind: "INDIVIDUAL" | "COMPANY" };
type Version = { id: string; brandId: string; listPriceExclVatCents: number; options: { id: string; kind: string; listPriceExclVatCents: number }[] };
type UsedCar = {
  vin: string;
  registration: string | null;
  make: string;
  model: string;
  version: string;
  firstRegistration: Date | null;
  mileage: number;
  fuel: Fuel;
  marketCents: number;
};

interface SiteState {
  id: string;
  brandCodes: string[];
  brandIds: string[];
  sm: Actor;
  salespeople: Actor[];
  individuals: Customer[];
  companies: Customer[];
  versions: Version[];
}

interface Deal {
  site: SiteState;
  salesperson: Actor;
  customer: Customer;
  leadId: string;
  interest: "VN" | "VO";
  outcome: "WON" | "LOST_EARLY" | "DECLINED" | "EXPIRES";
  attempts: number;
  quoteId?: string;
  orderId?: string;
  vehicleId?: string;
}

const QUOTE_VALIDITY_DAYS = 15;
const round100 = (cents: number) => Math.round(cents / 10_000) * 10_000; // whole €100
const endsIn90 = (cents: number) => Math.round(cents / 10_000) * 10_000 - 1_000; // €…90

/** Market value of a used car: a simple depreciation curve (same as the VO stock of seed v1). */
function marketValueCents(newPriceEuros: number, ageYears: number, mileage: number): number {
  return round100(newPriceEuros * 100 * Math.pow(0.85, ageYears) * (1 - Math.min(mileage, 200_000) / 1_000_000));
}

function versionCode(brandCode: string, model: string, index: number): string {
  const m = model
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 6);
  return `${brandCode[0]}${m}-${String(index + 1).padStart(2, "0")}`;
}

export function salesSeeder(args: { today: Date; sites: Map<string, string>; brands: Map<string, string> }) {
  const f = new Faker({ locale: [fr, en, base] });
  f.seed(4242);
  const rnd = () => f.number.float({ min: 0, max: 1, fractionDigits: 6 }) % 1;
  const { today } = args;

  const agenda = new Map<string, Task[]>();
  const taken = new Set<string>(); // vehicles quoted by a running deal
  const busy = new Set<string>(); // customers with a running deal
  const stats = { leads: 0, quotes: 0, orders: 0, delivered: 0, cancelled: 0, lost: 0, stockOrders: 0, voPurchases: 0, skipped: 0 };
  const sites: SiteState[] = [];
  const addOnIds = new Map<string, string>();
  const voSuppliers: { id: string; name: string; address: string; vatRegime: "MARGIN" | "STANDARD" }[] = [];
  let dp: Actor;
  let bodyshopId: string;
  let opening: Date;
  let current: Date;
  let inAgenda = false;

  /** Schedule a task; tasks falling on or after the seed's business date never run (open deals). */
  function at(day: Date, task: Task) {
    const floor = inAgenda ? current : addDays(current, 1);
    const d = day.getTime() < floor.getTime() ? floor : day;
    if (d.getTime() >= today.getTime()) return;
    const key = isoDate(d);
    const list = agenda.get(key);
    if (list) list.push(task);
    else agenda.set(key, [task]);
  }

  /** Replays of the seed's own stock: they must run, on their exact day, or the books would not match the stock. */
  const lateReplays: Task[] = [];
  function replay(day: Date, siteId: string, fn: (ctx: ServiceContext) => Promise<unknown>) {
    const task: Task = async (on) => {
      await runCommand({ actor: SYSTEM_ACTOR, siteId, businessDate: on }, fn);
    };
    if (day.getTime() >= today.getTime()) lateReplays.push(task);
    else at(day, task);
  }

  const timings = new Map<string, { n: number; ms: number }>();

  /** Run a command; a refused business step is skipped (and reported) rather than failing the seed. */
  async function run<T>(step: string, actor: Actor, siteId: string | null, day: Date, fn: (ctx: ServiceContext) => Promise<T>): Promise<T | undefined> {
    const started = performance.now();
    try {
      return await runCommand({ actor, siteId, businessDate: day }, fn);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      stats.skipped++;
      console.warn(`[seed:sales] ${isoDate(day)} ${step} skipped: ${e.message}`);
      return undefined;
    } finally {
      const t = timings.get(step) ?? { n: 0, ms: 0 };
      t.n++;
      t.ms += performance.now() - started;
      timings.set(step, t);
    }
  }

  async function actorFor(email: string): Promise<Actor> {
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const actor = await loadActor(user.id);
    if (!actor) throw new Error(`No actor for ${email}`);
    return actor;
  }

  async function uniqueVin(wmi: string): Promise<string> {
    for (;;) {
      const vin = generateVin(wmi, rnd, "K");
      if (!(await db.vehicle.findUnique({ where: { vin }, select: { id: true } }))) return vin;
    }
  }

  async function uniquePlate(): Promise<string> {
    for (;;) {
      const registration = generateFrenchPlate(rnd);
      if (!(await db.vehicle.findUnique({ where: { registration }, select: { id: true } }))) return registration;
    }
  }

  // ── Reference data ──────────────────────────────────────────

  async function seedCatalogue() {
    for (const b of BRANDS) {
      const brandId = args.brands.get(b.code)!;
      for (const m of VN_MODELS[b.code]) {
        const model = await db.catalogueModel.create({ data: { brandId, name: m.model } });
        for (const [i, v] of m.versions.entries()) {
          const listExcl = Math.round((v.priceEuros * 100) / 1.2);
          const version = await db.catalogueVersion.create({
            data: {
              modelId: model.id,
              code: versionCode(b.code, m.model, i),
              name: v.name,
              fuel: v.fuel,
              co2: v.co2,
              powerHp: v.hp,
              listPriceExclVatCents: listExcl,
              dealerCostCents: Math.round(listExcl * 0.86),
              oemIncentiveCents: f.helpers.weightedArrayElement([
                { value: 0, weight: 6 },
                { value: 50_000, weight: 2 },
                { value: 100_000, weight: 1 },
                { value: 150_000, weight: 1 },
              ]),
              leadTimeDays: f.number.int({ min: 30, max: 75 }),
            },
          });
          const extras = f.helpers.arrayElements(
            OPTION_TEMPLATES.filter((o) => o.kind !== "PAINT"),
            { min: 2, max: 4 },
          );
          await db.catalogueOption.createMany({
            data: [...OPTION_TEMPLATES.filter((o) => o.kind === "PAINT"), ...extras].map((o) => ({
              versionId: version.id,
              code: o.code,
              label: o.label,
              kind: o.kind,
              listPriceExclVatCents: o.priceEuros * 100,
              dealerCostCents: o.priceEuros * 75,
            })),
          });
        }
      }
    }
  }

  /**
   * The seed's own stock (seed v1) becomes history: vehicles on order get their factory order on the
   * day they were ordered; vehicles that arrived or were bought after the books were opened have
   * their arrival or purchase booked on their stock-in date (the opening balance holds only the
   * cars there before).
   */
  async function scheduleOpeningStock() {
    const leadTime = async (v: { brandId: string | null; model: string; version: string }) =>
      (await db.catalogueVersion.findFirst({ where: { name: v.version, model: { name: v.model, brandId: v.brandId! } } }))?.leadTimeDays ?? 45;

    const onOrder = await db.vehicle.findMany({ where: { stockType: "VN", status: { in: ["ORDERED", "IN_TRANSIT"] } }, orderBy: { vin: "asc" } });
    for (const v of onOrder) {
      const inTransit = v.status === "IN_TRANSIT";
      const expectedOn = addDays(today, inTransit ? f.number.int({ min: 1, max: 10 }) : f.number.int({ min: 8, max: 60 }));
      let orderedOn = addDays(expectedOn, -(await leadTime(v)));
      if (orderedOn.getTime() >= today.getTime()) orderedOn = addDays(today, -f.number.int({ min: 2, max: 6 }));
      if (orderedOn.getTime() < opening.getTime()) orderedOn = opening;
      const shipped = addDays(today, -f.number.int({ min: 1, max: 6 }));
      const shippedOn = inTransit ? (shipped.getTime() < orderedOn.getTime() ? orderedOn : shipped) : null;
      at(orderedOn, async (on) => {
        await run("openingFactoryOrder", SYSTEM_ACTOR, v.siteId, on, (ctx) => registerOpeningFactoryOrder(ctx, v.id, { expectedOn, shippedOn }));
      });
    }

    const arrived = await db.vehicle.findMany({ where: { stockType: "VN", status: "IN_STOCK", stockInDate: { gt: opening } }, orderBy: { vin: "asc" } });
    for (const v of arrived) {
      const arrival = v.stockInDate!;
      let orderedOn = addDays(arrival, -(await leadTime(v)));
      if (orderedOn.getTime() < opening.getTime()) orderedOn = opening;
      let shippedOn = addDays(arrival, -f.number.int({ min: 1, max: 6 }));
      if (shippedOn.getTime() < orderedOn.getTime()) shippedOn = orderedOn;
      replay(arrival, v.siteId!, (ctx) => registerPastArrival(ctx, v.id, { orderedOn, shippedOn }));
    }

    const lessor = voSuppliers.find((s) => s.vatRegime === "STANDARD")!;
    const auction = voSuppliers.find((s) => s.vatRegime === "MARGIN")!;
    const inStock = await db.vehicle.findMany({ where: { stockType: "VO", status: { in: ["INTAKE", "RECONDITIONING", "FOR_SALE"] } }, orderBy: { vin: "asc" } });
    for (const v of inStock) {
      const purchaseDate = v.stockInDate!;
      if (purchaseDate.getTime() > opening.getTime()) {
        // Bought during the history: from the lessor (VAT charged), a private customer or at auction.
        const site = sites.find((s) => s.id === v.siteId)!;
        const seller =
          v.vatRegime === "STANDARD"
            ? { supplierId: lessor.id }
            : f.datatype.boolean(0.75)
              ? { customerId: f.helpers.arrayElement(site.individuals).id }
              : { supplierId: auction.id };
        replay(purchaseDate, v.siteId!, (ctx) => registerPastVoPurchase(ctx, v.id, seller));
        continue;
      }
      // Held when the books were opened: valued in the opening balance, registered without posting.
      const seller =
        v.vatRegime === "STANDARD"
          ? lessor
          : f.datatype.boolean(0.75)
            ? { name: f.person.fullName(), address: `${f.location.streetAddress()}, ${f.location.zipCode()} ${f.location.city()}` }
            : auction;
      at(opening, async (on) => {
        await run("openingVo", SYSTEM_ACTOR, v.siteId, on, (ctx) => registerOpeningVo(ctx, v.id, { sellerName: seller.name, sellerAddress: seller.address, purchaseDate }));
      });
    }
  }

  async function before(openingDate: Date) {
    opening = openingDate;
    current = addDays(opening, -1);
    await seedCatalogue();
    await db.addOnProduct.createMany({
      data: ADD_ONS.map((a) => ({ code: a.code, kind: a.kind, name: a.name, months: a.months, priceExclVatCents: a.priceEuros * 100, costCents: a.costEuros * 100 })),
    });
    for (const a of await db.addOnProduct.findMany()) addOnIds.set(a.code, a.id);
    for (const s of VO_SUPPLIERS) {
      const address = f.location.streetAddress();
      const postalCode = s.city === "Nantes" ? "44300" : "35000";
      const sup = await runCommand({ actor: SYSTEM_ACTOR, siteId: null }, (ctx) =>
        createSupplier(ctx, { name: s.name, paymentTermsDays: 30, address, postalCode, city: s.city }),
      );
      voSuppliers.push({ id: sup.id, name: s.name, address: `${address}, ${postalCode} ${s.city}`, vatRegime: s.vatRegime });
    }
    bodyshopId = (await db.supplier.findFirstOrThrow({ where: { name: "Carrosserie Peinture Atlantique" } })).id;
    dp = await actorFor("dealer.principal@dms.test");
    const versions = await db.catalogueVersion.findMany({ include: { options: true, model: true }, orderBy: { code: "asc" } });
    for (const s of SITES) {
      const id = args.sites.get(s.code)!;
      const brandIds = s.brands.map((c) => args.brands.get(c)!);
      const customers = await db.customer.findMany({
        where: { homeSiteId: id, kind: { in: ["INDIVIDUAL", "COMPANY"] } },
        select: { id: true, kind: true },
        orderBy: { number: "asc" },
      });
      sites.push({
        id,
        brandCodes: [...s.brands],
        brandIds,
        sm: await actorFor(`sales.manager.${s.slug}@dms.test`),
        salespeople: [await actorFor(`salesperson1.${s.slug}@dms.test`), await actorFor(`salesperson2.${s.slug}@dms.test`)],
        individuals: customers.filter((c) => c.kind === "INDIVIDUAL") as Customer[],
        companies: customers.filter((c) => c.kind === "COMPANY") as Customer[],
        versions: versions
          .filter((v) => brandIds.includes(v.model.brandId))
          .map((v) => ({ id: v.id, brandId: v.model.brandId, listPriceExclVatCents: v.listPriceExclVatCents, options: v.options })),
      });
    }
    await scheduleOpeningStock();
  }

  // ── Supply ──────────────────────────────────────────────────

  function pickOptions(options: Version["options"]): string[] {
    const paints = options.filter((o) => o.kind === "PAINT");
    const others = options.filter((o) => o.kind !== "PAINT");
    const ids: string[] = [];
    if (paints.length && f.datatype.boolean(0.6)) ids.push(f.helpers.arrayElement(paints).id);
    ids.push(...f.helpers.arrayElements(others, { min: 0, max: 2 }).map((o) => o.id));
    return ids;
  }

  /** The manufacturer ships a week or so before the expected date; the car arrives on that date. */
  function scheduleArrival(site: SiteState, fo: { id: string; vehicleId: string; expectedOn: Date }, from: Date, then?: (arrived: Date) => void) {
    const ship = addDays(fo.expectedOn, -f.number.int({ min: 7, max: 12 }));
    const shipOn = ship.getTime() <= from.getTime() ? addDays(from, 1) : ship;
    at(shipOn, async (on) => {
      await run("ship", site.sm, site.id, on, (ctx) => shipFactoryOrder(ctx, fo.id));
    });
    at(fo.expectedOn, async (on) => {
      const arrived = await run("receive", site.sm, site.id, on, (ctx) => receiveVehicle(ctx, fo.vehicleId));
      if (arrived && then) then(on);
    });
  }

  async function stockOrder(site: SiteState, brandId: string, day: Date) {
    const version = f.helpers.arrayElement(site.versions.filter((v) => v.brandId === brandId));
    const optionIds = pickOptions(version.options);
    const colour = f.helpers.arrayElement(COLOURS);
    const fo = await run("stockOrder", site.sm, site.id, day, (ctx) => orderForStock(ctx, { siteId: site.id, catalogueVersionId: version.id, optionIds, colour }));
    if (!fo) return;
    stats.stockOrders++;
    scheduleArrival(site, fo, day);
  }

  async function usedCar(site: SiteState, day: Date, minAge: number, maxAge: number) {
    const maker = f.helpers.weightedArrayElement(
      VO_MODELS.map((m) => ({ value: m, weight: m.brandCode && site.brandCodes.includes(m.brandCode) ? 4 : 1 })),
    );
    const m = f.helpers.arrayElement(maker.models);
    const ageYears = f.number.int({ min: minAge, max: maxAge });
    const firstRegistration = addDays(day, -Math.round(ageYears * 365 + f.number.int({ min: 0, max: 300 })));
    const mileage = Math.round((ageYears * f.number.int({ min: 9_000, max: 18_000 })) / 100) * 100;
    return {
      vin: await uniqueVin(maker.wmi),
      registration: await uniquePlate(),
      make: maker.make,
      model: m.model,
      version: m.version,
      firstRegistration,
      mileage,
      fuel: m.fuel as Fuel,
      powerHp: m.hp,
      colour: f.helpers.arrayElement(COLOURS),
      marketCents: marketValueCents(m.newPriceEuros, ageYears, mileage),
    };
  }

  /** Reconditioning a few days after intake, then on sale at a market price. */
  function scheduleReconditioning(site: SiteState, vehicleId: string, marketCents: number, estimatedRepairCents: number, day: Date) {
    const costCents = Math.max(15_000, Math.round((estimatedRepairCents * f.number.float({ min: 0.8, max: 1.3 })) / 5_000) * 5_000);
    const label = f.helpers.arrayElement(["Bodywork and valeting", "Service, tyres and valeting", "Paint touch-ups and valeting", "Brakes, service and valeting"]);
    const reference = `RC-${f.string.numeric(5)}`;
    const listAfter = f.number.int({ min: 4, max: 10 });
    const markUp = f.number.float({ min: 1.04, max: 1.12 });
    at(day, async (on) => {
      const done = await run("recondition", site.sm, site.id, on, async (ctx) => {
        await startReconditioning(ctx, vehicleId);
        await addVehicleCost(ctx, vehicleId, { kind: "RECONDITIONING", label, amountCents: costCents, supplierId: bodyshopId, supplierReference: reference });
        return true;
      });
      if (!done) return;
      at(addDays(on, listAfter), async (listOn) => {
        const v = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
        // At least 15 % over cost (incl. VAT on the whole price for cars sold under the standard regime).
        const floor = v.vatRegime === "STANDARD" ? v.stockValueCents * 1.2 * 1.15 : v.stockValueCents * 1.15;
        const listPriceCents = endsIn90(Math.max(marketCents * markUp, floor));
        await run("setForSale", site.sm, site.id, listOn, (ctx) => setForSale(ctx, vehicleId, { listPriceCents }));
      });
    });
  }

  async function buyVo(site: SiteState, day: Date) {
    const supplier = f.helpers.arrayElement(voSuppliers);
    const car = await usedCar(site, day, 1, 5);
    const priceIncl = round100(car.marketCents * f.number.float({ min: 0.72, max: 0.82 }));
    const priceCents = supplier.vatRegime === "STANDARD" ? round100(priceIncl / 1.2) : priceIncl;
    const reference = `LOT-${f.string.numeric(6)}`;
    const repair = f.number.int({ min: 15_000, max: 80_000 });
    const recondOn = addDays(day, f.number.int({ min: 2, max: 5 }));
    const bought = await run("buyVo", site.sm, site.id, day, (ctx) =>
      purchaseVo(ctx, {
        siteId: site.id,
        source: "PROFESSIONAL",
        supplierId: supplier.id,
        vatRegime: supplier.vatRegime,
        priceCents,
        supplierReference: reference,
        vehicle: {
          vin: car.vin,
          registration: car.registration,
          make: car.make,
          model: car.model,
          version: car.version,
          firstRegistration: isoDate(car.firstRegistration),
          mileage: car.mileage,
          fuel: car.fuel,
          powerHp: car.powerHp,
          colour: car.colour,
        },
      }),
    );
    if (!bought) return;
    stats.voPurchases++;
    scheduleReconditioning(site, bought.vehicle.id, car.marketCents, repair, recondOn);
  }

  // ── Deals ───────────────────────────────────────────────────

  function release(deal: Deal) {
    busy.delete(deal.customer.id);
    if (deal.vehicleId) taken.delete(deal.vehicleId);
  }

  async function loseDeal(deal: Deal, day: Date, reason: string) {
    const lost = await run("lost", deal.salesperson, deal.site.id, day, (ctx) => setLeadStage(ctx, deal.leadId, "LOST", reason));
    if (lost) stats.lost++;
    release(deal);
  }

  function pickCustomer(site: SiteState): Customer | null {
    const pool = f.datatype.boolean(0.12) && site.companies.length ? site.companies : site.individuals;
    for (let i = 0; i < 5; i++) {
      const c = f.helpers.arrayElement(pool);
      if (!busy.has(c.id)) return c;
    }
    return null;
  }

  async function pickStock(site: SiteState, type: "VN" | "VO", day: Date) {
    const rows = await db.vehicle.findMany({
      where:
        type === "VN"
          ? { siteId: site.id, stockType: "VN", status: "IN_STOCK", stockInDate: { lte: day } }
          : { siteId: site.id, stockType: "VO", status: "FOR_SALE", stockInDate: { lte: addDays(day, -5) } },
      select: { id: true, listPriceCents: true },
      orderBy: { vin: "asc" },
    });
    const free = rows.filter((r) => r.listPriceCents && !taken.has(r.id));
    return free.length ? f.helpers.arrayElement(free) : null;
  }

  async function openDeal(site: SiteState, day: Date) {
    const customer = pickCustomer(site);
    if (!customer) return;
    const salesperson = f.helpers.weightedArrayElement([
      { value: site.salespeople[0], weight: 4 },
      { value: site.salespeople[1], weight: 4 },
      { value: site.sm, weight: 1 },
    ]);
    const interest = f.datatype.boolean(0.55) ? "VN" : "VO";
    const source = f.helpers.weightedArrayElement([
      { value: "WALK_IN" as const, weight: 4 },
      { value: "WEB" as const, weight: 3 },
      { value: "PHONE" as const, weight: 2 },
      { value: "RETURNING" as const, weight: 1 },
      { value: "REFERRAL" as const, weight: 1 },
    ]);
    const outcome = f.helpers.weightedArrayElement([
      { value: "WON" as const, weight: 70 },
      { value: "LOST_EARLY" as const, weight: 12 },
      { value: "DECLINED" as const, weight: 12 },
      { value: "EXPIRES" as const, weight: 6 },
    ]);
    const description = interest === "VN" ? f.helpers.arrayElement(["New car, hybrid preferred", "Replacing a company car", "First new car", "Electric car, wants the bonus"]) : f.helpers.arrayElement(["Used car, budget-conscious", "Second family car", "Low mileage used car", "Used SUV"]);
    const contactOn = addDays(day, f.number.int({ min: 1, max: 2 }));
    const lead = await run("lead", salesperson, site.id, day, (ctx) => createLead(ctx, { siteId: site.id, customerId: customer.id, source, interest, description }));
    if (!lead) return;
    stats.leads++;
    busy.add(customer.id);
    const deal: Deal = { site, salesperson, customer, leadId: lead.id, interest, outcome, attempts: 0 };
    at(contactOn, async (on) => {
      await run("contacted", salesperson, site.id, on, (ctx) => setLeadStage(ctx, lead.id, "CONTACTED"));
    });
    if (outcome === "LOST_EARLY") {
      const lostOn = addDays(contactOn, f.number.int({ min: 3, max: 10 }));
      const reason = f.helpers.arrayElement(LOST_REASONS);
      at(lostOn, (on) => loseDeal(deal, on, reason));
    } else {
      const quoteOn = addDays(contactOn, f.number.int({ min: 1, max: 4 }));
      at(quoteOn, (on) => quoteDeal(deal, on));
    }
  }

  /** The customer's car (known, or typed in), offered below its market value; none if worth too much for the deal. */
  async function tradeInFor(deal: Deal, day: Date, maxOfferCents: number): Promise<QuoteInput["tradeIn"]> {
    const own = await db.vehicle.findFirst({ where: { ownerCustomerId: deal.customer.id, status: "CUSTOMER", stockType: "NONE" }, orderBy: { vin: "asc" } });
    let car: UsedCar;
    if (own) {
      const ageYears = own.firstRegistration ? Math.max(0, (day.getTime() - own.firstRegistration.getTime()) / (365 * 86_400_000)) : 5;
      const newPrice = VO_MODELS.find((m) => m.make === own.make)?.models.find((m) => m.model === own.model)?.newPriceEuros ?? 28_000;
      car = { ...own, fuel: own.fuel as Fuel, marketCents: marketValueCents(newPrice, Math.round(ageYears), own.mileage) };
    } else {
      car = await usedCar(deal.site, day, 3, 10);
    }
    const repair = Math.round(f.number.int({ min: 0, max: 150_000 }) / 5_000) * 5_000;
    const offer = round100((car.marketCents - repair) * f.number.float({ min: 0.82, max: 0.92 }));
    if (offer < 100_000 || offer > maxOfferCents) return undefined;
    return {
      vehicleId: own?.id ?? null,
      vin: car.vin,
      registration: car.registration,
      make: car.make,
      model: car.model,
      version: car.version,
      firstRegistration: car.firstRegistration ? isoDate(car.firstRegistration) : null,
      mileage: car.mileage + (own ? f.number.int({ min: 0, max: 800 }) : 0),
      fuel: car.fuel,
      marketValueCents: car.marketCents,
      estimatedRepairCents: repair,
      offerCents: offer,
    };
  }

  async function quoteDeal(deal: Deal, day: Date) {
    const { site } = deal;
    let vehicle: { id: string; listPriceCents: number | null } | null = null;
    let version: Version | null = null;
    if (deal.interest === "VN") {
      const stock = await pickStock(site, "VN", day);
      if (stock && f.datatype.boolean(0.65)) vehicle = stock;
      else version = f.helpers.arrayElement(site.versions);
    } else {
      vehicle = await pickStock(site, "VO", day);
      if (!vehicle) {
        if (deal.attempts++ < 2) {
          const retryOn = addDays(day, f.number.int({ min: 4, max: 8 }));
          at(retryOn, (on) => quoteDeal(deal, on));
        } else {
          await loseDeal(deal, day, "No suitable used car in stock");
        }
        return;
      }
    }
    if (vehicle) {
      taken.add(vehicle.id);
      deal.vehicleId = vehicle.id;
    }
    const optionIds = version ? pickOptions(version.options) : [];
    const listIncl = vehicle
      ? vehicle.listPriceCents!
      : Math.round((version!.listPriceExclVatCents + version!.options.filter((o) => optionIds.includes(o.id)).reduce((t, o) => t + o.listPriceExclVatCents, 0)) * 1.2);
    const [lo, hi] =
      deal.interest === "VN"
        ? f.helpers.weightedArrayElement([
            { value: [0, 3], weight: 60 },
            { value: [3, 4.8], weight: 25 },
            { value: [5.2, 9.8], weight: 12 },
            { value: [10.2, 12], weight: 3 },
          ])
        : f.helpers.weightedArrayElement([
            { value: [0, 2], weight: 85 },
            { value: [2, 4], weight: 15 },
          ]);
    const discount = Math.floor((listIncl * f.number.float({ min: lo, max: hi })) / 100 / 1_000) * 1_000;
    const accessories = f.datatype.boolean(0.3)
      ? f.helpers.arrayElements(ACCESSORIES, { min: 1, max: 2 }).map((a) => ({ label: a.label, priceExclVatCents: a.priceEuros * 100, costCents: a.costEuros * 100 }))
      : [];
    const addOns = f.datatype.boolean(deal.interest === "VN" ? 0.55 : 0.45)
      ? deal.interest === "VN"
        ? f.helpers.arrayElements(["WAR24", "MNT36", "MNT48"], { min: 1, max: 2 }).filter((c, _, all) => !(c === "MNT48" && all.includes("MNT36")))
        : [f.helpers.arrayElement(["WAR24", "WAR36"])]
      : [];
    const tradeIn = f.datatype.boolean(0.35) ? await tradeInFor(deal, day, Math.round((listIncl - discount) * 0.7)) : undefined;
    let financing: QuoteInput["financing"];
    const toFinance = listIncl - discount - ((tradeIn?.offerCents as number | undefined) ?? 0);
    if (f.datatype.boolean(0.45) && toFinance > 1_500_000) {
      const lease = f.datatype.boolean(0.25);
      const principal = round100(toFinance * f.number.float({ min: 0.5, max: 0.85 }));
      financing = {
        kind: lease ? "LEASE" : "LOAN",
        lender: f.helpers.arrayElement(DEFAULT_FINANCING.lenders),
        principalCents: principal,
        months: lease ? f.helpers.arrayElement([36, 48]) : f.helpers.arrayElement([24, 36, 48, 60]),
        residualCents: lease ? round100(principal * f.number.float({ min: 0.35, max: 0.5 })) : 0,
      };
    }
    const reserve = !!vehicle && f.datatype.boolean(0.3);
    const input: QuoteInput = {
      leadId: deal.leadId,
      vehicleId: vehicle?.id ?? null,
      catalogueVersionId: version?.id ?? null,
      optionIds,
      colour: version ? f.helpers.arrayElement(COLOURS) : null,
      accessories,
      addOnIds: addOns.map((c) => addOnIds.get(c)!),
      discountInclVatCents: discount,
      tradeIn,
      financing,
    };
    const quote = await run("quote", deal.salesperson, site.id, day, async (ctx) => submitQuote(ctx, (await createQuote(ctx, input)).id));
    if (!quote) return release(deal);
    stats.quotes++;
    deal.quoteId = quote.id;
    if (reserve) await run("reserve", deal.salesperson, site.id, day, (ctx) => reserveQuoteVehicle(ctx, quote.id));

    let ready = day;
    if (quote.status === "PENDING_APPROVAL") {
      const approver = quote.discountBp > 1000 || deal.salesperson === site.sm ? dp : site.sm;
      ready = addDays(day, f.number.int({ min: 0, max: 1 }));
      const approveOn = ready;
      at(approveOn, async (on) => {
        await run("approve", approver, site.id, on, (ctx) => decideQuoteApproval(ctx, quote.id, "APPROVE", "Agreed"));
      });
    }
    if (deal.outcome === "WON") {
      const acceptOn = addDays(ready, f.number.int({ min: 1, max: 7 }));
      at(acceptOn, (on) => acceptDeal(deal, on));
    } else if (deal.outcome === "DECLINED") {
      const declineOn = addDays(ready, f.number.int({ min: 3, max: 12 }));
      const reason = f.helpers.arrayElement(LOST_REASONS);
      at(declineOn, async (on) => {
        await run("decline", deal.salesperson, site.id, on, (ctx) => declineQuote(ctx, quote.id));
        await loseDeal(deal, on, reason);
      });
    } else {
      const lostOn = addDays(ready, QUOTE_VALIDITY_DAYS + f.number.int({ min: 3, max: 12 }));
      at(lostOn, (on) => loseDeal(deal, on, "No answer after follow-ups"));
    }
  }

  async function acceptDeal(deal: Deal, day: Date) {
    const { site } = deal;
    const order = await run("accept", deal.salesperson, site.id, day, (ctx) => acceptQuote(ctx, deal.quoteId!));
    if (!order) return release(deal);
    stats.orders++;
    deal.orderId = order.id;
    deal.vehicleId = order.vehicleId;
    const quote = await db.quote.findUniqueOrThrow({ where: { id: deal.quoteId }, include: { tradeIn: true } });
    if (quote.balanceDueCents >= 100_000) {
      const deposit = Math.min(quote.balanceDueCents, Math.max(50_000, round100(quote.balanceDueCents * f.number.float({ min: 0.05, max: 0.2 }))));
      const method = f.helpers.weightedArrayElement([
        { value: "CARD" as const, weight: 5 },
        { value: "CHEQUE" as const, weight: 3 },
        { value: "TRANSFER" as const, weight: 2 },
      ]);
      await run("deposit", site.sm, site.id, day, (ctx) => recordOrderPayment(ctx, order.id, { amountCents: deposit, method }));
    }
    // A car from stock may have come through a factory order too: only one still on its way waits.
    const fo = await db.factoryOrder.findUnique({ where: { vehicleId: order.vehicleId } });
    const factory = fo && (fo.status === "ORDERED" || fo.status === "IN_TRANSIT") ? fo : null;
    if (!factory && f.datatype.boolean(0.03)) {
      const cancelOn = addDays(day, f.number.int({ min: 1, max: 2 }));
      at(cancelOn, async (on) => {
        const cancelled = await run("cancel", site.sm, site.id, on, (ctx) => cancelOrder(ctx, order.id, "Customer withdrew within the cooling-off period"));
        if (cancelled) stats.cancelled++;
        release(deal);
      });
      return;
    }
    const t = quote.tradeIn;
    if (t?.vehicleId) scheduleReconditioning(site, t.vehicleId, t.marketValueCents, t.estimatedRepairCents, addDays(day, f.number.int({ min: 3, max: 6 })));
    if (factory) {
      scheduleArrival(site, factory, day, (arrived) => {
        const invoiceOn = addDays(arrived, f.number.int({ min: 1, max: 4 }));
        at(invoiceOn, (on) => invoiceDeal(deal, on));
      });
    } else {
      const invoiceOn = addDays(day, f.number.int({ min: 3, max: 10 }));
      at(invoiceOn, (on) => invoiceDeal(deal, on));
    }
  }

  async function invoiceDeal(deal: Deal, day: Date) {
    const { site } = deal;
    const invoiced = await run("invoice", site.sm, site.id, day, (ctx) => invoiceOrder(ctx, deal.orderId!));
    if (!invoiced) return;
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiced.invoiceId! } });
    const due = invoice.totalInclVatCents - invoice.paidCents;
    const company = deal.customer.kind === "COMPANY";
    const payOn = addDays(day, company ? f.number.int({ min: 3, max: 12 }) : f.number.int({ min: 0, max: 3 }));
    const method = company
      ? ("TRANSFER" as const)
      : f.helpers.weightedArrayElement([
          { value: "TRANSFER" as const, weight: 6 },
          { value: "CHEQUE" as const, weight: 3 },
          { value: "CARD" as const, weight: 1 },
        ]);
    const deliverAfter = f.number.int({ min: 0, max: 3 });
    const extraKm = f.number.int({ min: 3, max: 25 });
    at(payOn, async (on) => {
      if (due > 0 && !(await run("payment", site.sm, site.id, on, (ctx) => recordOrderPayment(ctx, deal.orderId!, { amountCents: due, method })))) return;
      at(addDays(on, deliverAfter), async (deliverOn) => {
        const v = await db.vehicle.findUniqueOrThrow({ where: { id: deal.vehicleId! } });
        const delivered = await run("deliver", deal.salesperson, site.id, deliverOn, (ctx) =>
          deliverOrder(ctx, deal.orderId!, { mileage: v.stockType === "VN" ? v.mileage + extraKm : undefined }),
        );
        if (delivered) stats.delivered++;
        release(deal);
      });
    });
  }

  // ── Day by day ──────────────────────────────────────────────

  async function day(d: Date) {
    current = d;
    // End-of-day job of the previous day: quotes and reservations past their date expire.
    await run("expiry", SYSTEM_ACTOR, null, d, async (ctx) => {
      await expireReservations(ctx, d);
      await expireQuotes(ctx, d);
    });
    inAgenda = true;
    const key = isoDate(d);
    const tasks = agenda.get(key) ?? [];
    for (let i = 0; i < tasks.length; i++) await tasks[i](d);
    agenda.delete(key);
    inAgenda = false;

    const weekday = d.getUTCDay();
    if (weekday === 0) return; // closed on Sundays
    const week = Math.floor((d.getTime() - opening.getTime()) / (7 * 86_400_000));
    for (const site of sites) {
      if (weekday === 1 && week % 2 === 0) for (const brandId of site.brandIds) await stockOrder(site, brandId, d);
      if (weekday === 3 && f.datatype.boolean(0.6)) await buyVo(site, d);
      const leads = f.helpers.weightedArrayElement([
        { value: 0, weight: 6 },
        { value: 1, weight: 3 },
        { value: 2, weight: 1 },
      ]);
      for (let i = 0; i < leads; i++) await openDeal(site, d);
    }
  }

  async function after() {
    current = today;
    for (const task of lateReplays) await task(today);
    await run("expiry", SYSTEM_ACTOR, null, today, async (ctx) => {
      await expireReservations(ctx, today);
      await expireQuotes(ctx, today);
    });
    if (process.env.SEED_PROFILE) {
      console.table(
        [...timings]
          .map(([step, t]) => ({ step, n: t.n, totalMs: Math.round(t.ms), avgMs: Math.round(t.ms / t.n) }))
          .sort((a, b) => b.totalMs - a.totalMs),
      );
    }
  }

  const hooks: HistoryHooks = { before, day, after };
  return { hooks, stats };
}
