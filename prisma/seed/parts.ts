/**
 * Seed — parts (Phase 4). Reference data (discount codes, ~2,000 references, supersessions), the
 * opening stock of each site (valued in the accounting opening entry), then six months of parts
 * activity run day by day inside the accounting history:
 *  - counter sales to retail customers (paid at the counter) and trade customers (on account);
 *  - weekly replenishment from min/max levels: suggested orders sent, received (some lines on
 *    backorder), invoiced by the supplier (a few price variances to approve) and paid when due;
 *  - emergency orders for parts not held, transfers between sites and monthly cycle counts.
 * Commands run as the sites' parts managers (and the accountant for payments), so permissions
 * and approvals are real. A separate Faker instance (seed 4343) keeps the earlier data identical.
 */
import { Faker, base, en, fr } from "@faker-js/faker";
import { loadActor } from "@/lib/actor";
import { runCommand, SYSTEM_ACTOR, type Actor, type ServiceContext } from "@/lib/context";
import { addDays, isoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { ConflictError, DomainError } from "@/lib/errors";
import { recordPayment } from "@/modules/accounting";
import {
  addCounterLine,
  createCounterSale,
  createCycleCount,
  createPurchaseOrder,
  createSuggestedOrders,
  confirmCounterSale,
  decideSupplierInvoice,
  invoiceCounterSale,
  paySupplierInvoice,
  postCycleCount,
  receivePurchaseOrder,
  recordCounts,
  recordSupplierInvoice,
  registerOpeningStock,
  sendPurchaseOrder,
  transferStock,
  type OpeningStockItem,
} from "@/modules/parts";
import type { HistoryHooks } from "./accounting";
import { BRANDS, SITES, VN_MODELS } from "./data";

type Task = (on: Date) => Promise<void>;
type Velocity = "FAST" | "MEDIUM" | "SLOW" | "NONE";

interface FamilyDef {
  family: string;
  aisle: string;
  code: string; // discount code
  unit?: "EA" | "L";
  items: { name: string; min: number; max: number }[]; // retail price range in euros excl. VAT
  /** Weights of FAST / MEDIUM / SLOW / NONE. */
  velocity: [number, number, number, number];
}

const OEM_FAMILIES: FamilyDef[] = [
  {
    family: "BRAKES",
    aisle: "A",
    code: "A",
    velocity: [3, 4, 2, 1],
    items: [
      { name: "Front brake pads", min: 45, max: 95 },
      { name: "Rear brake pads", min: 38, max: 80 },
      { name: "Front brake discs (pair)", min: 90, max: 220 },
      { name: "Rear brake discs (pair)", min: 80, max: 180 },
      { name: "Rear brake drum", min: 60, max: 140 },
      { name: "Brake caliper", min: 120, max: 320 },
      { name: "Brake hose", min: 18, max: 45 },
      { name: "Wear sensor", min: 12, max: 30 },
    ],
  },
  {
    family: "FILTERS",
    aisle: "B",
    code: "A",
    velocity: [5, 3, 1, 1],
    items: [
      { name: "Oil filter", min: 9, max: 22 },
      { name: "Air filter", min: 18, max: 45 },
      { name: "Cabin filter", min: 16, max: 38 },
      { name: "Fuel filter", min: 25, max: 70 },
    ],
  },
  {
    family: "ENGINE",
    aisle: "C",
    code: "C",
    velocity: [1, 3, 4, 2],
    items: [
      { name: "Timing belt kit", min: 160, max: 380 },
      { name: "Water pump", min: 80, max: 210 },
      { name: "Spark plug", min: 9, max: 22 },
      { name: "Glow plug", min: 15, max: 35 },
      { name: "Thermostat", min: 35, max: 95 },
      { name: "Rocker cover gasket", min: 25, max: 60 },
      { name: "Auxiliary belt", min: 25, max: 60 },
      { name: "Injector", min: 280, max: 620 },
      { name: "Engine mount", min: 60, max: 160 },
    ],
  },
  {
    family: "SUSPENSION",
    aisle: "D",
    code: "C",
    velocity: [1, 2, 4, 3],
    items: [
      { name: "Front shock absorber", min: 85, max: 190 },
      { name: "Rear shock absorber", min: 70, max: 160 },
      { name: "Coil spring", min: 50, max: 120 },
      { name: "Anti-roll bar link", min: 18, max: 45 },
      { name: "Lower wishbone", min: 90, max: 230 },
      { name: "Ball joint", min: 30, max: 75 },
      { name: "Wheel bearing kit", min: 60, max: 150 },
    ],
  },
  {
    family: "ELECTRICAL",
    aisle: "E",
    code: "C",
    velocity: [1, 2, 4, 3],
    items: [
      { name: "Alternator", min: 280, max: 520 },
      { name: "Starter motor", min: 230, max: 460 },
      { name: "ABS sensor", min: 45, max: 110 },
      { name: "Lambda sensor", min: 80, max: 190 },
      { name: "Headlamp bulb H7", min: 8, max: 18 },
      { name: "Window regulator", min: 90, max: 210 },
      { name: "Parking sensor", min: 45, max: 95 },
    ],
  },
  {
    family: "BODY",
    aisle: "F",
    code: "D",
    velocity: [0, 1, 4, 5],
    items: [
      { name: "Front bumper", min: 220, max: 520 },
      { name: "Door mirror glass", min: 35, max: 90 },
      { name: "Door handle", min: 30, max: 80 },
      { name: "Headlamp unit", min: 280, max: 780 },
      { name: "Front grille", min: 90, max: 260 },
      { name: "Tailgate strut", min: 25, max: 60 },
    ],
  },
  {
    family: "COOLING",
    aisle: "G",
    code: "C",
    velocity: [0, 2, 4, 4],
    items: [
      { name: "Radiator", min: 160, max: 380 },
      { name: "Coolant hose", min: 22, max: 60 },
      { name: "Expansion tank", min: 40, max: 95 },
      { name: "Air-conditioning condenser", min: 190, max: 420 },
    ],
  },
  {
    family: "EXHAUST",
    aisle: "H",
    code: "C",
    velocity: [0, 1, 3, 6],
    items: [
      { name: "Rear silencer", min: 120, max: 290 },
      { name: "Catalytic converter", min: 450, max: 980 },
      { name: "Particulate filter", min: 650, max: 1_400 },
      { name: "Exhaust gasket", min: 8, max: 20 },
    ],
  },
  {
    family: "WIPERS",
    aisle: "J",
    code: "A",
    velocity: [4, 3, 2, 1],
    items: [
      { name: "Front wiper blade set", min: 25, max: 48 },
      { name: "Rear wiper blade", min: 12, max: 24 },
    ],
  },
  {
    family: "ACCESSORIES",
    aisle: "K",
    code: "E",
    velocity: [1, 2, 3, 4],
    items: [
      { name: "Floor mats (set of 4)", min: 45, max: 110 },
      { name: "Boot liner", min: 50, max: 95 },
      { name: "Roof bars", min: 180, max: 290 },
      { name: "Towbar kit", min: 380, max: 690 },
      { name: "Mud flaps", min: 35, max: 70 },
    ],
  },
];

const AFTERMARKET: FamilyDef[] = [
  {
    family: "FLUIDS",
    aisle: "L",
    code: "B",
    unit: "L",
    velocity: [6, 2, 1, 0],
    items: [
      { name: "Engine oil 5W-30", min: 11, max: 16 },
      { name: "Engine oil 0W-20", min: 13, max: 19 },
      { name: "Engine oil 10W-40", min: 8, max: 12 },
      { name: "Coolant (−35 °C)", min: 5, max: 9 },
      { name: "Brake fluid DOT 4", min: 12, max: 18 },
      { name: "AdBlue", min: 1, max: 3 },
      { name: "Screenwash", min: 2, max: 4 },
    ],
  },
  {
    family: "TYRES",
    aisle: "T",
    code: "B",
    velocity: [2, 3, 3, 2],
    items: [
      { name: "Tyre 195/65 R15", min: 65, max: 110 },
      { name: "Tyre 205/55 R16", min: 75, max: 130 },
      { name: "Tyre 215/60 R17", min: 95, max: 160 },
      { name: "Tyre 225/45 R18", min: 120, max: 210 },
    ],
  },
  {
    family: "BATTERIES",
    aisle: "N",
    code: "B",
    velocity: [2, 3, 2, 1],
    items: [
      { name: "Battery 60 Ah", min: 95, max: 140 },
      { name: "Battery 70 Ah", min: 110, max: 170 },
      { name: "Battery 80 Ah AGM", min: 180, max: 260 },
    ],
  },
  {
    family: "CONSUMABLES",
    aisle: "M",
    code: "B",
    velocity: [3, 3, 2, 2],
    items: [
      { name: "Bulb kit", min: 15, max: 30 },
      { name: "Fuse assortment", min: 8, max: 15 },
      { name: "Trim clip (bag of 10)", min: 6, max: 14 },
      { name: "Universal wiper blade", min: 9, max: 22 },
      { name: "Air-conditioning cleaner", min: 12, max: 22 },
      { name: "Brake cleaner", min: 6, max: 11 },
    ],
  },
];

const DISCOUNT_CODES = [
  { code: "A", label: "Fast-moving service parts", rates: { TRADE: 2_500, INTERNAL: 3_000 } },
  { code: "B", label: "Consumables and tyres", rates: { TRADE: 1_000, INTERNAL: 1_500 } },
  { code: "C", label: "Mechanical parts", rates: { TRADE: 2_000, INTERNAL: 2_500 } },
  { code: "D", label: "Bodywork", rates: { TRADE: 1_500, INTERNAL: 2_000 } },
  { code: "E", label: "Accessories", rates: { TRADE: 1_000, INTERNAL: 1_000 } },
];

const OEM_PARTS_PER_BRAND = 880;
const AFTERMARKET_PARTS = 180;
const SUPERSESSIONS = 40;

export function partsSeeder(args: { today: Date; sites: Map<string, string>; brands: Map<string, string> }) {
  const f = new Faker({ locale: [fr, en, base] });
  f.seed(4343);
  const { today } = args;

  const agenda = new Map<string, Task[]>();
  const stats = { parts: 0, stockItems: 0, counterSales: 0, purchaseOrders: 0, receipts: 0, supplierInvoices: 0, variances: 0, transfers: 0, counts: 0, skipped: 0 };
  const timings = new Map<string, { n: number; ms: number }>();
  const velocity = new Map<string, Velocity>(); // partId → velocity
  const unitOf = new Map<string, string>(); // partId → unit
  const managers = new Map<string, Actor>(); // siteId → parts manager
  let accountant: Actor;
  let advisor: Actor;
  let opening: Date;
  let current: Date;
  let inAgenda = false;
  let supplierRef = 0;

  function at(day: Date, task: Task) {
    const floor = inAgenda ? current : addDays(current, 1);
    const d = day.getTime() < floor.getTime() ? floor : day;
    if (d.getTime() >= today.getTime()) return; // after the seed's business date: left open
    const key = isoDate(d);
    const list = agenda.get(key);
    if (list) list.push(task);
    else agenda.set(key, [task]);
  }

  async function run<T>(step: string, actor: Actor, siteId: string | null, day: Date, fn: (ctx: ServiceContext) => Promise<T>): Promise<T | undefined> {
    const started = performance.now();
    try {
      return await runCommand({ actor, siteId, businessDate: day }, fn);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      stats.skipped++;
      if (process.env.SEED_PROFILE) console.warn(`[seed:parts] ${isoDate(day)} ${step} skipped: ${e.message}`);
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

  const price90 = (euros: number) => Math.max(90, Math.round(euros) * 100 - 10); // €…,90
  const pickVelocity = (w: [number, number, number, number]) =>
    f.helpers.weightedArrayElement<Velocity>(
      (["FAST", "MEDIUM", "SLOW", "NONE"] as const).map((value, i) => ({ value, weight: w[i] })).filter((x) => x.weight > 0),
    );

  // ── Reference data and opening stock (before the opening entry) ───────

  async function seedReference(openingDate: Date) {
    opening = openingDate;
    current = openingDate;
    const codes = new Map<string, string>();
    for (const c of DISCOUNT_CODES) {
      const row = await db.discountCode.create({
        data: { code: c.code, label: c.label, rates: { create: Object.entries(c.rates).map(([priceClass, discountBp]) => ({ priceClass: priceClass as "TRADE" | "INTERNAL", discountBp })) } },
      });
      codes.set(c.code, row.id);
    }
    const aftermarketSupplier = await db.supplier.findFirstOrThrow({ where: { name: "Ouest Pièces Distribution" } });

    // References: OEM parts per brand (numbering in the make's style), then aftermarket.
    const numbers = new Set<string>();
    const unique = (gen: () => string) => {
      for (;;) {
        const n = gen();
        if (!numbers.has(n)) {
          numbers.add(n);
          return n;
        }
      }
    };
    type Draft = { partNumber: string; description: string; family: string; brandId: string | null; supplierId: string; discountCodeId: string; unit: string; retailPriceCents: number; listCostCents: number; velocity: Velocity; aisle: string };
    const drafts: Draft[] = [];
    for (const b of BRANDS) {
      const brand = await db.brand.findUniqueOrThrow({ where: { id: args.brands.get(b.code)! } });
      const models = VN_MODELS[b.code].map((m) => m.model);
      const familyWeights = OEM_FAMILIES.map((fam) => ({ value: fam, weight: fam.items.length }));
      for (let i = 0; i < OEM_PARTS_PER_BRAND; i++) {
        const fam = f.helpers.weightedArrayElement(familyWeights);
        const item = f.helpers.arrayElement(fam.items);
        const model = f.helpers.arrayElement(models);
        const variant = f.helpers.arrayElement(["", "", " — petrol", " — diesel", " — hybrid", " (from 2021)", " (up to 2020)"]);
        const retail = price90(f.number.float({ min: item.min, max: item.max }));
        drafts.push({
          partNumber: unique(() => (b.code === "PEUGEOT" ? `16${f.string.numeric(8)}` : `77${f.string.numeric(8)}`)),
          description: `${item.name} ${model}${variant}`,
          family: fam.family,
          brandId: brand.id,
          supplierId: brand.oemSupplierId!,
          discountCodeId: codes.get(fam.code)!,
          unit: "EA",
          retailPriceCents: retail,
          listCostCents: Math.round(retail * f.number.float({ min: 0.55, max: 0.68 })),
          velocity: pickVelocity(fam.velocity),
          aisle: fam.aisle,
        });
      }
    }
    for (let i = 0; i < AFTERMARKET_PARTS; i++) {
      const fam = f.helpers.weightedArrayElement(AFTERMARKET.map((x) => ({ value: x, weight: x.items.length })));
      const item = f.helpers.arrayElement(fam.items);
      const maker = f.helpers.arrayElement(["Bosch", "Valeo", "Total", "Castrol", "Michelin", "Continental", "Varta", "Osram", "Febi", "Motul"]);
      const retail = fam.unit === "L" ? Math.round(f.number.float({ min: item.min, max: item.max }) * 100) : price90(f.number.float({ min: item.min, max: item.max }));
      drafts.push({
        partNumber: unique(() => `OPD${f.string.numeric(6)}`),
        description: `${item.name} — ${maker}`,
        family: fam.family,
        brandId: null,
        supplierId: aftermarketSupplier.id,
        discountCodeId: codes.get(fam.code)!,
        unit: fam.unit ?? "EA",
        retailPriceCents: retail,
        listCostCents: Math.round(retail * f.number.float({ min: 0.45, max: 0.6 })),
        velocity: pickVelocity(fam.velocity),
        aisle: fam.aisle,
      });
    }
    // Older numbers superseded during the history by a fast or medium mover.
    const successors = f.helpers.arrayElements(
      drafts.filter((d) => d.brandId && (d.velocity === "FAST" || d.velocity === "MEDIUM")),
      SUPERSESSIONS,
    );
    const oldDrafts = successors.map((s) => ({
      ...s,
      partNumber: unique(() => `${s.partNumber.slice(0, 2)}${f.string.numeric(8)}`),
      description: `${s.description} (old ref.)`,
      retailPriceCents: Math.round(s.retailPriceCents * 0.95),
      listCostCents: Math.round(s.listCostCents * 0.95),
      velocity: "SLOW" as Velocity,
    }));
    const all = [...drafts, ...oldDrafts];
    const created = await db.part.createManyAndReturn({
      data: all.map((d) => ({ partNumber: d.partNumber, description: d.description, family: d.family, brandId: d.brandId, supplierId: d.supplierId, discountCodeId: d.discountCodeId, unit: d.unit, retailPriceCents: d.retailPriceCents, listCostCents: d.listCostCents })),
      select: { id: true, partNumber: true },
    });
    const idOf = new Map(created.map((c) => [c.partNumber, c.id]));
    for (const d of all) {
      velocity.set(idOf.get(d.partNumber)!, d.velocity);
      unitOf.set(idOf.get(d.partNumber)!, d.unit);
    }
    await db.partSupersession.createMany({
      data: oldDrafts.map((o, i) => ({
        oldPartId: idOf.get(o.partNumber)!,
        newPartId: idOf.get(successors[i].partNumber)!,
        effectiveOn: addDays(opening, f.number.int({ min: 10, max: 150 })),
      })),
    });
    stats.parts = all.length;

    // Opening stock: each site holds its makes' parts and the aftermarket range.
    const brandIdsBySite = new Map(SITES.map((s) => [args.sites.get(s.code)!, s.brands.map((b) => args.brands.get(b)!)]));
    for (const s of SITES) {
      const siteId = args.sites.get(s.code)!;
      const brandIds = brandIdsBySite.get(siteId)!;
      const bins = new Set<string>();
      const items: OpeningStockItem[] = [];
      for (const d of all) {
        if (d.brandId && !brandIds.includes(d.brandId)) continue;
        const v = d.velocity;
        const old = d.description.endsWith("(old ref.)");
        const dormant = !old && v !== "FAST" && f.datatype.boolean(0.07);
        if (v === "NONE" && !dormant) continue;
        if (v === "SLOW" && !dormant && !old && f.datatype.boolean(0.45)) continue;
        const litre = d.unit === "L";
        let min = 0;
        let max = 0;
        let qty = 0;
        if (dormant) {
          qty = f.number.int({ min: 1, max: 3 });
          max = qty;
        } else if (old) {
          qty = f.number.int({ min: 0, max: 3 });
        } else if (v === "FAST") {
          min = litre ? f.number.int({ min: 20, max: 60 }) : f.number.int({ min: 3, max: 8 });
          max = min * f.number.int({ min: 2, max: 3 });
          qty = f.datatype.boolean(0.15) ? f.number.int({ min: 0, max: min - 1 }) : f.number.int({ min, max });
        } else if (v === "MEDIUM") {
          min = litre ? f.number.int({ min: 10, max: 20 }) : f.number.int({ min: 1, max: 3 });
          max = min + (litre ? 20 : f.number.int({ min: 2, max: 4 }));
          qty = f.number.int({ min: 0, max });
        } else {
          max = f.number.int({ min: 1, max: 2 });
          qty = f.number.int({ min: 1, max });
        }
        let bin: string;
        do bin = `${d.aisle}${String(f.number.int({ min: 1, max: 14 })).padStart(2, "0")}-${f.number.int({ min: 1, max: 6 })}${f.string.alpha({ length: 1, casing: "upper" })}`;
        while (bins.has(bin));
        bins.add(bin);
        const lastMovementOn = dormant ? addDays(today, -f.number.int({ min: 425, max: 610 })) : addDays(opening, -f.number.int({ min: 1, max: 75 }));
        items.push({
          partId: idOf.get(d.partNumber)!,
          qty,
          valueCents: Math.round(qty * d.listCostCents * f.number.float({ min: 0.96, max: 1.04 })),
          bin,
          minQty: min,
          maxQty: max,
          lastMovementOn,
        });
      }
      await runCommand({ actor: SYSTEM_ACTOR, siteId, businessDate: opening }, (ctx) => registerOpeningStock(ctx, { siteId, items }));
      stats.stockItems += items.length;
    }
  }

  // ── History ─────────────────────────────────────────────

  async function before() {
    for (const s of SITES) managers.set(args.sites.get(s.code)!, await actorFor(`parts.manager.${s.slug}@dms.test`));
    accountant = await actorFor("accountant@dms.test");
    advisor = await actorFor("parts.advisor.nantes@dms.test");
  }

  /** The parts a site stocks, weighted by how fast they sell (built once per site). */
  const ranges = new Map<string, { partId: string; partNumber: string; velocity: Velocity }[]>();
  async function sellingRange(siteId: string) {
    let list = ranges.get(siteId);
    if (!list) {
      const rows = await db.stockItem.findMany({ where: { siteId }, select: { partId: true, part: { select: { partNumber: true } } }, orderBy: { part: { partNumber: "asc" } } });
      list = rows.flatMap((r) => {
        const v = velocity.get(r.partId) ?? "SLOW";
        const item = { partId: r.partId, partNumber: r.part.partNumber, velocity: v };
        return v === "FAST" ? [item, item, item, item, item, item] : v === "MEDIUM" ? [item, item] : v === "SLOW" ? [item] : [];
      });
      ranges.set(siteId, list);
    }
    return list;
  }

  async function counterSale(siteId: string, day: Date, customers: { id: string; kind: string }[]) {
    const customer = f.helpers.arrayElement(customers);
    const actor = siteId === args.sites.get("NTE") && f.datatype.boolean(0.6) ? advisor : managers.get(siteId)!;
    const lineCount = f.helpers.weightedArrayElement([
      { value: 1, weight: 5 },
      { value: 2, weight: 3 },
      { value: 3, weight: 1 },
    ]);
    const outcome = f.helpers.weightedArrayElement([
      { value: "INVOICE", weight: 90 },
      { value: "CONFIRM", weight: 4 },
      { value: "QUOTE", weight: 6 },
    ]);
    const method = f.helpers.weightedArrayElement([
      { value: "CARD", weight: 7 },
      { value: "CASH", weight: 2 },
      { value: "CHEQUE", weight: 1 },
    ]);
    const picks = Array.from({ length: lineCount }, () => ({ r: f.number.float({ min: 0, max: 1 }), q: f.number.int({ min: 1, max: 4 }) }));
    const range = await sellingRange(siteId);
    if (!range.length) return;
    const chosen = [...new Map(picks.map((p) => [range[Math.floor(p.r * range.length)].partId, { ...range[Math.floor(p.r * range.length)], q: p.q }])).values()];
    const result = await run("counter", actor, siteId, day, async (ctx) => {
      const stock = await ctx.tx.stockItem.findMany({ where: { siteId, partId: { in: chosen.map((c) => c.partId) } }, select: { partId: true, qtyOnHand: true, qtyReserved: true } });
      const lines = chosen
        .map((c) => {
          const item = stock.find((s) => s.partId === c.partId);
          const available = item ? Number(item.qtyOnHand) - Number(item.qtyReserved) : 0;
          const wanted = unitOf.get(c.partId) === "L" ? c.q + 1 : c.velocity === "FAST" ? c.q : 1;
          return { partNumber: c.partNumber, qty: Math.min(Math.floor(available), wanted) };
        })
        .filter((l) => l.qty > 0);
      if (!lines.length) return null; // nothing on the shelf: the customer leaves
      const sale = await createCounterSale(ctx, { siteId, customerId: customer.id });
      for (const l of lines) await addCounterLine(ctx, sale.id, { partNumber: l.partNumber, qty: String(l.qty) });
      if (outcome === "QUOTE" && day.getTime() > addDays(today, -21).getTime()) return { sale, invoice: null };
      if (outcome === "CONFIRM" && day.getTime() > addDays(today, -7).getTime()) {
        await confirmCounterSale(ctx, sale.id);
        return { sale, invoice: null };
      }
      const onAccount = customer.kind === "COMPANY";
      const invoiced = await invoiceCounterSale(ctx, sale.id, { paymentMethod: onAccount ? "ACCOUNT" : method });
      return { sale, invoice: onAccount ? invoiced : null };
    });
    if (!result) return;
    stats.counterSales++;
    // Trade customers pay their account by transfer around the due date (most of them).
    const inv = result.invoice?.invoiceId ? await db.invoice.findUnique({ where: { id: result.invoice.invoiceId } }) : null;
    if (inv?.dueDate && f.datatype.boolean(0.85)) {
      at(addDays(inv.dueDate, f.number.int({ min: -3, max: 6 })), async (on) => {
        await run("customer-payment", accountant, siteId, on, (ctx) =>
          recordPayment(ctx, { siteId, method: "TRANSFER", customerId: inv.customerId, amountCents: inv.totalInclVatCents, allocations: [{ invoiceId: inv.id, amountCents: inv.totalInclVatCents }] }),
        );
      });
    }
  }

  /** Receive an order: everything outstanding, or with some lines short (sent on a later delivery). */
  async function receive(siteId: string, poId: string, on: Date, allowShort: boolean) {
    const lines = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: poId }, orderBy: { lineNo: "asc" } });
    let short = false;
    const qtys = lines
      .map((l) => {
        const left = Number(l.qtyOrdered) - Number(l.qtyReceived);
        if (left <= 0) return null;
        if (allowShort && left >= 2 && f.datatype.boolean(0.08)) {
          short = true;
          return { poLineId: l.id, qty: String(Math.floor(left / 2)) };
        }
        return { poLineId: l.id, qty: String(left) };
      })
      .filter((x) => x !== null);
    const receipt = await run("receipt", managers.get(siteId)!, siteId, on, (ctx) =>
      receivePurchaseOrder(ctx, poId, { deliveryNote: `BL${f.string.numeric(7)}`, lines: qtys }),
    );
    if (!receipt) return;
    stats.receipts++;
    if (short) at(addDays(on, f.number.int({ min: 4, max: 8 })), (d) => receive(siteId, poId, d, false));
    at(addDays(on, f.number.int({ min: 2, max: 8 })), (d) => invoiceReceipt(siteId, receipt.id, d));
  }

  /** The supplier's invoice for one receipt: mostly at the receipt prices, sometimes not. */
  async function invoiceReceipt(siteId: string, receiptId: string, on: Date) {
    const receipt = await db.goodsReceipt.findUnique({ where: { id: receiptId }, include: { lines: true } });
    if (!receipt) return;
    const pricing = f.helpers.weightedArrayElement([
      { value: "EXACT", weight: 88 },
      { value: "SMALL", weight: 8 },
      { value: "LARGE", weight: 4 },
    ]);
    const bumped = f.number.int({ min: 0, max: receipt.lines.length - 1 });
    const lines = receipt.lines
      .map((l, i) => {
        const left = Number(l.qty) - Number(l.qtyInvoiced);
        if (left <= 0) return null;
        const factor = i !== bumped ? 1 : pricing === "SMALL" ? 1.004 : pricing === "LARGE" ? f.number.float({ min: 1.12, max: 1.25 }) : 1;
        return { receiptLineId: l.id, qty: String(left), unitCostCents: ((l.unitCostCents * factor) / 100).toFixed(2) };
      })
      .filter((x) => x !== null);
    if (!lines.length) return;
    const pm = managers.get(siteId)!;
    const inv = await run("supplier-invoice", pm, siteId, on, (ctx) =>
      recordSupplierInvoice(ctx, { siteId, supplierId: receipt.supplierId, supplierReference: `F${String(++supplierRef).padStart(6, "0")}`, invoiceDate: isoDate(on), lines: lines as never }),
    );
    if (!inv) return;
    stats.supplierInvoices++;
    const pay = (id: string, due: Date) => {
      if (!f.datatype.boolean(0.9)) return; // a few stay due for the demo
      at(due, async (d) => {
        await run("supplier-payment", accountant, siteId, d, (ctx) => paySupplierInvoice(ctx, id, { method: "TRANSFER" }));
      });
    };
    if (inv.status === "MATCHED") return pay(inv.id, inv.dueDate);
    stats.variances++;
    const approve = f.datatype.boolean(0.75);
    at(addDays(on, f.number.int({ min: 1, max: 4 })), async (d) => {
      const decided = await run("variance", pm, siteId, d, (ctx) =>
        decideSupplierInvoice(ctx, inv.id, approve ? "APPROVE" : "REJECT", approve ? "Price increase confirmed by the supplier" : "Price not agreed: credit note requested"),
      );
      if (!decided) return;
      if (approve) pay(inv.id, inv.dueDate);
      // Rejected: the supplier sends a corrected invoice a few days later.
      else at(addDays(d, f.number.int({ min: 3, max: 7 })), async (d2) => {
        const fixed = await run("supplier-invoice", pm, siteId, d2, async (ctx) => {
          const open = await ctx.tx.goodsReceiptLine.findMany({ where: { receiptId } });
          return recordSupplierInvoice(ctx, {
            siteId,
            supplierId: receipt.supplierId,
            supplierReference: `F${String(++supplierRef).padStart(6, "0")}`,
            invoiceDate: isoDate(d2),
            notes: "Corrected invoice",
            lines: open.filter((l) => Number(l.qty) > Number(l.qtyInvoiced)).map((l) => ({ receiptLineId: l.id, qty: String(Number(l.qty) - Number(l.qtyInvoiced)) })),
          });
        });
        if (fixed) {
          stats.supplierInvoices++;
          pay(fixed.id, fixed.dueDate);
        }
      });
    });
  }

  async function replenish(siteId: string, day: Date) {
    const pm = managers.get(siteId)!;
    const orders = await run("replenish", pm, siteId, day, async (ctx) => {
      // A week with nothing below its minimum is normal: no order then.
      const drafts = await createSuggestedOrders(ctx, { siteId }).catch((e) => {
        if (e instanceof ConflictError) return [];
        throw e;
      });
      const sent = [];
      for (const po of drafts) sent.push(await sendPurchaseOrder(ctx, po.id));
      return sent;
    });
    for (const po of orders ?? []) {
      stats.purchaseOrders++;
      if (day.getTime() >= addDays(today, -6).getTime()) continue; // this week's orders are still on the way
      at(addDays(po.expectedOn ?? day, f.datatype.boolean(0.1) ? 1 : 0), (d) => receive(siteId, po.id, d, true));
    }
  }

  /** A part the site does not hold, ordered for a customer and delivered the next day. */
  async function emergencyOrder(siteId: string, day: Date, brandIds: string[]) {
    const part = await db.part.findFirst({
      where: { brandId: { in: brandIds }, stock: { none: { siteId } }, replacedBy: null },
      skip: f.number.int({ min: 0, max: 300 }),
      orderBy: { partNumber: "asc" },
    });
    if (!part) return;
    const po = await run("emergency", managers.get(siteId)!, siteId, day, async (ctx) => {
      const created = await createPurchaseOrder(ctx, { siteId, supplierId: part.supplierId, kind: "EMERGENCY", notes: "Customer order", lines: [{ partNumber: part.partNumber, qty: "1" }] });
      return sendPurchaseOrder(ctx, created.id);
    });
    if (!po) return;
    stats.purchaseOrders++;
    at(po.expectedOn ?? addDays(day, 1), (d) => receive(siteId, po.id, d, false));
  }

  /** Move a few units to a site that is short, from one that has more than its maximum. */
  async function transfer(fromSiteId: string, toSiteId: string, day: Date) {
    const rows = await db.$queryRaw<{ partNumber: string; qty: number }[]>`
      SELECT p."partNumber", LEAST(t."minQty" - (t."qtyOnHand" - t."qtyReserved"), (s."qtyOnHand" - s."qtyReserved") - s."minQty")::int AS qty
      FROM stock_item t
      JOIN stock_item s ON s."partId" = t."partId" AND s."siteId" = ${fromSiteId}
      JOIN part p ON p.id = t."partId"
      WHERE t."siteId" = ${toSiteId} AND t."minQty" > 0 AND t."qtyOnHand" - t."qtyReserved" < t."minQty"
        AND s."qtyOnHand" - s."qtyReserved" - s."minQty" >= 1 AND p.unit = 'EA'
      ORDER BY p."partNumber" LIMIT 3`;
    const lines = rows.filter((r) => r.qty >= 1).map((r) => ({ partNumber: r.partNumber, qty: String(r.qty) }));
    if (!lines.length) return;
    const done = await run("transfer", managers.get(fromSiteId)!, fromSiteId, day, (ctx) => transferStock(ctx, { fromSiteId, toSiteId, notes: "Rebalancing between sites", lines }));
    if (done) stats.transfers++;
  }

  async function cycleCount(siteId: string, day: Date, aisle: string, post: boolean) {
    const pm = managers.get(siteId)!;
    const diffs = Array.from({ length: 30 }, () => ({ off: f.datatype.boolean(0.12), up: f.datatype.boolean(0.35) }));
    const done = await run("count", pm, siteId, day, async (ctx) => {
      const count = await createCycleCount(ctx, { siteId, label: `Monthly count ${isoDate(day).slice(0, 7)} — aisle ${aisle}`, binPrefix: aisle, limit: 25 });
      if (!post) return count;
      const lines = await ctx.tx.cycleCountLine.findMany({ where: { countId: count.id }, include: { stockItem: { select: { partId: true } } }, orderBy: { id: "asc" } });
      await recordCounts(ctx, count.id, {
        lines: lines.map((l, i) => {
          const expected = Number(l.expectedQty);
          const d = diffs[i % diffs.length];
          const step = unitOf.get(l.stockItem.partId) === "L" ? 0.5 : 1;
          const counted = d.off ? Math.max(0, expected + (d.up ? step : -step)) : expected;
          return { lineId: l.id, countedQty: String(counted) };
        }),
      });
      return postCycleCount(ctx, count.id);
    });
    if (done) stats.counts++;
  }

  const AISLES = ["A", "B", "C", "D", "E", "J", "K", "L", "M", "N", "T"];

  async function day(d: Date) {
    current = d;
    inAgenda = true;
    const key = isoDate(d);
    const tasks = agenda.get(key) ?? [];
    for (let i = 0; i < tasks.length; i++) await tasks[i](d);
    agenda.delete(key);
    inAgenda = false;

    const weekday = d.getUTCDay();
    if (weekday === 0) return; // closed on Sundays
    const week = Math.floor((d.getTime() - opening.getTime()) / (7 * 86_400_000));
    const month = d.getUTCMonth();
    for (const s of SITES) {
      const siteId = args.sites.get(s.code)!;
      const customers = await counterCustomers(siteId);
      const sales = f.helpers.weightedArrayElement([
        { value: 0, weight: weekday === 6 ? 4 : 2 },
        { value: 1, weight: 4 },
        { value: 2, weight: 3 },
        { value: 3, weight: 1 },
      ]);
      for (let i = 0; i < sales; i++) await counterSale(siteId, d, customers);
      if (weekday === 1) await replenish(siteId, d);
      if (weekday !== 6 && f.datatype.boolean(0.08)) await emergencyOrder(siteId, d, s.brands.map((b) => args.brands.get(b)!));
      // Monthly cycle count on the first Tuesday; this month's is left open to finish.
      if (weekday === 2 && d.getUTCDate() <= 7) {
        const aisle = AISLES[(month + SITES.indexOf(s) * 3) % AISLES.length];
        await cycleCount(siteId, d, aisle, d.getUTCMonth() !== today.getUTCMonth() || d.getUTCFullYear() !== today.getUTCFullYear());
      }
    }
    if (weekday === 4 && week % 2 === 1) {
      const [nte, ren, ang] = SITES.map((s) => args.sites.get(s.code)!);
      await transfer(nte, ren, d);
      await transfer(nte, ang, d);
      await transfer(ren, nte, d);
      await transfer(ang, nte, d);
    }
  }

  const customerCache = new Map<string, { id: string; kind: string }[]>();
  async function counterCustomers(siteId: string) {
    let list = customerCache.get(siteId);
    if (!list) {
      list = await db.customer.findMany({ where: { homeSiteId: siteId, kind: { in: ["INDIVIDUAL", "COMPANY"] } }, select: { id: true, kind: true }, orderBy: { number: "asc" } });
      // Retail walk-ins outnumber trade accounts at the counter.
      list = [...list.filter((c) => c.kind === "INDIVIDUAL"), ...list.filter((c) => c.kind === "COMPANY")];
      customerCache.set(siteId, list);
    }
    return list;
  }

  async function after() {
    if (process.env.SEED_PROFILE) {
      console.table(
        [...timings]
          .map(([step, t]) => ({ step, n: t.n, totalMs: Math.round(t.ms), avgMs: Math.round(t.ms / t.n) }))
          .sort((a, b) => b.totalMs - a.totalMs),
      );
    }
  }

  const hooks: HistoryHooks = { opening: seedReference, before, day, after };
  return { hooks, stats };
}
