/**
 * Seed — workshop (Phase 5). Reference data (labour catalogue, bays, technicians and their capacity,
 * labour rate settings), then six months of after-sales run day by day inside the accounting history:
 *  - customer repair orders: appointment, check-in, jobs from the catalogue with parts issued from
 *    the site's stock, technicians clocking on and off, additional work approved or declined,
 *    quality check, invoice per payer (customer, insurer, OEM warranty), payment and hand-over;
 *  - warranty claims decided every Monday and paid by the manufacturers mid-month;
 *  - internal repair orders on used cars in stock, added to their stock value;
 *  - the last days are left in progress, and appointments are booked for the coming weeks.
 * Commands run as the sites' service advisors and managers. A separate Faker instance (seed 4444)
 * keeps the earlier data identical.
 */
import { Faker, base, en, fr } from "@faker-js/faker";
import type { CustomerKind } from "@prisma/client";
import { loadActor } from "@/lib/actor";
import { runCommand, type Actor, type ServiceContext } from "@/lib/context";
import { addDays, isoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { recordPayment } from "@/modules/accounting";
import {
  addJob,
  addLabourLine,
  addPartLine,
  addSubletLine,
  bookAppointment,
  checkIn,
  clockOff,
  clockOn,
  closeRepairOrder,
  completeJob,
  decideJob,
  decideWarrantyClaim,
  invoiceRepairOrder,
  qualityCheck,
  recordWarrantyRemittance,
  type JobPayer,
} from "@/modules/workshop";
import type { HistoryHooks } from "./accounting";
import { BRANDS, SITES } from "./data";

const OPERATIONS = [
  { code: "OIL-SVC", label: "Oil and filter change", category: "SERVICE", hours: 0.8 },
  { code: "SVC-MAJOR", label: "Major service (filters, plugs, checks)", category: "SERVICE", hours: 2.0 },
  { code: "INSPECTION", label: "Safety and pre-sale inspection", category: "SERVICE", hours: 1.0 },
  { code: "DIAG", label: "Electronic diagnosis", category: "SERVICE", hours: 0.5 },
  { code: "AC-RECHARGE", label: "Air-conditioning recharge and cleaning", category: "SERVICE", hours: 0.8 },
  { code: "BRK-PADS-F", label: "Replace front brake pads", category: "BRAKES", hours: 1.0 },
  { code: "BRK-PADS-R", label: "Replace rear brake pads", category: "BRAKES", hours: 1.0 },
  { code: "BRK-DISCS-F", label: "Replace front discs and pads", category: "BRAKES", hours: 1.6 },
  { code: "BRAKE-FLUID", label: "Brake fluid change", category: "BRAKES", hours: 0.6 },
  { code: "TIMING-BELT", label: "Timing belt and water pump", category: "ENGINE", hours: 3.5 },
  { code: "SPARK-PLUGS", label: "Replace spark plugs", category: "ENGINE", hours: 0.7 },
  { code: "AUX-BELT", label: "Replace auxiliary belt", category: "ENGINE", hours: 0.8 },
  { code: "INJECTOR", label: "Replace injector", category: "ENGINE", hours: 1.5 },
  { code: "TYRES-2", label: "Fit and balance two tyres", category: "TYRES", hours: 0.6 },
  { code: "ALIGNMENT", label: "Wheel alignment", category: "TYRES", hours: 0.8 },
  { code: "SHOCKS-F", label: "Replace front shock absorbers", category: "SUSPENSION", hours: 1.8 },
  { code: "ARB-LINKS", label: "Replace anti-roll bar links", category: "SUSPENSION", hours: 0.6 },
  { code: "BATTERY", label: "Replace battery and reset", category: "ELECTRICAL", hours: 0.4 },
  { code: "BULB", label: "Replace bulb", category: "ELECTRICAL", hours: 0.2 },
  { code: "ALTERNATOR", label: "Replace alternator", category: "ELECTRICAL", hours: 1.8 },
  { code: "STARTER", label: "Replace starter motor", category: "ELECTRICAL", hours: 1.6 },
  { code: "WINDOW-REG", label: "Replace window regulator", category: "ELECTRICAL", hours: 1.2 },
  { code: "ABS-SENSOR", label: "Replace ABS sensor", category: "ELECTRICAL", hours: 0.8 },
  { code: "LAMBDA", label: "Replace lambda sensor", category: "ENGINE", hours: 0.7 },
  { code: "WIPERS", label: "Replace wiper blades", category: "BODY", hours: 0.2 },
  { code: "P-SW-UPDATE", label: "Peugeot ECU software update", category: "SERVICE", hours: 0.5, brand: "PEUGEOT" },
  { code: "R-SW-UPDATE", label: "Renault ECU software update", category: "SERVICE", hours: 0.5, brand: "RENAULT" },
] as const;

type PartWant = { name: string; qty: number };
type Template = { description: string; op: string; parts: PartWant[]; weight: number };

/** Customer work, weighted by how often it comes in. Part names match the parts seed's items. */
const JOBS: Template[] = [
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
const WARRANTY_JOBS: Template[] = [
  { description: "Alternator failure (warranty)", op: "ALTERNATOR", parts: [{ name: "Alternator", qty: 1 }], weight: 2 },
  { description: "Window regulator broken (warranty)", op: "WINDOW-REG", parts: [{ name: "Window regulator", qty: 1 }], weight: 3 },
  { description: "ABS warning light (warranty)", op: "ABS-SENSOR", parts: [{ name: "ABS sensor", qty: 1 }], weight: 3 },
  { description: "Rough idle (warranty)", op: "INJECTOR", parts: [{ name: "Injector", qty: 1 }], weight: 1 },
  { description: "Emissions fault (warranty)", op: "LAMBDA", parts: [{ name: "Lambda sensor", qty: 1 }], weight: 2 },
  { description: "Starter motor failure (warranty)", op: "STARTER", parts: [{ name: "Starter motor", qty: 1 }], weight: 1 },
];

/** What reconditioning does to a used car before it goes on sale. */
const RECONDITIONING: Template[] = [
  { description: "Service before sale", op: "OIL-SVC", parts: [{ name: "Oil filter", qty: 1 }, { name: "Engine oil 5W-30", qty: 4.5 }], weight: 6 },
  { description: "Front brakes", op: "BRK-PADS-F", parts: [{ name: "Front brake pads", qty: 1 }], weight: 3 },
  { description: "Two tyres", op: "TYRES-2", parts: [{ name: "Tyre 205/55 R16", qty: 2 }], weight: 3 },
  { description: "Wiper blades", op: "WIPERS", parts: [{ name: "Front wiper blade set", qty: 1 }], weight: 2 },
  { description: "Battery", op: "BATTERY", parts: [{ name: "Battery 70 Ah", qty: 1 }], weight: 1 },
];

const CENTI = (h: number) => Math.round(h * 100);
const DAY_START = 8 * 60;
const DAY_END = 18 * 60;

type CarRow = { id: string; ownerId: string; ownerKind: CustomerKind; brandId: string | null; firstRegistration: Date | null };

export function workshopSeeder(args: { today: Date; sites: Map<string, string>; brands: Map<string, string> }) {
  const f = new Faker({ locale: [fr, en, base] });
  f.seed(4444);
  const { today } = args;
  const stats = { repairOrders: 0, internal: 0, warrantyClaims: 0, appointments: 0, clockings: 0, skipped: 0 };
  const timings = new Map<string, { n: number; ms: number }>();
  const advisors = new Map<string, Actor>();
  const managers = new Map<string, Actor>();
  const technicians = new Map<string, string[]>(); // siteId → userIds
  const cars = new Map<string, CarRow[]>(); // siteId → customers' cars
  const insurers: string[] = [];
  const subletSuppliers: string[] = [];
  let accountant: Actor;
  /** Company invoices to collect on their due date. */
  const receivables: { siteId: string; customerId: string; invoiceId: string; due: Date }[] = [];

  async function run<T>(step: string, actor: Actor, siteId: string, day: Date, fn: (ctx: ServiceContext) => Promise<T>): Promise<T | undefined> {
    const started = performance.now();
    try {
      return await runCommand({ actor, siteId, businessDate: day }, fn);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      stats.skipped++;
      if (process.env.SEED_PROFILE) console.warn(`[seed:workshop] ${isoDate(day)} ${step} skipped: ${e.message}`);
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

  const pick = <T extends { weight: number }>(list: T[]) => f.helpers.weightedArrayElement(list.map((value) => ({ value, weight: value.weight })));

  // ── Reference data ────────────────────────────────────────

  async function reference() {
    for (const op of OPERATIONS) {
      await db.labourOperation.create({
        data: { code: op.code, label: op.label, category: op.category, standardCentiHours: CENTI(op.hours), brandId: "brand" in op ? args.brands.get(op.brand)! : null },
      });
    }
    await db.setting.createMany({
      data: [
        { key: "workshop.warrantyRateCents", siteId: null, value: { default: 8000, PEUGEOT: 8000, RENAULT: 7800 } },
        { key: "workshop.internalRateCents", siteId: null, value: 6000 },
      ],
    });
    for (const s of SITES) {
      const siteId = args.sites.get(s.code)!;
      await db.workshopBay.createMany({ data: ["Bay 1", "Bay 2", "Bay 3", "Express"].map((name) => ({ siteId, name })) });
      const techs = await db.user.findMany({ where: { email: { startsWith: "technician" }, roles: { some: { siteId } } }, orderBy: { email: "asc" } });
      for (const u of techs) await db.technician.create({ data: { userId: u.id, siteId, dailyCapacityCentiHours: 780 } });
      technicians.set(siteId, techs.map((u) => u.id));
      advisors.set(siteId, await actorFor(`service.advisor.${s.slug}@dms.test`));
      managers.set(siteId, await actorFor(`service.manager.${s.slug}@dms.test`));
      const rows = await db.vehicle.findMany({
        where: { stockType: "NONE", owner: { homeSiteId: siteId, kind: { in: ["INDIVIDUAL", "COMPANY"] } } },
        select: { id: true, brandId: true, firstRegistration: true, owner: { select: { id: true, kind: true } } },
        orderBy: { vin: "asc" },
      });
      cars.set(siteId, rows.map((r) => ({ id: r.id, ownerId: r.owner!.id, ownerKind: r.owner!.kind, brandId: r.brandId, firstRegistration: r.firstRegistration })));
    }
    insurers.push(...(await db.customer.findMany({ where: { kind: "COMPANY" }, select: { id: true }, orderBy: { number: "asc" }, take: 3 })).map((c) => c.id));
    subletSuppliers.push(...(await db.supplier.findMany({ where: { name: { startsWith: "Carrosserie" } }, select: { id: true } })).map((s) => s.id));
    accountant = await actorFor("accountant@dms.test");
  }

  /** A part to fit: the car's make first (its model if possible), else an aftermarket reference, with stock on the shelf. */
  async function findPart(ctx: ServiceContext, siteId: string, want: PartWant, brandId: string | null) {
    const rows = await ctx.tx.stockItem.findMany({
      where: { siteId, qtyOnHand: { gt: 0 }, part: { active: true, description: { startsWith: want.name }, OR: [{ brandId }, { brandId: null }] } },
      select: { qtyOnHand: true, qtyReserved: true, part: { select: { partNumber: true, brandId: true, unit: true } } },
      orderBy: { qtyOnHand: "desc" },
      take: 5,
    });
    const free = rows.filter((r) => Number(r.qtyOnHand) - Number(r.qtyReserved) >= want.qty);
    const best = free.find((r) => r.part.brandId === brandId) ?? free[0];
    return best ? { partNumber: best.part.partNumber, qty: best.part.unit === "EA" ? Math.ceil(want.qty) : want.qty } : null;
  }

  async function fillJob(ctx: ServiceContext, roId: string, jobId: string, siteId: string, tpl: Template, brandId: string | null) {
    await addLabourLine(ctx, roId, jobId, { operationCode: tpl.op });
    for (const want of tpl.parts) {
      const part = await findPart(ctx, siteId, want, brandId);
      if (part) await addPartLine(ctx, roId, jobId, { partNumber: part.partNumber, qty: String(part.qty) });
    }
  }

  /** Each technician's next free minute today. */
  type Day = Map<string, number>;

  /** Clock a job: the technician works the standard time give or take their pace. */
  async function clockJob(ctx: ServiceContext, jobId: string, techId: string, billed: number, cursor: Day) {
    const start = cursor.get(techId) ?? DAY_START;
    if (start >= DAY_END - 30) return;
    const pace = f.number.float({ min: 0.75, max: 1.35 });
    const minutes = Math.max(10, Math.round((billed * 60 * pace) / 100));
    const end = Math.min(DAY_END, start + minutes);
    await clockOn(ctx, { jobId, technicianId: techId, time: start });
    await clockOff(ctx, { technicianId: techId, time: end });
    stats.clockings++;
    cursor.set(techId, end + f.number.int({ min: 5, max: 25 }));
  }

  type Stage = "CHECKED_IN" | "IN_PROGRESS" | "QUALITY_CHECK" | "READY" | "DONE";

  /** One customer visit, from the appointment to the hand-over (or stopped at `stage`). */
  async function customerVisit(siteId: string, day: Date, cursor: Day, stage: Stage = "DONE") {
    const site = SITES.find((s) => args.sites.get(s.code) === siteId)!;
    const car = f.helpers.arrayElement(cars.get(siteId)!);
    const techs = technicians.get(siteId)!;
    const tech = f.helpers.arrayElement(techs);
    const main = pick(JOBS);
    const underWarranty =
      !!car.brandId && !!car.firstRegistration && car.firstRegistration.getTime() > addDays(day, -3 * 365).getTime() && site.brands.some((b) => args.brands.get(b) === car.brandId) && f.datatype.boolean(0.6);
    const warranty = underWarranty ? pick(WARRANTY_JOBS) : null;
    const extra = f.datatype.boolean(0.15) ? pick(JOBS.filter((j) => j !== main)) : null;
    const extraApproved = f.datatype.boolean(0.8);
    const insured = f.datatype.boolean(0.03) && insurers.length && subletSuppliers.length;
    const booked = f.datatype.boolean(0.7);
    const startMinute = Math.min(DAY_END - 60, cursor.get(tech) ?? DAY_START);
    const km = f.number.int({ min: 400, max: 18_000 });
    const fuel = f.helpers.arrayElement([0, 25, 50, 75, 100]);
    const method = f.helpers.weightedArrayElement([
      { value: "CARD" as const, weight: 7 },
      { value: "CHEQUE" as const, weight: 1 },
      { value: "CASH" as const, weight: 1 },
      { value: "TRANSFER" as const, weight: 1 },
    ]);
    const paysNow = f.datatype.boolean(0.97);
    const subletCost = f.number.int({ min: 220, max: 480 }) * 100;

    // The advisor books the car in (when the customer phoned ahead) and checks it in.
    const opened = await run("check-in", advisors.get(siteId)!, siteId, day, async (ctx) => {
      const v = await ctx.tx.vehicle.findUniqueOrThrow({ where: { id: car.id }, include: { owner: { select: { displayName: true } } } });
      let appointmentId: string | undefined;
      if (booked) {
        const planned = OPERATIONS.find((o) => o.code === main.op)!.hours + (warranty ? 1 : 0);
        const appt = await bookAppointment(ctx, {
          siteId,
          customerId: car.ownerId,
          vehicleId: car.id,
          technicianId: tech,
          date: isoDate(day),
          startMinute,
          plannedCentiHours: CENTI(Math.max(0.5, planned)),
          concern: main.description,
        }).catch(async (e) => {
          if (!(e instanceof DomainError)) throw e;
          return bookAppointment(ctx, { siteId, customerId: car.ownerId, vehicleId: car.id, date: isoDate(day), startMinute, plannedCentiHours: CENTI(1), concern: main.description });
        });
        appointmentId = appt.id;
        stats.appointments++;
      }
      const ro = await checkIn(ctx, {
        siteId,
        appointmentId,
        customerId: car.ownerId,
        vehicleId: car.id,
        mileageIn: v.mileage + km,
        fuelLevelPct: fuel,
        damages: f.datatype.boolean(0.2) ? [{ zone: f.helpers.arrayElement(["FRONT", "REAR", "LEFT", "RIGHT"] as const), note: f.helpers.arrayElement(["scratch", "small dent", "scuffed bumper", "chipped paint"]) }] : [],
        signedBy: v.owner?.displayName ?? "Customer",
        concern: main.description,
      });
      const jobs = await ctx.tx.roJob.findMany({ where: { roId: ro.id } });
      await ctx.tx.roJob.update({ where: { id: jobs[0].id }, data: { technicianId: tech } });
      await fillJob(ctx, ro.id, jobs[0].id, siteId, main, car.brandId);
      if (warranty) {
        const w = await addJob(ctx, ro.id, { description: warranty.description, payer: "WARRANTY" as JobPayer, technicianId: tech });
        await fillJob(ctx, ro.id, w.id, siteId, warranty, car.brandId);
      }
      if (insured) {
        const j = await addJob(ctx, ro.id, { description: "Windscreen replacement (insurance claim)", payer: "INSURANCE" as JobPayer, payerCustomerId: f.helpers.arrayElement(insurers) });
        await addSubletLine(ctx, ro.id, j.id, { supplierId: f.helpers.arrayElement(subletSuppliers), label: "Windscreen replacement", costCents: subletCost, priceCents: Math.round(subletCost * 1.3) });
      }
      return ro;
    });
    if (!opened) return;
    stats.repairOrders++;
    if (stage === "CHECKED_IN") return;

    // The workshop does the work; the manager handles approvals, quality control, invoicing.
    await run("work", managers.get(siteId)!, siteId, day, async (ctx) => {
      const roId = opened.id;
      if (extra) {
        const j = await addJob(ctx, roId, { description: extra.description, isAdditional: true, technicianId: tech });
        await fillJob(ctx, roId, j.id, siteId, extra, car.brandId);
        if (stage !== "IN_PROGRESS") await decideJob(ctx, roId, j.id, { approve: extraApproved, note: extraApproved ? "Agreed by phone" : "Customer will come back later" });
      }
      const jobs = await ctx.tx.roJob.findMany({ where: { roId, status: "OPEN", approval: { in: ["NOT_REQUIRED", "APPROVED"] } }, include: { labourLines: true }, orderBy: { lineNo: "asc" } });
      for (const [i, job] of jobs.entries()) {
        const billed = job.labourLines.reduce((s, l) => s + l.billedCentiHours, 0);
        if (billed > 0) await clockJob(ctx, job.id, job.technicianId ?? tech, billed, cursor);
        if (stage === "IN_PROGRESS" && i === jobs.length - 1) return; // the last job is still being worked on
        await completeJob(ctx, roId, job.id);
      }
      if (stage === "IN_PROGRESS" || stage === "QUALITY_CHECK") return;
      await qualityCheck(ctx, roId, { pass: true });
      if (stage === "READY") return;
      const company = car.ownerKind === "COMPANY";
      const saved = await invoiceRepairOrder(ctx, roId, { paymentMethod: company || !paysNow ? undefined : method });
      if (saved.customerInvoiceId && company) {
        const inv = await ctx.tx.invoice.findUniqueOrThrow({ where: { id: saved.customerInvoiceId } });
        receivables.push({ siteId, customerId: inv.customerId, invoiceId: inv.id, due: inv.dueDate ?? day });
      }
      const insurerInvoices = await ctx.tx.invoice.findMany({ where: { sourceType: "REPAIR_ORDER", sourceId: roId, customer: { kind: "COMPANY" }, id: { not: saved.customerInvoiceId ?? "" } } });
      for (const inv of insurerInvoices) receivables.push({ siteId, customerId: inv.customerId, invoiceId: inv.id, due: inv.dueDate ?? day });
      stats.warrantyClaims += await ctx.tx.warrantyClaim.count({ where: { roId } });
      if (company || paysNow) await closeRepairOrder(ctx, roId);
    });
  }

  /** Reconditioning of a used car in stock before it goes on sale. */
  async function internalRepair(siteId: string, day: Date, cursor: Day) {
    const tech = f.helpers.arrayElement(technicians.get(siteId)!);
    const extra = pick(RECONDITIONING);
    const second = f.datatype.boolean(0.4) ? pick(RECONDITIONING.filter((r) => r !== extra)) : null;
    const done = await run("internal", managers.get(siteId)!, siteId, day, async (ctx) => {
      const car = await ctx.tx.vehicle.findFirst({
        // Only cars already bought on that day (the sales seed replays later purchases on their date).
        where: { siteId, stockType: "VO", status: { in: ["INTAKE", "RECONDITIONING"] }, stockInDate: { lte: day }, repairOrders: { none: {} } },
        orderBy: [{ stockInDate: "asc" }, { vin: "asc" }],
      });
      if (!car) return false;
      const ro = await checkIn(ctx, { siteId, kind: "INTERNAL", vehicleId: car.id, mileageIn: car.mileage + f.number.int({ min: 2, max: 30 }), fuelLevelPct: 25, concern: "Pre-sale inspection" });
      const jobs = await ctx.tx.roJob.findMany({ where: { roId: ro.id } });
      await ctx.tx.roJob.update({ where: { id: jobs[0].id }, data: { technicianId: tech } });
      await addLabourLine(ctx, ro.id, jobs[0].id, { operationCode: "INSPECTION" });
      for (const tpl of [extra, second].filter((x): x is Template => !!x)) {
        const j = await addJob(ctx, ro.id, { description: tpl.description, payer: "INTERNAL" as JobPayer, technicianId: tech });
        await fillJob(ctx, ro.id, j.id, siteId, tpl, car.brandId);
      }
      const all = await ctx.tx.roJob.findMany({ where: { roId: ro.id }, include: { labourLines: true }, orderBy: { lineNo: "asc" } });
      for (const job of all) {
        await clockJob(ctx, job.id, tech, job.labourLines.reduce((s, l) => s + l.billedCentiHours, 0), cursor);
        await completeJob(ctx, ro.id, job.id);
      }
      await qualityCheck(ctx, ro.id, { pass: true });
      await invoiceRepairOrder(ctx, ro.id);
      await closeRepairOrder(ctx, ro.id);
      return true;
    });
    if (done) {
      stats.repairOrders++;
      stats.internal++;
    }
  }

  /** Mondays: the manufacturer answers last week's claims. The 15th: it pays those accepted a month ago. */
  async function warrantyDesk(siteId: string, day: Date) {
    const manager = managers.get(siteId)!;
    if (day.getUTCDay() === 1) {
      const claims = await db.warrantyClaim.findMany({ where: { siteId, status: "SUBMITTED", submittedOn: { lte: addDays(day, -7) } }, select: { id: true }, orderBy: { number: "asc" } });
      for (const c of claims) {
        const accepted = f.datatype.boolean(0.92);
        await run("claim", manager, siteId, day, (ctx) => decideWarrantyClaim(ctx, c.id, { decision: accepted ? "ACCEPTED" : "REJECTED", notes: accepted ? null : "Not covered: wear and tear" }));
      }
    }
    if (day.getUTCDate() === 15) {
      const claims = await db.warrantyClaim.findMany({ where: { siteId, status: "ACCEPTED", submittedOn: { lte: addDays(day, -30) } }, select: { id: true, brandId: true }, orderBy: { number: "asc" } });
      for (const b of BRANDS) {
        const ids = claims.filter((c) => c.brandId === args.brands.get(b.code)).map((c) => c.id);
        if (ids.length) await run("remittance", manager, siteId, day, (ctx) => recordWarrantyRemittance(ctx, { siteId, claimIds: ids, reference: `${b.name} warranty remittance ${isoDate(day).slice(0, 7)}` }));
      }
    }
  }

  async function collect(day: Date) {
    const due = receivables.filter((r) => r.due.getTime() <= day.getTime());
    for (const r of due) {
      receivables.splice(receivables.indexOf(r), 1);
      if (!f.datatype.boolean(0.85)) continue; // a few stay overdue for the demo
      await run("collect", accountant, r.siteId, day, async (ctx) => {
        const inv = await ctx.tx.invoice.findUniqueOrThrow({ where: { id: r.invoiceId } });
        const left = inv.totalInclVatCents - inv.paidCents;
        if (left > 0) await recordPayment(ctx, { siteId: r.siteId, method: "TRANSFER", customerId: r.customerId, amountCents: left, allocations: [{ invoiceId: inv.id, amountCents: left }] });
      });
    }
  }

  // ── The day-by-day history ────────────────────────────────

  async function day(d: Date) {
    await collect(d);
    const weekday = d.getUTCDay();
    if (weekday === 0) return; // closed on Sundays
    const last = addDays(d, 1).getTime() >= today.getTime();
    for (const s of SITES) {
      const siteId = args.sites.get(s.code)!;
      const cursor: Day = new Map();
      await warrantyDesk(siteId, d);
      if ((weekday === 2 || weekday === 4) && f.datatype.boolean(0.8)) await internalRepair(siteId, d, cursor);
      const visits = f.helpers.weightedArrayElement(
        weekday === 6
          ? [
              { value: 0, weight: 2 },
              { value: 1, weight: 2 },
            ]
          : [
              { value: 1, weight: 2 },
              { value: 2, weight: 3 },
              { value: 3, weight: 2 },
            ],
      );
      for (let i = 0; i < visits; i++) await customerVisit(siteId, d, cursor);
      // Yesterday's cars are still in the workshop at every stage.
      if (last) for (const stage of ["CHECKED_IN", "IN_PROGRESS", "QUALITY_CHECK", "READY"] as const) await customerVisit(siteId, d, cursor, stage);
    }
  }

  /** On the business date: a car arriving and the next two weeks of appointments. */
  async function after() {
    for (const s of SITES) {
      const siteId = args.sites.get(s.code)!;
      const techs = technicians.get(siteId)!;
      for (let offset = 0; offset < 14; offset++) {
        const date = addDays(today, offset);
        if (date.getUTCDay() === 0) continue;
        const count = offset === 0 ? 4 : f.number.int({ min: 1, max: date.getUTCDay() === 6 ? 2 : 5 });
        const minutes = new Map<string, number>();
        for (let i = 0; i < count; i++) {
          const car = f.helpers.arrayElement(cars.get(siteId)!);
          const tpl = pick(JOBS);
          const tech = f.helpers.arrayElement(techs);
          const start = minutes.get(tech) ?? (offset === 0 ? 9 * 60 : DAY_START);
          const hours = OPERATIONS.find((o) => o.code === tpl.op)!.hours;
          minutes.set(tech, start + Math.round(hours * 60) + 30);
          const ok = await run("appointment", advisors.get(siteId)!, siteId, today, (ctx) =>
            bookAppointment(ctx, { siteId, customerId: car.ownerId, vehicleId: car.id, technicianId: tech, date: isoDate(date), startMinute: Math.min(start, DAY_END - 60), plannedCentiHours: CENTI(hours), concern: tpl.description }),
          );
          if (ok) stats.appointments++;
        }
      }
    }
    if (process.env.SEED_PROFILE) {
      console.table(
        [...timings].map(([step, t]) => ({ step, n: t.n, totalMs: Math.round(t.ms), avgMs: Math.round(t.ms / t.n) })).sort((a, b) => b.totalMs - a.totalMs),
      );
    }
  }

  const hooks: HistoryHooks = { before: reference, day, after };
  return { hooks, stats };
}
