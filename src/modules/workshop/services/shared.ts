/** Helpers shared by the workshop services: settings, labour rates, loading and totalling repair orders. */
import type { RepairOrder } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import type { Tx } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { sumCents } from "@/lib/money";
import { getSetting } from "@/modules/core";
import { jobTotal, type LabourRates } from "../domain/pricing";

export interface WorkshopSettings {
  /** Warranty labour rate paid by each make's OEM, by brand code ("default" for the others). */
  warrantyRateCents: Record<string, number>;
  /** Internal rate charged to used-car reconditioning. */
  internalRateCents: number;
}

export async function workshopSettings(tx: Tx, siteId: string | null): Promise<WorkshopSettings> {
  return {
    warrantyRateCents: await getSetting(tx, "workshop.warrantyRateCents", siteId, { default: 8000 } as Record<string, number>),
    internalRateCents: await getSetting(tx, "workshop.internalRateCents", siteId, 6000),
  };
}

/** Labour rates for a repair order: the site's customer rate, the make's warranty rate, the internal rate. */
export async function labourRates(tx: Tx, siteId: string, brandId: string | null): Promise<LabourRates> {
  const site = await tx.site.findUnique({ where: { id: siteId }, select: { labourRateCents: true } });
  if (!site) throw new NotFoundError("Site", siteId);
  const settings = await workshopSettings(tx, siteId);
  const brand = brandId ? await tx.brand.findUnique({ where: { id: brandId }, select: { code: true } }) : null;
  return {
    customerCents: site.labourRateCents,
    warrantyCents: (brand && settings.warrantyRateCents[brand.code]) ?? settings.warrantyRateCents.default ?? 8000,
    internalCents: settings.internalRateCents,
  };
}

export const RO_INCLUDE = {
  vehicle: true,
  customer: true,
  jobs: { orderBy: { lineNo: "asc" as const }, include: { labourLines: true, partLines: { include: { part: true } }, subletLines: true } },
};

export async function loadRo(ctx: ServiceContext, id: string, action: "view" | "edit" | "validate" = "edit") {
  const ro = await ctx.tx.repairOrder.findUnique({ where: { id }, include: RO_INCLUDE });
  if (!ro) throw new NotFoundError("RepairOrder", id);
  ctx.require("workshop.repair_order", action, ro.siteId);
  return ro;
}
export type LoadedRo = Awaited<ReturnType<typeof loadRo>>;
export type LoadedJob = LoadedRo["jobs"][number];

export function requireRoStatus(ro: Pick<RepairOrder, "number" | "status">, ...allowed: RepairOrder["status"][]) {
  if (!allowed.includes(ro.status)) throw new ConflictError(`Repair order ${ro.number} is ${ro.status.toLowerCase().replace("_", " ")}`);
}

/** Recompute the RO total (jobs not declined) and the estimate of jobs still waiting for approval. */
export async function refreshTotals(ctx: ServiceContext, roId: string) {
  const jobs = await ctx.tx.roJob.findMany({ where: { roId }, include: { labourLines: true, partLines: true, subletLines: true } });
  for (const j of jobs.filter((j) => j.approval === "PENDING")) {
    await ctx.tx.roJob.update({ where: { id: j.id }, data: { estimateCents: jobTotal({ labour: j.labourLines, parts: j.partLines, sublet: j.subletLines }) } });
  }
  const live = jobs.filter((j) => j.status !== "DECLINED" && j.approval !== "DECLINED");
  const total = sumCents(live.map((j) => jobTotal({ labour: j.labourLines, parts: j.partLines, sublet: j.subletLines })));
  return ctx.tx.repairOrder.update({ where: { id: roId }, data: { totalExclVatCents: total } });
}

export async function siteCode(tx: Tx, siteId: string): Promise<string> {
  const site = await tx.site.findUnique({ where: { id: siteId }, select: { code: true } });
  if (!site) throw new NotFoundError("Site", siteId);
  return site.code;
}

/** The standard VAT rate of the site's country on a date (sublet purchases). */
export async function standardRateBp(tx: Tx, siteId: string, date: Date): Promise<number> {
  const site = await tx.site.findUnique({ where: { id: siteId } });
  if (!site) throw new NotFoundError("Site", siteId);
  const rate = await tx.vatRate.findFirst({
    where: { countryCode: site.countryCode, code: "STANDARD", validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
    orderBy: { validFrom: "desc" },
  });
  if (!rate) throw new ConflictError("No standard VAT rate is configured for this site's country");
  return rate.rateBp;
}
