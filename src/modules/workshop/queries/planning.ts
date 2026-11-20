/** Planner (technician × day), clocking board, productivity and efficiency, labour catalogue, warranty, dashboard. */
import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { addDays } from "@/lib/dates";
import { pageArgs, type ListParams } from "@/lib/list";
import { technicianKpis, weekOf, workingDays } from "../domain/productivity";
import { allowedSites, siteWhere, workshopSite } from "./scope";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function getPlanner(ctx: ServiceContext, a: { siteId?: string | null; week?: string | null }) {
  ctx.require("workshop.appointment", "view");
  const siteId = await workshopSite(ctx, a.siteId);
  const anchor = a.week && /^\d{4}-\d{2}-\d{2}$/.test(a.week) ? new Date(`${a.week}T00:00:00Z`) : ctx.businessDate;
  const days = weekOf(anchor);
  const [technicians, appointments, sites] = await Promise.all([
    ctx.tx.technician.findMany({ where: { siteId, active: true }, include: { user: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { user: { lastName: "asc" } } }),
    ctx.tx.appointment.findMany({
      where: { siteId, date: { gte: days[0], lte: days[days.length - 1] }, status: { in: ["BOOKED", "ARRIVED"] } },
      orderBy: [{ date: "asc" }, { startMinute: "asc" }],
      include: {
        customer: { select: { displayName: true } },
        vehicle: { select: { registration: true, make: true, model: true } },
        bay: { select: { name: true } },
        repairOrder: { select: { id: true, number: true } },
      },
    }),
    ctx.tx.site.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  const visible = allowedSites(ctx);
  const rows = technicians.map((t) => ({
    id: t.userId,
    name: `${t.user.firstName} ${t.user.lastName}`,
    capacity: t.dailyCapacityCentiHours,
    days: days.map((d) => {
      const list = appointments.filter((x) => x.technicianId === t.userId && isoDay(x.date) === isoDay(d));
      return { date: isoDay(d), booked: list.reduce((s, x) => s + x.plannedCentiHours, 0), appointments: list };
    }),
  }));
  const unassigned = days.map((d) => ({ date: isoDay(d), appointments: appointments.filter((x) => !x.technicianId && isoDay(x.date) === isoDay(d)) }));
  return {
    siteId,
    sites: sites.filter((s) => !visible || visible.includes(s.id)).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
    days: days.map(isoDay),
    today: isoDay(ctx.businessDate),
    previousWeek: isoDay(addDays(days[0], -7)),
    nextWeek: isoDay(addDays(days[0], 7)),
    rows,
    unassigned,
    canBook: ctx.can("workshop.appointment", "create", siteId),
  };
}

export async function getAppointmentFormData(ctx: ServiceContext, a: { siteId?: string | null; vehicleId?: string | null }) {
  ctx.require("workshop.appointment", "create");
  const siteId = await workshopSite(ctx, a.siteId);
  const [sites, technicians, bays, vehicle] = await Promise.all([
    ctx.tx.site.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    ctx.tx.technician.findMany({ where: { siteId, active: true }, include: { user: { select: { firstName: true, lastName: true } } } }),
    ctx.tx.workshopBay.findMany({ where: { siteId, active: true }, orderBy: { name: "asc" } }),
    a.vehicleId ? ctx.tx.vehicle.findUnique({ where: { id: a.vehicleId }, include: { owner: { select: { id: true, displayName: true } } } }) : null,
  ]);
  return {
    siteId,
    sites: sites.filter((s) => ctx.can("workshop.appointment", "create", s.id)).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
    technicians: technicians.map((t) => ({ value: t.userId, label: `${t.user.firstName} ${t.user.lastName}` })),
    bays: bays.map((b) => ({ value: b.id, label: b.name })),
    vehicle,
  };
}

/** Customer-owned cars matching a registration, VIN or owner name (appointment and check-in pickers). */
export async function searchServiceVehicles(ctx: ServiceContext, q: string) {
  ctx.require("workshop.repair_order", "view");
  const term = q.trim();
  if (term.length < 2) return [];
  const rows = await ctx.tx.vehicle.findMany({
    where: {
      stockType: "NONE",
      OR: [
        { registration: { contains: term.replace(/\s+/g, ""), mode: "insensitive" } },
        { vin: { contains: term, mode: "insensitive" } },
        { owner: { displayName: { contains: term, mode: "insensitive" } } },
      ],
    },
    take: 20,
    orderBy: { registration: "asc" },
    include: { owner: { select: { id: true, displayName: true } } },
  });
  return rows;
}

// ── Clocking ────────────────────────────────────────────────

export async function getClockingBoard(ctx: ServiceContext, a: { siteId?: string | null }) {
  ctx.require("workshop.clocking", "view");
  const siteId = await workshopSite(ctx, a.siteId);
  const [technicians, today, jobs] = await Promise.all([
    ctx.tx.technician.findMany({ where: { siteId, active: true }, include: { user: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { user: { lastName: "asc" } } }),
    ctx.tx.clocking.findMany({
      where: { siteId, OR: [{ businessDate: ctx.businessDate }, { endMinute: null }] },
      orderBy: { startMinute: "asc" },
      include: { ro: { select: { id: true, number: true } }, job: { select: { lineNo: true, description: true } } },
    }),
    ctx.tx.roJob.findMany({
      where: { ro: { siteId, status: { in: ["CHECKED_IN", "IN_PROGRESS"] } }, status: "OPEN", approval: { in: ["NOT_REQUIRED", "APPROVED"] } },
      orderBy: [{ ro: { number: "asc" } }, { lineNo: "asc" }],
      include: { ro: { select: { id: true, number: true, vehicle: { select: { registration: true, make: true, model: true } } } } },
    }),
  ]);
  const self = ctx.actor.userId;
  const canOthers = ctx.can("workshop.clocking", "validate", siteId);
  return {
    siteId,
    today: ctx.businessDate,
    technicians: technicians
      .filter((t) => canOthers || t.userId === self || !ctx.can("workshop.clocking", "create", siteId))
      .map((t) => {
        const mine = today.filter((c) => c.technicianId === t.userId);
        return {
          id: t.userId,
          name: `${t.user.firstName} ${t.user.lastName}`,
          open: mine.find((c) => c.endMinute === null) ?? null,
          clockedToday: mine.filter((c) => c.businessDate.getTime() === ctx.businessDate.getTime()).reduce((s, c) => s + (c.centiHours ?? 0), 0),
          clockings: mine,
          canClock: ctx.can("workshop.clocking", "create", siteId) && (t.userId === self || canOthers),
        };
      }),
    jobs: jobs.map((j) => ({ value: j.id, label: `${j.ro.number} · ${j.lineNo}. ${j.description} — ${j.ro.vehicle.make} ${j.ro.vehicle.model} ${j.ro.vehicle.registration ?? ""}`.trim() })),
  };
}

/**
 * Productivity (clocked ÷ available) and efficiency (billed ÷ clocked) per technician over a
 * period. Billed hours are the standard times invoiced on jobs the technician was assigned to.
 */
export async function getProductivity(ctx: ServiceContext, a: { siteId?: string | null; from?: string | null; to?: string | null }) {
  ctx.require("workshop.clocking", "view");
  const siteId = await workshopSite(ctx, a.siteId);
  const monthStart = new Date(Date.UTC(ctx.businessDate.getUTCFullYear(), ctx.businessDate.getUTCMonth(), 1));
  const from = a.from ? new Date(a.from) : monthStart;
  const to = a.to ? new Date(a.to) : ctx.businessDate;
  const days = workingDays(from, to);
  const [technicians, clocked, billed] = await Promise.all([
    ctx.tx.technician.findMany({ where: { siteId }, include: { user: { select: { firstName: true, lastName: true } } }, orderBy: { user: { lastName: "asc" } } }),
    ctx.tx.clocking.groupBy({ by: ["technicianId"], where: { siteId, businessDate: { gte: from, lte: to }, centiHours: { not: null } }, _sum: { centiHours: true } }),
    ctx.tx.$queryRaw<{ technicianId: string; billed: bigint }[]>`
      SELECT j."technicianId", SUM(l."billedCentiHours")::bigint AS billed
      FROM ro_labour_line l JOIN ro_job j ON j.id = l."jobId" JOIN repair_order r ON r.id = j."roId"
      WHERE r."siteId" = ${siteId} AND r."invoicedOn" BETWEEN ${isoDay(from)}::date AND ${isoDay(to)}::date AND j.status <> 'DECLINED' AND j."technicianId" IS NOT NULL
      GROUP BY j."technicianId"`,
  ]);
  const clockedBy = new Map(clocked.map((c) => [c.technicianId, c._sum.centiHours ?? 0]));
  const billedBy = new Map(billed.map((b) => [b.technicianId, Number(b.billed)]));
  const rows = technicians.map((t) => {
    const available = t.active ? t.dailyCapacityCentiHours * days : 0;
    const c = clockedBy.get(t.userId) ?? 0;
    const b = billedBy.get(t.userId) ?? 0;
    return { id: t.userId, name: `${t.user.firstName} ${t.user.lastName}`, availableCentiHours: available, clockedCentiHours: c, billedCentiHours: b, ...technicianKpis({ availableCentiHours: available, clockedCentiHours: c, billedCentiHours: b }) };
  });
  const totals = rows.reduce((s, r) => ({ available: s.available + r.availableCentiHours, clocked: s.clocked + r.clockedCentiHours, billed: s.billed + r.billedCentiHours }), { available: 0, clocked: 0, billed: 0 });
  return {
    siteId,
    from,
    to,
    workingDays: days,
    rows,
    totals: { availableCentiHours: totals.available, clockedCentiHours: totals.clocked, billedCentiHours: totals.billed, ...technicianKpis({ availableCentiHours: totals.available, clockedCentiHours: totals.clocked, billedCentiHours: totals.billed }) },
  };
}

// ── Labour catalogue ────────────────────────────────────────

export const OPERATION_SORTS = ["code", "label", "category", "standardCentiHours"] as const;

export async function listLabourOperations(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("workshop.labour_catalogue", "view");
  const w: Prisma.LabourOperationWhereInput = {};
  if (p.q) w.OR = [{ code: { contains: p.q, mode: "insensitive" } }, { label: { contains: p.q, mode: "insensitive" } }];
  if (p.filters.category) w.category = p.filters.category;
  if (p.filters.active !== "all") w.active = true;
  const sort = (OPERATION_SORTS as readonly string[]).includes(p.sort ?? "") ? p.sort! : "code";
  const [rows, total, categories, brands] = await Promise.all([
    ctx.tx.labourOperation.findMany({ where: w, orderBy: [{ [sort]: p.sort ? p.dir : "asc" }, { code: "asc" }], ...pageArgs(p, opts.all), include: { brand: { select: { code: true, name: true } } } }),
    ctx.tx.labourOperation.count({ where: w }),
    ctx.tx.labourOperation.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    ctx.tx.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    rows,
    total,
    page: p.page,
    pageSize: p.pageSize,
    categories: categories.map((c) => c.category),
    brands: brands.map((b) => ({ value: b.id, label: b.name })),
    canEdit: ctx.can("workshop.labour_catalogue", "edit"),
  };
}

export async function getLabourOperation(ctx: ServiceContext, id: string) {
  ctx.require("workshop.labour_catalogue", "view");
  return ctx.tx.labourOperation.findUnique({ where: { id } });
}

// ── Warranty ────────────────────────────────────────────────

export const CLAIM_SORTS = ["number", "submittedOn", "claimedCents", "status"] as const;

export async function listWarrantyClaims(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("workshop.warranty", "view");
  const w: Prisma.WarrantyClaimWhereInput = { ...(siteWhere(ctx, p) as Prisma.WarrantyClaimWhereInput) };
  if (p.filters.status === "OPEN") w.status = { in: ["SUBMITTED", "ACCEPTED"] };
  else if (p.filters.status) w.status = p.filters.status as Prisma.WarrantyClaimWhereInput["status"];
  if (p.filters.brand) w.brandId = p.filters.brand;
  if (p.q) w.OR = [{ number: { contains: p.q, mode: "insensitive" } }, { ro: { number: { contains: p.q, mode: "insensitive" } } }];
  const sort = (CLAIM_SORTS as readonly string[]).includes(p.sort ?? "") ? p.sort! : "submittedOn";
  const [rows, total, open, brands] = await Promise.all([
    ctx.tx.warrantyClaim.findMany({
      where: w,
      orderBy: [{ [sort]: p.dir }, { number: "desc" }],
      ...pageArgs(p, opts.all),
      include: {
        site: { select: { code: true } },
        brand: { select: { name: true } },
        ro: { select: { id: true, number: true, vehicle: { select: { registration: true, make: true, model: true } } } },
        job: { select: { description: true } },
        invoice: { select: { id: true, number: true, totalInclVatCents: true, paidCents: true } },
      },
    }),
    ctx.tx.warrantyClaim.count({ where: w }),
    ctx.tx.warrantyClaim.aggregate({ where: { ...(siteWhere(ctx, p) as Prisma.WarrantyClaimWhereInput), status: { in: ["SUBMITTED", "ACCEPTED"] } }, _sum: { claimedCents: true }, _count: true }),
    ctx.tx.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    rows,
    total,
    page: p.page,
    pageSize: p.pageSize,
    openCount: open._count,
    openCents: open._sum.claimedCents ?? 0,
    brands: brands.map((b) => ({ value: b.id, label: b.name })),
    canValidate: ctx.can("workshop.warranty", "validate"),
  };
}

// ── Dashboard ───────────────────────────────────────────────

export async function getWorkshopDashboard(ctx: ServiceContext) {
  ctx.require("workshop.repair_order", "view");
  const sites = allowedSites(ctx);
  const scope = sites ? { siteId: { in: sites } } : {};
  const monthStart = new Date(Date.UTC(ctx.businessDate.getUTCFullYear(), ctx.businessDate.getUTCMonth(), 1));
  const [open, ready, pending, invoiced, claims, today, clocked, billed] = await Promise.all([
    ctx.tx.repairOrder.count({ where: { ...scope, status: { in: ["CHECKED_IN", "IN_PROGRESS", "QUALITY_CHECK"] } } }),
    ctx.tx.repairOrder.count({ where: { ...scope, status: "READY" } }),
    ctx.tx.roJob.count({ where: { approval: "PENDING", ro: { ...scope, status: { in: ["CHECKED_IN", "IN_PROGRESS", "QUALITY_CHECK"] } } } }),
    ctx.tx.repairOrder.aggregate({ where: { ...scope, kind: "CUSTOMER", invoicedOn: { gte: monthStart }, status: { in: ["INVOICED", "CLOSED"] } }, _sum: { totalExclVatCents: true }, _count: true }),
    ctx.tx.warrantyClaim.aggregate({ where: { ...scope, status: { in: ["SUBMITTED", "ACCEPTED"] } }, _sum: { claimedCents: true }, _count: true }),
    ctx.tx.appointment.count({ where: { ...scope, date: ctx.businessDate, status: "BOOKED" } }),
    ctx.tx.clocking.aggregate({ where: { ...scope, businessDate: { gte: monthStart }, centiHours: { not: null } }, _sum: { centiHours: true } }),
    ctx.tx.roLabourLine.aggregate({ where: { job: { status: { not: "DECLINED" }, ro: { ...scope, invoicedOn: { gte: monthStart } } } }, _sum: { billedCentiHours: true } }),
  ]);
  const c = clocked._sum.centiHours ?? 0;
  const b = billed._sum.billedCentiHours ?? 0;
  return {
    openRos: open,
    readyRos: ready,
    pendingApprovals: pending,
    invoicedMtd: invoiced._count,
    revenueMtdCents: invoiced._sum.totalExclVatCents ?? 0,
    openClaims: claims._count,
    openClaimsCents: claims._sum.claimedCents ?? 0,
    appointmentsToday: today,
    efficiencyMtdBp: technicianKpis({ availableCentiHours: 0, clockedCentiHours: c, billedCentiHours: b }).efficiencyBp,
  };
}
