/** Repair order reads: the list, one RO with everything around it, check-in form data, service history. */
import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { sumCents } from "@/lib/money";
import { pageArgs, type ListParams } from "@/lib/list";
import { jobTotal, labourRateFor, type JobPayer } from "../domain/pricing";
import { jobMayProceed } from "../domain/workflow";
import { labourRates, RO_INCLUDE } from "../services/shared";
import { allowedSites, dateRange, siteWhere, workshopSite } from "./scope";

export const RO_SORTS = ["number", "openedOn", "status", "totalExclVatCents", "promisedOn"] as const;

export async function listRepairOrders(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("workshop.repair_order", "view");
  const w: Prisma.RepairOrderWhereInput = { ...(siteWhere(ctx, p) as Prisma.RepairOrderWhereInput) };
  if (p.filters.status === "OPEN") w.status = { in: ["CHECKED_IN", "IN_PROGRESS", "QUALITY_CHECK", "READY"] };
  else if (p.filters.status) w.status = p.filters.status as Prisma.RepairOrderWhereInput["status"];
  if (p.filters.kind) w.kind = p.filters.kind as Prisma.RepairOrderWhereInput["kind"];
  if (p.filters.vehicle) w.vehicleId = p.filters.vehicle;
  if (p.q) {
    w.OR = [
      { number: { contains: p.q, mode: "insensitive" } },
      { customer: { displayName: { contains: p.q, mode: "insensitive" } } },
      { vehicle: { registration: { contains: p.q.replace(/\s+/g, ""), mode: "insensitive" } } },
      { vehicle: { vin: { contains: p.q, mode: "insensitive" } } },
    ];
  }
  const range = dateRange(p);
  if (range) w.openedOn = range;
  const sort = (RO_SORTS as readonly string[]).includes(p.sort ?? "") ? p.sort! : "openedOn";
  const [rows, total] = await Promise.all([
    ctx.tx.repairOrder.findMany({
      where: w,
      orderBy: [{ [sort]: p.dir }, { number: "desc" }],
      ...pageArgs(p, opts.all),
      include: {
        site: { select: { code: true } },
        customer: { select: { id: true, displayName: true } },
        vehicle: { select: { id: true, registration: true, vin: true, make: true, model: true } },
        advisor: { select: { firstName: true, lastName: true } },
        _count: { select: { jobs: true } },
      },
    }),
    ctx.tx.repairOrder.count({ where: w }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getRepairOrder(ctx: ServiceContext, id: string) {
  const ro = await ctx.tx.repairOrder.findUnique({
    where: { id },
    include: {
      ...RO_INCLUDE,
      jobs: {
        orderBy: { lineNo: "asc" },
        include: {
          labourLines: { include: { operation: { select: { code: true } } } },
          partLines: { include: { part: true } },
          subletLines: { include: { supplier: { select: { id: true, name: true } } } },
          technician: { select: { id: true, firstName: true, lastName: true } },
          payerCustomer: { select: { id: true, displayName: true } },
          warrantyClaim: { select: { id: true, number: true, status: true } },
        },
      },
      site: true,
      advisor: { select: { firstName: true, lastName: true } },
      appointment: { select: { id: true, number: true, date: true } },
      clockings: { orderBy: [{ businessDate: "asc" }, { startMinute: "asc" }], include: { technician: { select: { firstName: true, lastName: true } } } },
      warrantyClaims: { select: { id: true, number: true, status: true, claimedCents: true, jobId: true } },
    },
  });
  if (!ro) throw new NotFoundError("RepairOrder", id);
  ctx.require("workshop.repair_order", "view", ro.siteId);
  const invoiceIds = [...new Set(ro.jobs.map((j) => j.invoiceId).filter((x): x is string => !!x))];
  const [invoices, entries, rates, technicians, operations, suppliers, insurers] = await Promise.all([
    ctx.tx.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, number: true, totalInclVatCents: true, paidCents: true, status: true, customer: { select: { displayName: true } } } }),
    ctx.tx.journalEntry.findMany({ where: { sourceType: "REPAIR_ORDER", sourceId: id }, select: { id: true, number: true, label: true }, orderBy: { number: "asc" } }),
    labourRates(ctx.tx, ro.siteId, ro.vehicle.brandId),
    ctx.tx.technician.findMany({ where: { siteId: ro.siteId, active: true }, include: { user: { select: { id: true, firstName: true, lastName: true } } } }),
    ctx.tx.labourOperation.findMany({ where: { active: true, OR: [{ brandId: null }, { brandId: ro.vehicle.brandId ?? undefined }] }, orderBy: { code: "asc" }, select: { code: true, label: true, standardCentiHours: true } }),
    ctx.tx.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ctx.tx.customer.findMany({ where: { kind: "COMPANY" }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
  ]);
  const clockedByJob = new Map<string, number>();
  for (const c of ro.clockings) clockedByJob.set(c.jobId, (clockedByJob.get(c.jobId) ?? 0) + (c.centiHours ?? 0));
  const jobs = ro.jobs.map((j) => ({
    ...j,
    totalCents: jobTotal({ labour: j.labourLines, parts: j.partLines, sublet: j.subletLines }),
    billedCentiHours: sumCents(j.labourLines.map((l) => l.billedCentiHours)),
    clockedCentiHours: clockedByJob.get(j.id) ?? 0,
    mayProceed: jobMayProceed(j),
    rateCents: labourRateFor(j.payer as JobPayer, rates),
  }));
  const customerInvoice = invoices.find((i) => i.id === ro.customerInvoiceId) ?? null;
  return {
    ro,
    jobs,
    invoices,
    customerInvoice,
    customerDueCents: customerInvoice ? customerInvoice.totalInclVatCents - customerInvoice.paidCents : 0,
    entries,
    rates,
    technicians: technicians.map((t) => ({ value: t.userId, label: `${t.user.firstName} ${t.user.lastName}` })),
    operations,
    suppliers: suppliers.map((s) => ({ value: s.id, label: s.name })),
    insurers: insurers.map((c) => ({ value: c.id, label: c.displayName })),
    canEdit: ctx.can("workshop.repair_order", "edit", ro.siteId),
    canValidate: ctx.can("workshop.repair_order", "validate", ro.siteId),
    canClock: ctx.can("workshop.clocking", "create", ro.siteId),
  };
}

/** Data for the check-in form: the site, its appointments due today, customers and vehicles. */
export async function getCheckInFormData(ctx: ServiceContext, a: { appointmentId?: string | null; vehicleId?: string | null; siteId?: string | null }) {
  ctx.require("workshop.repair_order", "create");
  const siteId = await workshopSite(ctx, a.siteId);
  const sites = await ctx.tx.site.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  const appointment = a.appointmentId
    ? await ctx.tx.appointment.findUnique({ where: { id: a.appointmentId }, include: { vehicle: true, customer: { select: { id: true, displayName: true } } } })
    : null;
  const vehicle = appointment?.vehicle ?? (a.vehicleId ? await ctx.tx.vehicle.findUnique({ where: { id: a.vehicleId } }) : null);
  const [due, voStock] = await Promise.all([
    ctx.tx.appointment.findMany({
      where: { siteId: appointment?.siteId ?? siteId, date: ctx.businessDate, status: "BOOKED" },
      orderBy: { startMinute: "asc" },
      include: { vehicle: { select: { registration: true, make: true, model: true } }, customer: { select: { displayName: true } } },
    }),
    ctx.tx.vehicle.findMany({
      where: { stockType: "VO", siteId: appointment?.siteId ?? siteId, status: { in: ["INTAKE", "RECONDITIONING", "FOR_SALE", "RESERVED"] } },
      orderBy: { stockInDate: "asc" },
      select: { id: true, registration: true, vin: true, make: true, model: true, mileage: true },
    }),
  ]);
  const owner = vehicle?.ownerCustomerId ? await ctx.tx.customer.findUnique({ where: { id: vehicle.ownerCustomerId }, select: { id: true, displayName: true } }) : null;
  // A car without a known owner: the advisor picks who brings it in.
  const customers =
    vehicle && vehicle.stockType === "NONE" && !owner && !appointment
      ? (await ctx.tx.customer.findMany({ where: { kind: { in: ["INDIVIDUAL", "COMPANY"] } }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } })).map((c) => ({ value: c.id, label: c.displayName }))
      : null;
  return {
    siteId: appointment?.siteId ?? siteId,
    customers,
    sites: sites.filter((s) => ctx.can("workshop.repair_order", "create", s.id)).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
    appointment,
    vehicle,
    owner,
    due: due.map((d) => ({ id: d.id, number: d.number, startMinute: d.startMinute, label: `${d.customer.displayName} — ${d.vehicle.make} ${d.vehicle.model} ${d.vehicle.registration ?? ""}`.trim(), concern: d.concern })),
    voStock: voStock.map((v) => ({ value: v.id, label: `${v.registration ?? v.vin} — ${v.make} ${v.model} (${v.mileage} km)` })),
  };
}

/** Everything the workshop did on a car, newest first (shown on the vehicle page). */
export async function getServiceHistory(ctx: ServiceContext, vehicleId: string) {
  if (!ctx.can("workshop.repair_order", "view")) return null;
  const sites = allowedSites(ctx);
  const ros = await ctx.tx.repairOrder.findMany({
    where: { vehicleId, status: { not: "CANCELLED" }, ...(sites ? { siteId: { in: sites } } : {}) },
    orderBy: [{ openedOn: "desc" }, { number: "desc" }],
    include: {
      site: { select: { code: true } },
      jobs: { where: { status: { not: "DECLINED" } }, orderBy: { lineNo: "asc" }, select: { description: true, payer: true } },
    },
  });
  const appointments = await ctx.tx.appointment.findMany({
    where: { vehicleId, status: "BOOKED", date: { gte: ctx.businessDate }, ...(sites ? { siteId: { in: sites } } : {}) },
    orderBy: { date: "asc" },
    select: { id: true, number: true, date: true, startMinute: true, concern: true },
  });
  return { ros, appointments };
}
