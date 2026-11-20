/** Sales workflow rules (pure): quote lifecycle, discount approval, pipeline stages, reservations. */
import { addDays } from "@/lib/dates";

export type QuoteStatus = "DRAFT" | "PENDING_APPROVAL" | "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED";
export type LeadStage = "NEW" | "CONTACTED" | "QUOTED" | "WON" | "LOST";
export type SalesOrderStatus = "CONFIRMED" | "INVOICED" | "DELIVERED" | "CANCELLED";

// ── Quote lifecycle ──────────────────────────────────────────

const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "SENT"],
  PENDING_APPROVAL: ["SENT", "DRAFT"], // approved → sent; rejected → back to draft
  SENT: ["ACCEPTED", "DECLINED", "EXPIRED", "DRAFT"], // DRAFT = revised
  EXPIRED: ["DRAFT"],
  ACCEPTED: [],
  DECLINED: [],
};

export function canQuoteTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

/** Lines and amounts can change only while the quote is a draft. */
export function isQuoteEditable(status: QuoteStatus): boolean {
  return status === "DRAFT";
}

/** Valid until the end of `createdOn + validityDays`. */
export function quoteValidUntil(createdOn: Date, validityDays: number): Date {
  return addDays(createdOn, validityDays);
}

export function isPastDate(limit: Date, businessDate: Date): boolean {
  return businessDate.getTime() > limit.getTime();
}

// ── Discount approval (business assumption 7) ────────────────

export interface ApprovalRuleDef {
  id: string;
  thresholdBp: number;
  roleKey: string;
}

/** The rule that applies: the highest threshold strictly exceeded by the effective discount. */
export function requiredApproval<R extends ApprovalRuleDef>(discountBp: number, rules: R[]): R | null {
  let found: R | null = null;
  for (const r of rules) {
    if (discountBp > r.thresholdBp && (!found || r.thresholdBp > found.thresholdBp)) found = r;
  }
  return found;
}

/**
 * Who may approve: the rule's role, any role carrying a higher threshold (a Dealer Principal can
 * approve what a Sales Manager can), or an administrator.
 */
export function canApproveRule(rule: ApprovalRuleDef, rules: ApprovalRuleDef[], roleKeys: string[]): boolean {
  if (roleKeys.includes("ADMIN") || roleKeys.includes("SYSTEM")) return true;
  const allowed = new Set(rules.filter((r) => r.thresholdBp >= rule.thresholdBp).map((r) => r.roleKey));
  return roleKeys.some((k) => allowed.has(k));
}

// ── Pipeline (kanban) ────────────────────────────────────────

export const PIPELINE_STAGES = ["NEW", "CONTACTED", "QUOTED", "ORDERED", "INVOICED", "DELIVERED", "LOST"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Kanban column of a lead: its own stage until it has a live order, then the order's progress. */
export function pipelineStage(lead: { stage: LeadStage }, order: { status: SalesOrderStatus } | null): PipelineStage {
  if (lead.stage === "LOST") return "LOST";
  if (order && order.status !== "CANCELLED") {
    return order.status === "CONFIRMED" ? "ORDERED" : order.status;
  }
  if (lead.stage === "WON") return "ORDERED";
  return lead.stage;
}

/** Lead stages a salesperson can set by hand (WON comes from an accepted quote, QUOTED from a quote). */
export function canSetLeadStage(from: LeadStage, to: LeadStage): boolean {
  if (from === "WON" || from === "LOST") return false;
  if (to === "CONTACTED") return from === "NEW";
  return to === "LOST";
}

// ── Reservations and vehicle release ─────────────────────────

/** A reservation taken on day D for N days is valid through D + N, expired the day after. */
export function reservationExpiresOn(reservedOn: Date, days: number): Date {
  return addDays(reservedOn, days);
}

/**
 * Where a vehicle goes back when its reservation or order is released: a used car is for sale
 * again; a new car is in stock once it has arrived, otherwise back to its factory-order status.
 */
export function releasedStatus(v: { stockType: "VN" | "VO"; stockInDate: Date | null; inTransit?: boolean }): "FOR_SALE" | "IN_STOCK" | "IN_TRANSIT" | "ORDERED" {
  if (v.stockType === "VO") return "FOR_SALE";
  if (v.stockInDate) return "IN_STOCK";
  return v.inTransit ? "IN_TRANSIT" : "ORDERED";
}

// ── Order guards ─────────────────────────────────────────────

export type GuardResult = { ok: true } | { ok: false; reason: string };

export function canInvoiceOrder(o: { status: SalesOrderStatus; vehicleInStock: boolean }): GuardResult {
  if (o.status !== "CONFIRMED") return { ok: false, reason: `Order is ${o.status.toLowerCase()}` };
  if (!o.vehicleInStock) return { ok: false, reason: "The vehicle has not arrived in stock yet" };
  return { ok: true };
}

/** Payment check before delivery: the invoice must be fully settled (cash, finance company, trade-in). */
export function canDeliverOrder(o: { status: SalesOrderStatus; invoiceTotalCents: number; invoicePaidCents: number }): GuardResult {
  if (o.status !== "INVOICED") return { ok: false, reason: o.status === "CONFIRMED" ? "Invoice the order before delivery" : `Order is ${o.status.toLowerCase()}` };
  const due = o.invoiceTotalCents - o.invoicePaidCents;
  if (due > 0) return { ok: false, reason: `€${(due / 100).toFixed(2)} still due on the invoice` };
  return { ok: true };
}

export function canCancelOrder(o: { status: SalesOrderStatus }): GuardResult {
  if (o.status === "CONFIRMED") return { ok: true };
  if (o.status === "INVOICED") return { ok: false, reason: "The order is invoiced: issue a credit note from accounting first" };
  return { ok: false, reason: `Order is ${o.status.toLowerCase()}` };
}

/** Police register description of a vehicle. */
export function vehicleDescription(v: { make: string; model: string; version: string }): string {
  return `${v.make} ${v.model} ${v.version}`.trim();
}
