import { addDays, isoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import type { ServiceContext } from "@/lib/context";
import {
  addJob,
  addLabourLine,
  addPartLine,
  bookAppointment,
  cancelAppointment,
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
} from "@/modules/workshop";
import { between, chance, pick, poisson, perOpenDay, unit, unitInt, weighted, isOpenDay } from "../domain/random";
import { JOB_TEMPLATES, RECONDITIONING_TEMPLATES, WARRANTY_TEMPLATES, templateFor, type JobTemplate, type PartWant } from "../domain/templates";
import { DAY_END, DAY_START, type Sim, type SiteCast } from "./shared";

const pickTemplate = (sim: Sim, list: JobTemplate[]) => weighted(sim.rng, list.map((value) => ({ value, weight: value.weight })));
const WORKABLE = ["CHECKED_IN", "IN_PROGRESS", "QUALITY_CHECK", "READY"] as const;

/** Each technician's next free minute today, starting after what they already clocked. */
type Cursor = Map<string, number>;

/** The workshop of one site for one day. */
export async function workshopDay(sim: Sim, site: SiteCast) {
  if (!site.technicianIds.length) return;
  const cursor: Cursor = new Map();
  for (const c of await db.clocking.groupBy({ by: ["technicianId"], where: { siteId: site.id, businessDate: sim.day }, _max: { endMinute: true } })) {
    cursor.set(c.technicianId, (c._max.endMinute ?? DAY_START) + 10);
  }
  await warrantyDesk(sim, site);
  await finishOpenWork(sim, site, cursor);
  await todaysVisits(sim, site, cursor);
  if (chance(sim.rng, perOpenDay(sim.rates.internalRepairsPerWeek))) await internalRepair(sim, site, cursor);
  await bookAhead(sim, site);
}

/** A part to fit: the car's make first, else an aftermarket reference, with free stock on the shelf. */
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

async function fillJob(ctx: ServiceContext, roId: string, jobId: string, siteId: string, tpl: JobTemplate, brandId: string | null) {
  await addLabourLine(ctx, roId, jobId, { operationCode: tpl.op });
  for (const want of tpl.parts) {
    const part = await findPart(ctx, siteId, want, brandId);
    if (part) await addPartLine(ctx, roId, jobId, { partNumber: part.partNumber, qty: String(part.qty) });
  }
}

/** Clock a job: the technician works the standard time give or take their pace. False when the day is over. */
async function clockJob(sim: Sim, ctx: ServiceContext, jobId: string, techId: string, billed: number, cursor: Cursor) {
  const start = cursor.get(techId) ?? DAY_START;
  if (start >= DAY_END - 30) return false;
  const minutes = Math.max(10, Math.round((billed * 60 * (0.75 + sim.rng() * 0.6)) / 100));
  const end = Math.min(DAY_END, start + minutes);
  await clockOn(ctx, { jobId, technicianId: techId, time: start });
  await clockOff(ctx, { technicianId: techId, time: end });
  cursor.set(techId, end + between(sim.rng, 5, 25));
  sim.counts["clocking"] = (sim.counts["clocking"] ?? 0) + 1;
  return true;
}

/** The technician with the least work clocked today. */
const freestTech = (site: SiteCast, cursor: Cursor) => [...site.technicianIds].sort((a, b) => (cursor.get(a) ?? DAY_START) - (cursor.get(b) ?? DAY_START))[0];

// ── Customer visits ──────────────────────────────────────────────────

/** Customers' cars of the site's customers that are not already booked in or in the workshop. */
async function freeCars(site: SiteCast) {
  return db.vehicle.findMany({
    where: {
      stockType: "NONE",
      owner: { homeSiteId: site.id, kind: { in: ["INDIVIDUAL", "COMPANY"] } },
      appointments: { none: { status: "BOOKED" } },
      repairOrders: { none: { status: { in: [...WORKABLE] } } },
    },
    select: { id: true, brandId: true, firstRegistration: true, ownerCustomerId: true },
    orderBy: { vin: "asc" },
  });
}

/** Appointments booked two to ten days ahead, as customers phone in. */
async function bookAhead(sim: Sim, site: SiteCast) {
  const n = poisson(sim.rng, sim.rates.workshopVisitsPerDay * sim.rates.bookedShare);
  if (!n) return;
  const cars = await freeCars(site);
  for (let i = 0; i < n && cars.length; i++) {
    const car = cars.splice(Math.floor(sim.rng() * cars.length), 1)[0];
    let date = addDays(sim.day, between(sim.rng, 2, 10));
    if (!isOpenDay(date)) date = addDays(date, 1);
    const tpl = pickTemplate(sim, JOB_TEMPLATES);
    const op = await db.labourOperation.findUnique({ where: { code: tpl.op }, select: { standardCentiHours: true } });
    await sim.step("book appointment", site.advisor, site.id, (ctx) =>
      bookAppointment(ctx, {
        siteId: site.id,
        customerId: car.ownerCustomerId!,
        vehicleId: car.id,
        technicianId: pick(sim.rng, site.technicianIds),
        date: isoDate(date),
        startMinute: between(sim.rng, 0, 16) * 30 + DAY_START,
        plannedCentiHours: Math.max(50, op?.standardCentiHours ?? 100),
        concern: tpl.description,
      }),
    );
  }
}

/** Today's appointments (a few no-shows) and walk-ins are checked in. */
async function todaysVisits(sim: Sim, site: SiteCast, cursor: Cursor) {
  const appointments = await db.appointment.findMany({
    where: { siteId: site.id, date: sim.day, status: "BOOKED" },
    include: { vehicle: { select: { id: true, brandId: true, firstRegistration: true } } },
    orderBy: [{ startMinute: "asc" }, { number: "asc" }],
  });
  for (const a of appointments) {
    if (unit(sim.rates.seed, a.id, "no-show") < 0.04) {
      await sim.step("no-show", site.advisor, site.id, (ctx) => cancelAppointment(ctx, a.id, true));
      continue;
    }
    await visit(sim, site, cursor, { appointmentId: a.id, customerId: a.customerId, car: a.vehicle, concern: a.concern });
  }
  const walkIns = poisson(sim.rng, sim.rates.workshopVisitsPerDay * (1 - sim.rates.bookedShare));
  if (!walkIns) return;
  const cars = await freeCars(site);
  for (let i = 0; i < walkIns && cars.length; i++) {
    const car = cars.splice(Math.floor(sim.rng() * cars.length), 1)[0];
    await visit(sim, site, cursor, { customerId: car.ownerCustomerId!, car, concern: pickTemplate(sim, JOB_TEMPLATES).description });
  }
}

async function visit(
  sim: Sim,
  site: SiteCast,
  cursor: Cursor,
  v: { appointmentId?: string; customerId: string; car: { id: string; brandId: string | null; firstRegistration: Date | null }; concern: string },
) {
  const main = templateFor(v.concern) ?? pickTemplate(sim, JOB_TEMPLATES);
  const underWarranty =
    !!v.car.brandId && site.brandIds.includes(v.car.brandId) && !!v.car.firstRegistration && v.car.firstRegistration > addDays(sim.day, -3 * 365) && chance(sim.rng, 0.5);
  const warranty = underWarranty ? pickTemplate(sim, WARRANTY_TEMPLATES) : null;
  const tech = freestTech(site, cursor);
  const km = between(sim.rng, 400, 18_000);
  const fuel = pick(sim.rng, [0, 25, 50, 75, 100]);
  const damage = chance(sim.rng, 0.2) ? [{ zone: pick(sim.rng, ["FRONT", "REAR", "LEFT", "RIGHT"] as const), note: pick(sim.rng, ["scratch", "small dent", "scuffed bumper", "chipped paint"]) }] : [];
  const ro = await sim.step("check-in", site.advisor, site.id, async (ctx) => {
    const car = await ctx.tx.vehicle.findUniqueOrThrow({ where: { id: v.car.id }, include: { owner: { select: { displayName: true } } } });
    const ro = await checkIn(ctx, {
      siteId: site.id,
      appointmentId: v.appointmentId,
      customerId: v.customerId,
      vehicleId: v.car.id,
      mileageIn: car.mileage + km,
      fuelLevelPct: fuel,
      damages: damage,
      signedBy: car.owner?.displayName ?? "Customer",
      concern: main.description,
    });
    const first = await ctx.tx.roJob.findFirstOrThrow({ where: { roId: ro.id }, orderBy: { lineNo: "asc" } });
    await fillJob(ctx, ro.id, first.id, site.id, main, v.car.brandId);
    if (warranty) {
      const w = await addJob(ctx, ro.id, { description: warranty.description, payer: "WARRANTY", technicianId: first.technicianId ?? tech });
      await fillJob(ctx, ro.id, w.id, site.id, warranty, v.car.brandId);
    }
    return ro;
  });
  if (ro) await work(sim, site, cursor, ro.id);
}

/** Cars checked in on earlier days are worked on until they go home. */
async function finishOpenWork(sim: Sim, site: SiteCast, cursor: Cursor) {
  const ros = await db.repairOrder.findMany({ where: { siteId: site.id, kind: "CUSTOMER", status: { in: [...WORKABLE] }, openedOn: { lt: sim.day } }, select: { id: true }, orderBy: { number: "asc" } });
  for (const ro of ros) await work(sim, site, cursor, ro.id);
}

/**
 * The day's work on one repair order: more work found and quoted (decided the next day), jobs
 * clocked and completed, quality check, invoice per payer, hand-over. Most cars leave the same
 * day; some stay one or two more days (decided per repair order).
 */
async function work(sim: Sim, site: SiteCast, cursor: Cursor, roId: string) {
  const seed = sim.rates.seed;
  const ro = await db.repairOrder.findUniqueOrThrow({ where: { id: roId }, include: { customer: { select: { kind: true } }, vehicle: { select: { brandId: true } }, jobs: { select: { isAdditional: true } } } });
  const stay = unit(seed, roId, "stay") < 0.8 ? 0 : unitInt(seed, roId, "stay-days", 1, 2);
  const leaves = addDays(ro.openedOn, stay) <= sim.day;
  const findsMore = unit(seed, roId, "more") < sim.rates.additionalWorkRate && !ro.jobs.some((j) => j.isAdditional);
  const approved = unit(seed, roId, "approve") < 0.8;
  const method = weighted(sim.rng, [
    { value: "CARD" as const, weight: 7 },
    { value: "CHEQUE" as const, weight: 1 },
    { value: "CASH" as const, weight: 1 },
    { value: "TRANSFER" as const, weight: 1 },
  ]);
  const paysNow = unit(seed, roId, "pays-now") < 0.97;
  const extra = findsMore ? pickTemplate(sim, JOB_TEMPLATES) : null;
  await sim.step("workshop work", site.serviceManager, site.id, async (ctx) => {
    const tech = freestTech(site, cursor);
    if (extra && ro.status !== "READY") {
      const j = await addJob(ctx, roId, { description: extra.description, isAdditional: true, technicianId: tech });
      await fillJob(ctx, roId, j.id, site.id, extra, ro.vehicle.brandId);
      if (!leaves) return true; // the customer is called; the answer comes tomorrow
    }
    for (const j of await ctx.tx.roJob.findMany({ where: { roId, status: "OPEN", approval: "PENDING" }, orderBy: { lineNo: "asc" } })) {
      await decideJob(ctx, roId, j.id, { approve: approved, note: approved ? "Agreed by phone" : "Customer will come back later" });
    }
    const jobs = await ctx.tx.roJob.findMany({
      where: { roId, status: "OPEN", approval: { in: ["NOT_REQUIRED", "APPROVED"] } },
      include: { labourLines: { select: { billedCentiHours: true } }, _count: { select: { clockings: true } } },
      orderBy: { lineNo: "asc" },
    });
    for (const job of jobs) {
      const billed = job.labourLines.reduce((s, l) => s + l.billedCentiHours, 0);
      if (billed > 0 && job._count.clockings === 0 && !(await clockJob(sim, ctx, job.id, job.technicianId ?? tech, billed, cursor))) return true;
      if (!leaves) return true;
      await completeJob(ctx, roId, job.id);
    }
    if (!leaves) return true;
    const fresh = await ctx.tx.repairOrder.findUniqueOrThrow({ where: { id: roId }, select: { status: true } });
    if (fresh.status === "QUALITY_CHECK") await qualityCheck(ctx, roId, { pass: true });
    if (fresh.status === "QUALITY_CHECK" || fresh.status === "READY") {
      const company = ro.customer?.kind === "COMPANY";
      await invoiceRepairOrder(ctx, roId, { paymentMethod: company || !paysNow ? undefined : method });
      if (company || paysNow) await closeRepairOrder(ctx, roId);
    }
    return true;
  });
}

// ── Internal work and warranty ───────────────────────────────────────

/** A used car in stock prepared for sale: inspection plus one or two jobs, in a day. */
async function internalRepair(sim: Sim, site: SiteCast, cursor: Cursor) {
  const tech = freestTech(site, cursor);
  const first = pickTemplate(sim, RECONDITIONING_TEMPLATES);
  const second = chance(sim.rng, 0.4) ? pickTemplate(sim, RECONDITIONING_TEMPLATES.filter((r) => r !== first)) : null;
  const km = between(sim.rng, 2, 30);
  await sim.step("internal repair", site.serviceManager, site.id, async (ctx) => {
    const car = await ctx.tx.vehicle.findFirst({
      where: { siteId: site.id, stockType: "VO", status: { in: ["INTAKE", "RECONDITIONING"] }, repairOrders: { none: {} } },
      orderBy: [{ stockInDate: "asc" }, { vin: "asc" }],
    });
    if (!car) return false;
    const ro = await checkIn(ctx, { siteId: site.id, kind: "INTERNAL", vehicleId: car.id, mileageIn: car.mileage + km, fuelLevelPct: 25, concern: "Pre-sale inspection" });
    const inspection = await ctx.tx.roJob.findFirstOrThrow({ where: { roId: ro.id }, orderBy: { lineNo: "asc" } });
    await addLabourLine(ctx, ro.id, inspection.id, { operationCode: "INSPECTION" });
    for (const tpl of [first, second].filter((x): x is JobTemplate => !!x)) {
      const j = await addJob(ctx, ro.id, { description: tpl.description, payer: "INTERNAL", technicianId: tech });
      await fillJob(ctx, ro.id, j.id, site.id, tpl, car.brandId);
    }
    const jobs = await ctx.tx.roJob.findMany({ where: { roId: ro.id }, include: { labourLines: { select: { billedCentiHours: true } } }, orderBy: { lineNo: "asc" } });
    for (const job of jobs) {
      await clockJob(sim, ctx, job.id, tech, job.labourLines.reduce((s, l) => s + l.billedCentiHours, 0), cursor);
      await completeJob(ctx, ro.id, job.id);
    }
    await qualityCheck(ctx, ro.id, { pass: true });
    await invoiceRepairOrder(ctx, ro.id);
    await closeRepairOrder(ctx, ro.id);
    return true;
  });
}

/** Mondays: the manufacturer answers last week's claims. The 15th: it pays those accepted a month ago. */
async function warrantyDesk(sim: Sim, site: SiteCast) {
  if (sim.day.getUTCDay() === 1) {
    const claims = await db.warrantyClaim.findMany({ where: { siteId: site.id, status: "SUBMITTED", submittedOn: { lte: addDays(sim.day, -7) } }, select: { id: true }, orderBy: { number: "asc" } });
    for (const c of claims) {
      const accepted = unit(sim.rates.seed, c.id, "claim") < 0.92;
      await sim.step("warranty decision", site.serviceManager, site.id, (ctx) => decideWarrantyClaim(ctx, c.id, { decision: accepted ? "ACCEPTED" : "REJECTED", notes: accepted ? null : "Not covered: wear and tear" }));
    }
  }
  if (sim.day.getUTCDate() === 15) {
    const claims = await db.warrantyClaim.findMany({
      where: { siteId: site.id, status: "ACCEPTED", submittedOn: { lte: addDays(sim.day, -30) } },
      select: { id: true, brand: { select: { id: true, name: true } } },
      orderBy: { number: "asc" },
    });
    const brands = new Map(claims.map((c) => [c.brand.id, c.brand.name]));
    for (const [brandId, name] of brands) {
      const ids = claims.filter((c) => c.brand.id === brandId).map((c) => c.id);
      await sim.step("warranty remittance", site.serviceManager, site.id, (ctx) => recordWarrantyRemittance(ctx, { siteId: site.id, claimIds: ids, reference: `${name} warranty remittance ${isoDate(sim.day).slice(0, 7)}` }));
    }
  }
}
