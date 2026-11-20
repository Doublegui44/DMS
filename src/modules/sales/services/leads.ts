import type { ServiceContext } from "@/lib/context";
import { ConflictError, InvalidTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation";
import { nextDocumentNumber } from "@/modules/core";
import { canSetLeadStage, type LeadStage } from "../domain/workflow";
import { leadInputSchema, type LeadInput } from "../schemas/sales";
import { releaseReservation } from "./reservations";

declare module "@/lib/events" {
  interface DomainEventMap {
    LeadCreated: { leadId: string; number: string; customerId: string; source: string };
    LeadStageChanged: { leadId: string; from: string; to: string; reason: string | null };
  }
}

export async function createLead(ctx: ServiceContext, input: LeadInput) {
  const data = parseInput(leadInputSchema, input);
  ctx.require("sales.lead", "create", data.siteId);
  const site = await ctx.tx.site.findUnique({ where: { id: data.siteId } });
  if (!site) throw new NotFoundError("Site", data.siteId);
  const customer = await ctx.tx.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) throw new NotFoundError("Customer", data.customerId);
  if (customer.kind === "OEM") throw new ValidationError("A manufacturer account cannot be a sales prospect", { customerId: ["Choose a customer"] });
  const salespersonId = data.salespersonId ?? ctx.actor.userId;
  if (salespersonId && !(await ctx.tx.user.findUnique({ where: { id: salespersonId } }))) throw new NotFoundError("User", salespersonId);

  const number = await nextDocumentNumber(ctx, { docType: "LEAD", scope: data.siteId, sitePrefix: site.code });
  const lead = await ctx.tx.lead.create({
    data: {
      number,
      siteId: data.siteId,
      customerId: data.customerId,
      salespersonId,
      source: data.source,
      interest: data.interest,
      description: data.description ?? null,
      openedOn: ctx.businessDate,
    },
  });
  await ctx.audit({ action: "lead.create", entityType: "Lead", entityId: lead.id, siteId: lead.siteId, after: lead });
  await ctx.emit({
    type: "LeadCreated",
    aggregateType: "Lead",
    aggregateId: lead.id,
    siteId: lead.siteId,
    payload: { leadId: lead.id, number, customerId: lead.customerId, source: lead.source },
  });
  return lead;
}

/**
 * Manual stage change: a new lead becomes CONTACTED; any open lead can be LOST, which declines its
 * open quotes and releases their reservations. A lead with a live order must have it cancelled first.
 */
export async function setLeadStage(ctx: ServiceContext, leadId: string, to: "CONTACTED" | "LOST", reason: string | null = null) {
  const lead = await ctx.tx.lead.findUnique({ where: { id: leadId }, include: { salesOrders: true, quotes: true } });
  if (!lead) throw new NotFoundError("Lead", leadId);
  ctx.require("sales.lead", "edit", lead.siteId);
  const from = lead.stage as LeadStage;
  if (!canSetLeadStage(from, to)) throw new InvalidTransitionError("Lead", from, to);
  if (to === "LOST") {
    if (!reason || reason.trim().length < 3) throw new ValidationError("Say why the lead was lost", { reason: ["Give a reason"] });
    if (lead.salesOrders.some((o) => o.status === "CONFIRMED" || o.status === "INVOICED")) {
      throw new ConflictError("This lead has an order in progress: cancel the order instead");
    }
    await closeOpenQuotes(ctx, lead.quotes.filter((q) => ["DRAFT", "PENDING_APPROVAL", "SENT"].includes(q.status)).map((q) => q.id));
  }
  const updated = await ctx.tx.lead.update({
    where: { id: leadId },
    data: { stage: to, lostReason: to === "LOST" ? reason : lead.lostReason, closedOn: to === "LOST" ? ctx.businessDate : lead.closedOn },
  });
  await ctx.audit({ action: "lead.stage", entityType: "Lead", entityId: leadId, siteId: lead.siteId, before: { stage: from }, after: { stage: to, reason } });
  await ctx.emit({ type: "LeadStageChanged", aggregateType: "Lead", aggregateId: leadId, siteId: lead.siteId, payload: { leadId, from, to, reason } });
  return updated;
}

/** Decline open quotes and release the vehicles they reserved. */
export async function closeOpenQuotes(ctx: ServiceContext, quoteIds: string[]) {
  if (!quoteIds.length) return;
  await ctx.tx.quote.updateMany({ where: { id: { in: quoteIds } }, data: { status: "DECLINED", decidedOn: ctx.businessDate } });
  await ctx.tx.approvalRequest.updateMany({
    where: { entityType: "Quote", entityId: { in: quoteIds }, status: "PENDING" },
    data: { status: "REJECTED", comment: "Quote closed", decidedAt: ctx.businessDate },
  });
  const reservations = await ctx.tx.reservation.findMany({ where: { quoteId: { in: quoteIds }, status: "ACTIVE" } });
  for (const r of reservations) await releaseReservation(ctx, r.id, "RELEASED", { trusted: true });
}
