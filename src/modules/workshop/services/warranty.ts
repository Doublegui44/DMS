/**
 * Warranty claims: each warranty job is invoiced to the make's OEM account (411100) at invoicing.
 * Accepted claims wait for the OEM's remittance; a rejected claim is credited in full.
 */
import type { ServiceContext } from "@/lib/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { sumCents } from "@/lib/money";
import { parseInput } from "@/lib/validation";
import { creditInvoice, recordPayment } from "@/modules/accounting";
import { claimDecisionInputSchema, warrantyRemittanceInputSchema, type ClaimDecisionInput, type WarrantyRemittanceInput } from "../schemas/workshop";

declare module "@/lib/events" {
  interface DomainEventMap {
    WarrantyClaimDecided: { claimId: string; number: string; status: "ACCEPTED" | "REJECTED"; claimedCents: number };
    WarrantyClaimsPaid: { claimIds: string[]; amountCents: number; paymentId: string };
  }
}

export async function decideWarrantyClaim(ctx: ServiceContext, claimId: string, input: ClaimDecisionInput) {
  const data = parseInput(claimDecisionInputSchema, input);
  const claim = await ctx.tx.warrantyClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new NotFoundError("WarrantyClaim", claimId);
  ctx.require("workshop.warranty", "validate", claim.siteId);
  if (claim.status !== "SUBMITTED") throw new ConflictError(`Claim ${claim.number} is ${claim.status.toLowerCase()}`);
  let creditNoteId: string | null = null;
  if (data.decision === "REJECTED") {
    const credit = await creditInvoice(ctx, claim.invoiceId, `Warranty claim ${claim.number} rejected${data.notes ? `: ${data.notes}` : ""}`, { trusted: true });
    creditNoteId = credit.id;
  }
  const saved = await ctx.tx.warrantyClaim.update({ where: { id: claimId }, data: { status: data.decision, decidedOn: ctx.businessDate, notes: data.notes ?? null, creditNoteId } });
  await ctx.audit({ action: `warranty_claim.${data.decision.toLowerCase()}`, entityType: "WarrantyClaim", entityId: claimId, before: { status: claim.status }, after: { status: data.decision, notes: data.notes, creditNoteId }, siteId: claim.siteId });
  await ctx.emit({
    type: "WarrantyClaimDecided",
    aggregateType: "RepairOrder",
    aggregateId: claim.roId,
    siteId: claim.siteId,
    payload: { claimId, number: claim.number, status: data.decision, claimedCents: claim.claimedCents },
  });
  return saved;
}

/** The OEM pays a batch of claims by transfer: one receipt allocated to their invoices. */
export async function recordWarrantyRemittance(ctx: ServiceContext, input: WarrantyRemittanceInput) {
  const data = parseInput(warrantyRemittanceInputSchema, input);
  ctx.require("workshop.warranty", "validate", data.siteId);
  const claims = await ctx.tx.warrantyClaim.findMany({ where: { id: { in: data.claimIds } }, include: { invoice: true } });
  if (claims.length !== data.claimIds.length) throw new NotFoundError("WarrantyClaim", data.claimIds.join(","));
  if (claims.some((c) => c.siteId !== data.siteId)) throw new ValidationError("Claims of another site", { claimIds: ["One site at a time"] });
  if (claims.some((c) => c.status !== "SUBMITTED" && c.status !== "ACCEPTED")) throw new ConflictError("Only open claims can be paid");
  const oems = new Set(claims.map((c) => c.invoice.customerId));
  if (oems.size !== 1) throw new ValidationError("One manufacturer per remittance", { claimIds: ["Several makes selected"] });
  const allocations = claims.map((c) => ({ invoiceId: c.invoiceId, amountCents: c.invoice.totalInclVatCents - c.invoice.paidCents })).filter((a) => a.amountCents > 0);
  const amountCents = sumCents(allocations.map((a) => a.amountCents));
  if (amountCents <= 0) throw new ConflictError("Nothing left to pay on these claims");
  const payment = await recordPayment(
    ctx,
    { siteId: data.siteId, direction: "IN", method: "TRANSFER", customerId: [...oems][0], amountCents, reference: data.reference ?? `Warranty ${claims.map((c) => c.number).join(", ")}`.slice(0, 120), allocations },
    { trusted: true },
  );
  await ctx.tx.warrantyClaim.updateMany({ where: { id: { in: data.claimIds } }, data: { status: "PAID", paidOn: ctx.businessDate } });
  for (const c of claims) {
    await ctx.audit({ action: "warranty_claim.paid", entityType: "WarrantyClaim", entityId: c.id, before: { status: c.status }, after: { status: "PAID", paymentId: payment.id }, siteId: c.siteId });
  }
  await ctx.emit({ type: "WarrantyClaimsPaid", aggregateType: "Site", aggregateId: data.siteId, siteId: data.siteId, payload: { claimIds: data.claimIds, amountCents, paymentId: payment.id } });
  return payment;
}
