import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { addDays } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { orderBy, pageArgs, type ListParams } from "@/lib/list";
import { pipelineStage, PIPELINE_STAGES, type PipelineStage } from "../domain/workflow";

export const LEAD_SORTS = ["number", "openedOn", "stage", "updatedAt"] as const;

function siteScope(ctx: ServiceContext, siteId?: string | null): Prisma.LeadWhereInput {
  if (siteId) return { siteId };
  return ctx.actor.siteIds === "ALL" ? {} : { siteId: { in: ctx.actor.siteIds } };
}

const dealInclude = {
  customer: { select: { id: true, displayName: true } },
  salesperson: { select: { id: true, firstName: true, lastName: true } },
  site: { select: { code: true } },
  quotes: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      number: true,
      status: true,
      totalInclVatCents: true,
      vehicle: { select: { make: true, model: true, version: true } },
      catalogueVersion: { select: { name: true, model: { select: { name: true, brand: { select: { name: true } } } } } },
    },
  },
  salesOrders: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, number: true, status: true, totalInclVatCents: true } },
} satisfies Prisma.LeadInclude;

type LeadRow = Prisma.LeadGetPayload<{ include: typeof dealInclude }>;

export interface PipelineCard {
  leadId: string;
  leadNumber: string;
  customer: { id: string; name: string };
  salesperson: string | null;
  interest: string;
  source: string;
  openedOn: Date;
  vehicle: string | null;
  quote: { id: string; number: string; status: string; totalInclVatCents: number } | null;
  order: { id: string; number: string; status: string; totalInclVatCents: number } | null;
  stage: PipelineStage;
}

function toCard(l: LeadRow): PipelineCard {
  const q = l.quotes[0] ?? null;
  const o = l.salesOrders[0] ?? null;
  const vehicle = q?.vehicle
    ? `${q.vehicle.make} ${q.vehicle.model}`
    : q?.catalogueVersion
      ? `${q.catalogueVersion.model.brand.name} ${q.catalogueVersion.model.name}`
      : null;
  return {
    leadId: l.id,
    leadNumber: l.number,
    customer: { id: l.customer.id, name: l.customer.displayName },
    salesperson: l.salesperson ? `${l.salesperson.firstName} ${l.salesperson.lastName}` : null,
    interest: l.interest,
    source: l.source,
    openedOn: l.openedOn,
    vehicle,
    quote: q ? { id: q.id, number: q.number, status: q.status, totalInclVatCents: q.totalInclVatCents } : null,
    order: o ? { id: o.id, number: o.number, status: o.status, totalInclVatCents: o.totalInclVatCents } : null,
    stage: pipelineStage({ stage: l.stage }, o),
  };
}

/**
 * Kanban: open leads plus the ones closed in the last 45 days, grouped by derived stage
 * (a won lead follows its order: ordered → invoiced → delivered).
 */
export async function getPipeline(ctx: ServiceContext, opts: { siteId?: string | null; mine?: boolean; q?: string }) {
  ctx.require("sales.lead", "view", opts.siteId);
  const since = addDays(ctx.businessDate, -45);
  const and: Prisma.LeadWhereInput[] = [siteScope(ctx, opts.siteId), { OR: [{ closedOn: null }, { closedOn: { gte: since } }] }];
  if (opts.mine && ctx.actor.userId) and.push({ salespersonId: ctx.actor.userId });
  if (opts.q) and.push({ OR: [{ number: { contains: opts.q, mode: "insensitive" } }, { customer: { displayName: { contains: opts.q, mode: "insensitive" } } }] });
  const leads = await ctx.tx.lead.findMany({ where: { AND: and }, include: dealInclude, orderBy: { updatedAt: "desc" }, take: 500 });
  const cards = leads.map(toCard);
  // A delivered deal leaves the board 45 days after delivery like any closed lead; orders keep the lead open until then.
  return PIPELINE_STAGES.map((stage) => {
    const inStage = cards.filter((c) => c.stage === stage);
    const amount = inStage.reduce((s, c) => s + (c.order?.totalInclVatCents ?? c.quote?.totalInclVatCents ?? 0), 0);
    return { stage, cards: inStage, count: inStage.length, amountCents: amount };
  });
}

function leadWhere(ctx: ServiceContext, p: ListParams): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [siteScope(ctx, p.filters.site)];
  if (p.q) and.push({ OR: [{ number: { contains: p.q, mode: "insensitive" } }, { customer: { displayName: { contains: p.q, mode: "insensitive" } } }] });
  if (p.filters.stage) and.push({ stage: p.filters.stage as Prisma.LeadWhereInput["stage"] });
  if (p.filters.source) and.push({ source: p.filters.source as Prisma.LeadWhereInput["source"] });
  if (p.filters.interest) and.push({ interest: p.filters.interest as Prisma.LeadWhereInput["interest"] });
  if (p.filters.mine === "1" && ctx.actor.userId) and.push({ salespersonId: ctx.actor.userId });
  return { AND: and };
}

export async function listLeads(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("sales.lead", "view");
  const where = leadWhere(ctx, p);
  const [rows, total] = await Promise.all([
    ctx.tx.lead.findMany({ where, include: dealInclude, orderBy: orderBy(p, LEAD_SORTS, "updatedAt"), ...pageArgs(p, opts.all) }),
    ctx.tx.lead.count({ where }),
  ]);
  return { rows: rows.map((l) => ({ ...toCard(l), site: l.site.code, closedOn: l.closedOn, lostReason: l.lostReason, rawStage: l.stage })), total, page: p.page, pageSize: p.pageSize };
}

export async function getLead(ctx: ServiceContext, id: string) {
  const lead = await ctx.tx.lead.findUnique({
    where: { id },
    include: {
      customer: true,
      site: true,
      salesperson: { select: { id: true, firstName: true, lastName: true } },
      quotes: {
        orderBy: { createdAt: "desc" },
        include: {
          vehicle: { select: { id: true, make: true, model: true, version: true, vin: true } },
          catalogueVersion: { select: { name: true, model: { select: { name: true, brand: { select: { name: true } } } } } },
        },
      },
      salesOrders: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!lead) throw new NotFoundError("Lead", id);
  ctx.require("sales.lead", "view", lead.siteId);
  return lead;
}

/** Choices for a new lead: customers (not OEM accounts) and the people who sell. */
export async function getLeadFormData(ctx: ServiceContext) {
  ctx.require("sales.lead", "create");
  const [customers, sellers] = await Promise.all([
    ctx.tx.customer.findMany({
      where: { kind: { in: ["INDIVIDUAL", "COMPANY"] } },
      select: { id: true, number: true, displayName: true, city: true },
      orderBy: { displayName: "asc" },
    }),
    ctx.tx.user.findMany({
      where: {
        active: true,
        roles: {
          some: {
            role: { key: { in: ["SALESPERSON", "SALES_MANAGER"] } },
            ...(ctx.actor.siteIds === "ALL" ? {} : { siteId: { in: ctx.actor.siteIds } }),
          },
        },
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ]);
  return {
    customers: customers.map((c) => ({ value: c.id, label: `${c.displayName}${c.city ? ` — ${c.city}` : ""} (${c.number})` })),
    salespeople: sellers.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` })),
  };
}
