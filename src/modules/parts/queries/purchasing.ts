/** Purchasing reads: orders, suggestions, receipts to invoice, supplier invoices. */
import type { Prisma } from "@prisma/client";
import type { ServiceContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { sumCents } from "@/lib/money";
import { pageArgs, type ListParams } from "@/lib/list";
import { backorderQty } from "../domain/purchasing";
import { dec, valueOf } from "../domain/valuation";
import { partsSettings } from "../services/shared";
import { replenishmentSuggestions } from "../services/purchasing";
import { allowedSites, dateRange, siteWhere } from "./scope";

export const PO_SORTS = ["number", "createdOn", "expectedOn", "status"] as const;

export async function listPurchaseOrders(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("parts.purchase_order", "view");
  const w: Prisma.PurchaseOrderWhereInput = { ...(siteWhere(ctx, p) as Prisma.PurchaseOrderWhereInput) };
  if (p.filters.status === "OPEN") w.status = { in: ["DRAFT", "SENT", "PARTIAL"] };
  else if (p.filters.status) w.status = p.filters.status as Prisma.PurchaseOrderWhereInput["status"];
  if (p.filters.kind) w.kind = p.filters.kind as Prisma.PurchaseOrderWhereInput["kind"];
  if (p.filters.supplier) w.supplierId = p.filters.supplier;
  if (p.q) w.OR = [{ number: { contains: p.q, mode: "insensitive" } }, { supplier: { name: { contains: p.q, mode: "insensitive" } } }];
  const range = dateRange(p);
  if (range) w.createdOn = range;
  const sort = (PO_SORTS as readonly string[]).includes(p.sort ?? "") ? p.sort! : "createdOn";
  const [rows, total] = await Promise.all([
    ctx.tx.purchaseOrder.findMany({
      where: w,
      orderBy: [{ [sort]: p.dir }, { number: "desc" }],
      ...pageArgs(p, opts.all),
      include: {
        supplier: { select: { id: true, name: true } },
        site: { select: { code: true } },
        lines: { select: { qtyOrdered: true, qtyReceived: true, unitCostCents: true } },
      },
    }),
    ctx.tx.purchaseOrder.count({ where: w }),
  ]);
  return {
    rows: rows.map((po) => ({
      ...po,
      valueCents: sumCents(po.lines.map((l) => valueOf(dec(l.qtyOrdered), l.unitCostCents))),
      lineCount: po.lines.length,
      late: !!po.expectedOn && ["SENT", "PARTIAL"].includes(po.status) && po.expectedOn.getTime() < ctx.businessDate.getTime(),
    })),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}

export async function getPurchaseOrder(ctx: ServiceContext, id: string) {
  const po = await ctx.tx.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      site: { select: { id: true, code: true, name: true } },
      lines: { orderBy: { lineNo: "asc" }, include: { part: { select: { id: true, partNumber: true, description: true, unit: true } } } },
      receipts: { orderBy: { createdAt: "asc" }, include: { lines: { include: { poLine: { select: { lineNo: true } } } } } },
    },
  });
  if (!po) throw new NotFoundError("PurchaseOrder", id);
  ctx.require("parts.purchase_order", "view", po.siteId);
  const receiptIds = po.receipts.map((r) => r.id);
  const entries = receiptIds.length
    ? await ctx.tx.journalEntry.findMany({ where: { sourceType: "GOODS_RECEIPT", sourceId: { in: receiptIds } }, select: { id: true, number: true, journalCode: true, sourceId: true } })
    : [];
  return {
    po,
    lines: po.lines.map((l) => ({ ...l, backorder: backorderQty({ ordered: l.qtyOrdered, received: l.qtyReceived }), valueCents: valueOf(dec(l.qtyOrdered), l.unitCostCents) })),
    valueCents: sumCents(po.lines.map((l) => valueOf(dec(l.qtyOrdered), l.unitCostCents))),
    entries,
    canEdit: ctx.can("parts.purchase_order", "edit", po.siteId),
  };
}

/** Suggested orders at a site, grouped by supplier. */
export async function getSuggestions(ctx: ServiceContext, siteId: string) {
  ctx.require("parts.purchase_order", "view", siteId);
  const rows = await replenishmentSuggestions(ctx.tx, siteId, ctx.businessDate);
  const groups = new Map<string, { supplier: { id: string; name: string }; rows: typeof rows; valueCents: number }>();
  for (const r of rows) {
    const g = groups.get(r.part.supplierId) ?? { supplier: { id: r.part.supplier.id, name: r.part.supplier.name }, rows: [], valueCents: 0 };
    g.rows.push(r);
    g.valueCents += r.valueCents;
    groups.set(r.part.supplierId, g);
  }
  return { groups: [...groups.values()], count: rows.length, canCreate: ctx.can("parts.purchase_order", "create", siteId) };
}

export async function getPurchaseOrderFormData(ctx: ServiceContext) {
  ctx.require("parts.purchase_order", "create");
  const [suppliers, sites] = await Promise.all([
    ctx.tx.supplier.findMany({ where: { parts: { some: {} } }, select: { id: true, name: true, isOem: true }, orderBy: { name: "asc" } }),
    ctx.tx.site.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  return {
    suppliers: suppliers.map((s) => ({ value: s.id, label: `${s.name}${s.isOem ? " (OEM)" : ""}` })),
    sites: sites.filter((s) => ctx.can("parts.purchase_order", "create", s.id)).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
  };
}

export const SUPPLIER_INVOICE_SORTS = ["number", "invoiceDate", "dueDate", "totalInclVatCents", "varianceCents"] as const;

export async function listSupplierInvoices(ctx: ServiceContext, p: ListParams, opts: { all?: boolean } = {}) {
  ctx.require("parts.purchase_order", "view");
  const w: Prisma.SupplierInvoiceWhereInput = { ...(siteWhere(ctx, p) as Prisma.SupplierInvoiceWhereInput) };
  if (p.filters.status) w.status = p.filters.status as Prisma.SupplierInvoiceWhereInput["status"];
  if (p.filters.supplier) w.supplierId = p.filters.supplier;
  if (p.filters.due === "1") {
    w.status = "MATCHED";
    w.dueDate = { lte: ctx.businessDate };
  }
  if (p.q) w.OR = [{ number: { contains: p.q, mode: "insensitive" } }, { supplierReference: { contains: p.q, mode: "insensitive" } }, { supplier: { name: { contains: p.q, mode: "insensitive" } } }];
  const range = dateRange(p);
  if (range) w.invoiceDate = range;
  const sort = (SUPPLIER_INVOICE_SORTS as readonly string[]).includes(p.sort ?? "") ? p.sort! : "invoiceDate";
  const [rows, total] = await Promise.all([
    ctx.tx.supplierInvoice.findMany({
      where: w,
      orderBy: [{ [sort]: p.dir }, { number: "desc" }],
      ...pageArgs(p, opts.all),
      include: { supplier: { select: { id: true, name: true } }, site: { select: { code: true } } },
    }),
    ctx.tx.supplierInvoice.count({ where: w }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getSupplierInvoice(ctx: ServiceContext, id: string) {
  const inv = await ctx.tx.supplierInvoice.findUnique({
    where: { id },
    include: {
      supplier: true,
      site: { select: { id: true, code: true, name: true } },
      lines: {
        include: {
          receiptLine: {
            include: {
              receipt: { select: { id: true, number: true, receivedOn: true, purchaseOrder: { select: { id: true, number: true } } } },
              poLine: { include: { part: { select: { id: true, partNumber: true, description: true } } } },
            },
          },
        },
      },
    },
  });
  if (!inv) throw new NotFoundError("SupplierInvoice", id);
  ctx.require("parts.purchase_order", "view", inv.siteId);
  const [entry, payment, decidedBy, settings] = await Promise.all([
    inv.entryId ? ctx.tx.journalEntry.findUnique({ where: { id: inv.entryId }, select: { id: true, number: true } }) : null,
    inv.paymentId ? ctx.tx.payment.findUnique({ where: { id: inv.paymentId }, select: { id: true, number: true, method: true, businessDate: true } }) : null,
    inv.decidedById ? ctx.tx.user.findUnique({ where: { id: inv.decidedById }, select: { firstName: true, lastName: true } }) : null,
    partsSettings(ctx.tx, inv.siteId),
  ]);
  return {
    invoice: inv,
    entry,
    payment,
    decidedBy: decidedBy ? `${decidedBy.firstName} ${decidedBy.lastName}` : null,
    tolerance: settings.invoiceTolerance,
    canDecide: ctx.can("parts.purchase_order", "validate", inv.siteId),
    canPay: ctx.can("accounting.payment", "create", inv.siteId),
  };
}

/** Receipt lines from a supplier at a site that are not fully invoiced yet, oldest first. */
export async function getInvoiceableReceipts(ctx: ServiceContext, siteId: string, supplierId: string) {
  ctx.require("parts.purchase_order", "create", siteId);
  const lines = await ctx.tx.goodsReceiptLine.findMany({
    where: { receipt: { siteId, supplierId } },
    orderBy: [{ receipt: { receivedOn: "asc" } }, { receipt: { number: "asc" } }],
    include: {
      receipt: { select: { id: true, number: true, receivedOn: true, deliveryNote: true, purchaseOrder: { select: { id: true, number: true } } } },
      poLine: { select: { lineNo: true, part: { select: { partNumber: true, description: true } } } },
    },
  });
  return lines
    .map((l) => ({ ...l, remaining: dec(l.qty).minus(dec(l.qtyInvoiced)) }))
    .filter((l) => l.remaining.gt(0));
}

export async function getSupplierInvoiceFormData(ctx: ServiceContext, siteId: string | null) {
  ctx.require("parts.purchase_order", "create");
  const sites = allowedSites(ctx);
  const suppliers = await ctx.tx.supplier.findMany({
    where: { goodsReceipts: { some: { ...(siteId ? { siteId } : sites ? { siteId: { in: sites } } : {}) } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return { suppliers: suppliers.map((s) => ({ value: s.id, label: s.name })) };
}

/** The purchase order a goods receipt belongs to (receipts are shown on their order). */
export async function getReceiptOrderId(ctx: ServiceContext, receiptId: string): Promise<string> {
  const receipt = await ctx.tx.goodsReceipt.findUnique({ where: { id: receiptId }, select: { purchaseOrderId: true, siteId: true } });
  if (!receipt) throw new NotFoundError("GoodsReceipt", receiptId);
  ctx.require("parts.purchase_order", "view", receipt.siteId);
  return receipt.purchaseOrderId;
}
