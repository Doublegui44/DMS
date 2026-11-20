"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { command } from "@/lib/session";
import type { ActionResult } from "@/lib/errors";
import { formDataToObject } from "@/lib/validation";
import {
  acceptQuote,
  addVehicleCost,
  cancelOrder,
  createLead,
  createQuote,
  decideQuoteApproval,
  declineQuote,
  deliverOrder,
  invoiceOrder,
  orderForStock,
  previewQuote,
  purchaseVo,
  receiveVehicle,
  recordOrderPayment,
  releaseReservation,
  repriceVo,
  reserveQuoteVehicle,
  reviseQuote,
  setForSale,
  setLeadStage,
  shipFactoryOrder,
  startReconditioning,
  submitQuote,
  updateQuote,
  type DepositInput,
  type LeadInput,
  type QuoteInput,
  type QuotePreview,
  type VehicleCostInput,
  type VoPurchaseInput,
} from "@/modules/sales";
import type { FormState } from "@/components/shared/form";

const ok = (id: string, redirectTo?: string): FormState => ({ ok: true, data: { id, redirectTo } });
const text = (fd: FormData, key: string) => String(fd.get(key) ?? "");

function revalidateSales() {
  revalidatePath("/sales", "layout");
  revalidatePath("/dashboard");
}

// Forms that disappear once their action succeeds (the state changed) cannot run a client-side
// redirect: those actions redirect on the server instead, back to the same detail page.

// ── Leads ───────────────────────────────────────────────────

export async function createLeadAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => createLead(ctx, formDataToObject(fd) as LeadInput));
  if (!res.ok) return res;
  revalidateSales();
  return ok(res.data.id, `/sales/leads/${res.data.id}`);
}

export async function contactLeadAction(leadId: string): Promise<FormState> {
  const res = await command((ctx) => setLeadStage(ctx, leadId, "CONTACTED"));
  if (!res.ok) return res;
  revalidateSales();
  return ok(leadId);
}

export async function loseLeadAction(leadId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => setLeadStage(ctx, leadId, "LOST", text(fd, "reason")));
  if (!res.ok) return res;
  revalidateSales();
  redirect(`/sales/leads/${leadId}`);
}

// ── Quotes ──────────────────────────────────────────────────

/** Live pricing for the quote builder: nothing is saved. */
export async function previewQuoteAction(input: QuoteInput): Promise<ActionResult<QuotePreview>> {
  return command((ctx) => previewQuote(ctx, input));
}

export async function saveQuoteAction(quoteId: string | null, input: QuoteInput, send: boolean): Promise<FormState> {
  const res = await command(async (ctx) => {
    const quote = quoteId ? await updateQuote(ctx, quoteId, input) : await createQuote(ctx, input);
    return send ? submitQuote(ctx, quote.id) : quote;
  });
  if (!res.ok) return res;
  revalidateSales();
  return ok(res.data.id, `/sales/quotes/${res.data.id}`);
}

export async function submitQuoteAction(quoteId: string): Promise<FormState> {
  const res = await command((ctx) => submitQuote(ctx, quoteId));
  if (!res.ok) return res;
  revalidateSales();
  return ok(quoteId);
}

export async function reviseQuoteAction(quoteId: string): Promise<FormState> {
  const res = await command((ctx) => reviseQuote(ctx, quoteId));
  if (!res.ok) return res;
  revalidateSales();
  return ok(quoteId, `/sales/quotes/${quoteId}/edit`);
}

export async function declineQuoteAction(quoteId: string): Promise<FormState> {
  const res = await command((ctx) => declineQuote(ctx, quoteId));
  if (!res.ok) return res;
  revalidateSales();
  return ok(quoteId);
}

export async function reserveQuoteVehicleAction(quoteId: string): Promise<FormState> {
  const res = await command((ctx) => reserveQuoteVehicle(ctx, quoteId));
  if (!res.ok) return res;
  revalidateSales();
  return ok(quoteId);
}

export async function releaseReservationAction(quoteId: string, reservationId: string): Promise<FormState> {
  const res = await command((ctx) => releaseReservation(ctx, reservationId, "RELEASED"));
  if (!res.ok) return res;
  revalidateSales();
  return ok(quoteId);
}

export async function decideApprovalAction(quoteId: string, decision: "APPROVE" | "REJECT", _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => decideQuoteApproval(ctx, quoteId, decision, text(fd, "comment") || null));
  if (!res.ok) return res;
  revalidateSales();
  redirect(`/sales/quotes/${quoteId}`);
}

/** The customer signs: the quote becomes an order. */
export async function acceptQuoteAction(quoteId: string): Promise<FormState> {
  const res = await command((ctx) => acceptQuote(ctx, quoteId));
  if (!res.ok) return res;
  revalidateSales();
  return ok(res.data.id, `/sales/orders/${res.data.id}`);
}

// ── Orders ──────────────────────────────────────────────────

export async function orderPaymentAction(orderId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => recordOrderPayment(ctx, orderId, formDataToObject(fd) as DepositInput));
  if (!res.ok) return res;
  revalidateSales();
  revalidatePath("/accounting", "layout");
  redirect(`/sales/orders/${orderId}`);
}

export async function invoiceOrderAction(orderId: string): Promise<FormState> {
  const res = await command((ctx) => invoiceOrder(ctx, orderId));
  if (!res.ok) return res;
  revalidateSales();
  revalidatePath("/accounting", "layout");
  return ok(orderId);
}

export async function deliverOrderAction(orderId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => deliverOrder(ctx, orderId, { mileage: text(fd, "mileage"), registration: text(fd, "registration") }));
  if (!res.ok) return res;
  revalidateSales();
  redirect(`/sales/orders/${orderId}`);
}

export async function cancelOrderAction(orderId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => cancelOrder(ctx, orderId, text(fd, "reason")));
  if (!res.ok) return res;
  revalidateSales();
  revalidatePath("/accounting", "layout");
  redirect(`/sales/orders/${orderId}`);
}

// ── New-vehicle stock ───────────────────────────────────────

export async function orderForStockAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) =>
    orderForStock(ctx, {
      siteId: text(fd, "siteId"),
      catalogueVersionId: text(fd, "catalogueVersionId"),
      optionIds: fd.getAll("optionIds").map(String),
      colour: text(fd, "colour"),
    }),
  );
  if (!res.ok) return res;
  revalidateSales();
  return ok(res.data.vehicleId, `/sales/vn-stock/${res.data.vehicleId}`);
}

export async function shipFactoryOrderAction(vehicleId: string, factoryOrderId: string): Promise<FormState> {
  const res = await command((ctx) => shipFactoryOrder(ctx, factoryOrderId));
  if (!res.ok) return res;
  revalidateSales();
  return ok(vehicleId);
}

export async function receiveVehicleAction(vehicleId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => receiveVehicle(ctx, vehicleId, { costCents: text(fd, "costCents") }));
  if (!res.ok) return res;
  revalidateSales();
  revalidatePath("/accounting", "layout");
  redirect(`/sales/vn-stock/${vehicleId}`);
}

// ── Used-vehicle stock ──────────────────────────────────────

/** "vehicle.vin" style form keys → nested object. */
function nest(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const [head, ...rest] = key.split(".");
    if (!rest.length) out[head] = value;
    else out[head] = { ...((out[head] as Record<string, unknown>) ?? {}), [rest.join(".")]: value };
  }
  return out;
}

export async function purchaseVoAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => purchaseVo(ctx, nest(formDataToObject(fd)) as unknown as VoPurchaseInput));
  if (!res.ok) return res;
  revalidateSales();
  revalidatePath("/accounting", "layout");
  return ok(res.data.vehicle.id, `/sales/vo-stock/${res.data.vehicle.id}`);
}

export async function addVehicleCostAction(vehicleId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => addVehicleCost(ctx, vehicleId, formDataToObject(fd) as VehicleCostInput));
  if (!res.ok) return res;
  revalidateSales();
  revalidatePath("/accounting", "layout");
  redirect(`/sales/vo-stock/${vehicleId}`);
}

export async function startReconditioningAction(vehicleId: string): Promise<FormState> {
  const res = await command((ctx) => startReconditioning(ctx, vehicleId));
  if (!res.ok) return res;
  revalidateSales();
  return ok(vehicleId);
}

export async function setForSaleAction(vehicleId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => setForSale(ctx, vehicleId, { listPriceCents: text(fd, "listPriceCents") }));
  if (!res.ok) return res;
  revalidateSales();
  redirect(`/sales/vo-stock/${vehicleId}`);
}

export async function repriceVoAction(vehicleId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => repriceVo(ctx, vehicleId, { listPriceCents: text(fd, "listPriceCents"), reason: text(fd, "reason") }));
  if (!res.ok) return res;
  revalidateSales();
  redirect(`/sales/vo-stock/${vehicleId}`);
}
