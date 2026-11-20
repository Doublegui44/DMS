"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { command } from "@/lib/session";
import { formDataToObject } from "@/lib/validation";
import {
  addCounterLine,
  addPurchaseOrderLine,
  cancelCounterSale,
  cancelCycleCount,
  cancelPurchaseOrder,
  closePurchaseOrder,
  confirmCounterSale,
  createCounterSale,
  createCycleCount,
  createPart,
  createPurchaseOrder,
  createSuggestedOrders,
  decideSupplierInvoice,
  invoiceCounterSale,
  paySupplierInvoice,
  postCycleCount,
  receivePurchaseOrder,
  recordCounts,
  recordSupplierInvoice,
  removeCounterLine,
  removePurchaseOrderLine,
  removeSupersession,
  sendPurchaseOrder,
  setDiscountRates,
  setStockLevels,
  supersedePart,
  transferStock,
  updatePart,
  PRICE_CLASSES,
  type CounterInvoiceInput,
  type CounterLineInput,
  type CounterSaleInput,
  type CycleCountInput,
  type PartInput,
  type PurchaseLineInput,
  type PurchaseOrderInput,
  type StockLevelsInput,
  type SupersessionInput,
  type SupplierPaymentInput,
} from "@/modules/parts";
import type { FormState } from "@/components/shared/form";

const ok = (id: string, redirectTo?: string): FormState => ({ ok: true, data: { id, redirectTo } });
const text = (fd: FormData, key: string) => String(fd.get(key) ?? "");

function revalidateParts() {
  revalidatePath("/parts", "layout");
  revalidatePath("/dashboard");
}

/**
 * Inputs of a table form are named `<field>__<rowId>`; this regroups them per row, in page order.
 * Rows where every listed field is empty are dropped.
 */
function rowsFrom(fd: FormData, fields: string[]): ({ id: string } & Record<string, string>)[] {
  const rows = new Map<string, Record<string, string>>();
  for (const [key, value] of fd.entries()) {
    const m = /^([A-Za-z]+)__(.+)$/.exec(key);
    if (!m || !fields.includes(m[1])) continue;
    const row = rows.get(m[2]) ?? {};
    row[m[1]] = String(value);
    rows.set(m[2], row);
  }
  return [...rows.entries()].map(([id, values]): { id: string } & Record<string, string> => ({ ...values, id })).filter((r) => fields.some((f) => (r[f] ?? "").trim() !== ""));
}

// ── Catalogue ───────────────────────────────────────────────

export async function createPartAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => createPart(ctx, formDataToObject(fd) as PartInput));
  if (!res.ok) return res;
  revalidateParts();
  return ok(res.data.id, `/parts/catalogue/${res.data.id}`);
}

export async function updatePartAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => updatePart(ctx, id, { ...(formDataToObject(fd) as PartInput), active: fd.get("active") === "on" }));
  if (!res.ok) return res;
  revalidateParts();
  return ok(id, `/parts/catalogue/${id}`);
}

export async function supersedePartAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => supersedePart(ctx, id, formDataToObject(fd) as SupersessionInput));
  if (!res.ok) return res;
  revalidateParts();
  return ok(id);
}

export async function removeSupersessionAction(id: string): Promise<FormState> {
  const res = await command((ctx) => removeSupersession(ctx, id));
  if (!res.ok) return res;
  revalidateParts();
  return ok(id);
}

export async function saveDiscountMatrixAction(_prev: FormState, fd: FormData): Promise<FormState> {
  // One row per discount code, one input per price class (`TRADE__<discountCodeId>` = "25" %).
  const rates = rowsFrom(fd, [...PRICE_CLASSES]).flatMap((r) =>
    PRICE_CLASSES.filter((c) => r[c] !== undefined).map((priceClass) => ({ discountCodeId: r.id, priceClass, discountBp: r[priceClass] })),
  );
  const res = await command((ctx) => setDiscountRates(ctx, { rates }));
  if (!res.ok) return res;
  revalidateParts();
  return ok("matrix");
}

// ── Stock ───────────────────────────────────────────────────

export async function setStockLevelsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => setStockLevels(ctx, formDataToObject(fd) as StockLevelsInput));
  if (!res.ok) return res;
  revalidateParts();
  return ok(res.data.id);
}

export async function transferStockAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const lines = rowsFrom(fd, ["partNumber", "qty"]).map((r) => ({ partNumber: r.partNumber ?? "", qty: r.qty ?? "" }));
  const res = await command((ctx) =>
    transferStock(ctx, { fromSiteId: text(fd, "fromSiteId"), toSiteId: text(fd, "toSiteId"), notes: text(fd, "notes"), lines }),
  );
  if (!res.ok) return res;
  revalidateParts();
  return ok(res.data.id, `/parts/stock/transfers/${res.data.id}`);
}

// ── Purchasing ──────────────────────────────────────────────

export async function createPurchaseOrderAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => createPurchaseOrder(ctx, formDataToObject(fd) as PurchaseOrderInput));
  if (!res.ok) return res;
  revalidateParts();
  return ok(res.data.id, `/parts/purchasing/${res.data.id}`);
}

export async function createSuggestedOrdersAction(siteId: string, stockItemIds: string[]): Promise<FormState> {
  const res = await command((ctx) => createSuggestedOrders(ctx, { siteId, stockItemIds }));
  if (!res.ok) return res;
  revalidateParts();
  const [first] = res.data;
  return ok(first.id, res.data.length === 1 ? `/parts/purchasing/${first.id}` : "/parts/purchasing?status=DRAFT");
}

export async function addPurchaseLineAction(poId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => addPurchaseOrderLine(ctx, poId, formDataToObject(fd) as PurchaseLineInput));
  if (!res.ok) return res;
  revalidateParts();
  return ok(poId);
}

export async function removePurchaseLineAction(poId: string, lineId: string): Promise<FormState> {
  const res = await command((ctx) => removePurchaseOrderLine(ctx, poId, lineId));
  if (!res.ok) return res;
  revalidateParts();
  return ok(poId);
}

export async function sendPurchaseOrderAction(poId: string): Promise<FormState> {
  const res = await command((ctx) => sendPurchaseOrder(ctx, poId));
  if (!res.ok) return res;
  revalidateParts();
  return ok(poId);
}

export async function receivePurchaseOrderAction(poId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const lines = rowsFrom(fd, ["qty"]).map((r) => ({ poLineId: r.id, qty: r.qty }));
  const res = await command((ctx) => receivePurchaseOrder(ctx, poId, { deliveryNote: text(fd, "deliveryNote"), lines }));
  if (!res.ok) return res;
  revalidateParts();
  revalidatePath("/accounting", "layout");
  redirect(`/parts/purchasing/${poId}`);
}

export async function closePurchaseOrderAction(poId: string): Promise<FormState> {
  const res = await command((ctx) => closePurchaseOrder(ctx, poId));
  if (!res.ok) return res;
  revalidateParts();
  return ok(poId);
}

export async function cancelPurchaseOrderAction(poId: string): Promise<FormState> {
  const res = await command((ctx) => cancelPurchaseOrder(ctx, poId));
  if (!res.ok) return res;
  revalidateParts();
  return ok(poId);
}

export async function recordSupplierInvoiceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  // Only the receipt lines that are ticked are billed by this invoice.
  const picked = new Set(fd.getAll("bill").map(String));
  const lines = rowsFrom(fd, ["qty", "price"])
    .filter((r) => picked.has(r.id))
    .map((r) => ({ receiptLineId: r.id, qty: r.qty ?? "", unitCostCents: r.price === "" ? undefined : r.price }));
  const res = await command((ctx) =>
    recordSupplierInvoice(ctx, {
      siteId: text(fd, "siteId"),
      supplierId: text(fd, "supplierId"),
      supplierReference: text(fd, "supplierReference"),
      invoiceDate: text(fd, "invoiceDate"),
      notes: text(fd, "notes"),
      lines: lines as never,
    }),
  );
  if (!res.ok) return res;
  revalidateParts();
  revalidatePath("/accounting", "layout");
  return ok(res.data.id, `/parts/purchasing/invoices/${res.data.id}`);
}

export async function decideSupplierInvoiceAction(id: string, decision: "APPROVE" | "REJECT", _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => decideSupplierInvoice(ctx, id, decision, text(fd, "notes") || null));
  if (!res.ok) return res;
  revalidateParts();
  revalidatePath("/accounting", "layout");
  redirect(`/parts/purchasing/invoices/${id}`);
}

export async function paySupplierInvoiceAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => paySupplierInvoice(ctx, id, formDataToObject(fd) as SupplierPaymentInput));
  if (!res.ok) return res;
  revalidateParts();
  revalidatePath("/accounting", "layout");
  redirect(`/parts/purchasing/invoices/${id}`);
}

// ── Counter sales ───────────────────────────────────────────

export async function createCounterSaleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => createCounterSale(ctx, formDataToObject(fd) as CounterSaleInput));
  if (!res.ok) return res;
  revalidateParts();
  return ok(res.data.id, `/parts/counter/${res.data.id}`);
}

export async function addCounterLineAction(saleId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => addCounterLine(ctx, saleId, formDataToObject(fd) as CounterLineInput));
  if (!res.ok) return res;
  revalidateParts();
  return ok(saleId);
}

export async function removeCounterLineAction(saleId: string, lineId: string): Promise<FormState> {
  const res = await command((ctx) => removeCounterLine(ctx, saleId, lineId));
  if (!res.ok) return res;
  revalidateParts();
  return ok(saleId);
}

export async function confirmCounterSaleAction(saleId: string): Promise<FormState> {
  const res = await command((ctx) => confirmCounterSale(ctx, saleId));
  if (!res.ok) return res;
  revalidateParts();
  return ok(saleId);
}

export async function invoiceCounterSaleAction(saleId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => invoiceCounterSale(ctx, saleId, formDataToObject(fd) as CounterInvoiceInput));
  if (!res.ok) return res;
  revalidateParts();
  revalidatePath("/accounting", "layout");
  redirect(`/parts/counter/${saleId}`);
}

export async function cancelCounterSaleAction(saleId: string): Promise<FormState> {
  const res = await command((ctx) => cancelCounterSale(ctx, saleId));
  if (!res.ok) return res;
  revalidateParts();
  return ok(saleId);
}

// ── Inventory ───────────────────────────────────────────────

export async function createCycleCountAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const res = await command((ctx) => createCycleCount(ctx, formDataToObject(fd) as CycleCountInput));
  if (!res.ok) return res;
  revalidateParts();
  return ok(res.data.id, `/parts/inventory/${res.data.id}`);
}

/** Save the count sheet; with `post`, post it right after (same transaction). */
export async function saveCountsAction(countId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const post = fd.get("intent") === "post";
  const lines: { lineId: string; countedQty: string | null }[] = [];
  for (const [key, value] of fd.entries()) {
    const m = /^counted__(.+)$/.exec(key);
    if (m) lines.push({ lineId: m[1], countedQty: String(value).trim() === "" ? null : String(value) });
  }
  const res = await command(async (ctx) => {
    await recordCounts(ctx, countId, { lines });
    if (post) await postCycleCount(ctx, countId);
    return countId;
  });
  if (!res.ok) return res;
  revalidateParts();
  if (post) revalidatePath("/accounting", "layout");
  return ok(countId);
}

export async function cancelCycleCountAction(countId: string): Promise<FormState> {
  const res = await command((ctx) => cancelCycleCount(ctx, countId));
  if (!res.ok) return res;
  revalidateParts();
  return ok(countId);
}
