import { ConflictError } from "@/lib/errors";
import { addDays, isoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import {
  addCounterLine,
  createCounterSale,
  createSuggestedOrders,
  decideSupplierInvoice,
  invoiceCounterSale,
  paySupplierInvoice,
  receivePurchaseOrder,
  recordSupplierInvoice,
  sendPurchaseOrder,
} from "@/modules/parts";
import { between, pick, poisson, unit, unitInt, weighted } from "../domain/random";
import type { Sim, SiteCast } from "./shared";

/** The parts department of one site for one day: deliveries, supplier invoices, the counter, Monday orders. */
export async function partsDay(sim: Sim, site: SiteCast) {
  await receiveDeliveries(sim, site);
  await supplierInvoices(sim, site);
  const sales = poisson(sim.rng, sim.rates.counterSalesPerDay);
  if (sales) {
    const customers = await db.customer.findMany({ where: { homeSiteId: site.id, kind: { in: ["INDIVIDUAL", "COMPANY"] } }, select: { id: true, kind: true }, orderBy: { number: "asc" } });
    for (let i = 0; i < sales && customers.length; i++) await counterSale(sim, site, customers);
  }
  if (sim.day.getUTCDay() === 1) await replenish(sim, site);
}

/** Orders due today arrive; one in twelve comes short and the rest follows a few days later. */
async function receiveDeliveries(sim: Sim, site: SiteCast) {
  const seed = sim.rates.seed;
  const orders = await db.purchaseOrder.findMany({
    where: { siteId: site.id, status: { in: ["SENT", "PARTIAL"] }, expectedOn: { lte: sim.day } },
    include: { lines: { orderBy: { lineNo: "asc" } }, receipts: { select: { receivedOn: true }, orderBy: { receivedOn: "desc" }, take: 1 } },
    orderBy: { number: "asc" },
  });
  for (const po of orders) {
    const last = po.receipts[0]?.receivedOn;
    if (po.status === "PARTIAL" && last && addDays(last, unitInt(seed, po.id, "rest", 4, 8)) > sim.day) continue;
    const short = po.status === "SENT" && unit(seed, po.id, "short") < 0.08;
    const lines = po.lines
      .map((l) => {
        const left = Number(l.qtyOrdered) - Number(l.qtyReceived);
        if (left <= 0) return null;
        return { poLineId: l.id, qty: String(short && left >= 2 ? Math.floor(left / 2) : left) };
      })
      .filter((x) => x !== null);
    if (!lines.length) continue;
    await sim.step("parts delivery", site.partsManager, site.id, (ctx) => receivePurchaseOrder(ctx, po.id, { deliveryNote: `BL${String(between(sim.rng, 0, 9_999_999)).padStart(7, "0")}`, lines }));
  }
}

/** Suppliers invoice each delivery two to eight days later; variances are settled; invoices due are paid. */
async function supplierInvoices(sim: Sim, site: SiteCast) {
  const seed = sim.rates.seed;
  const receipts = await db.goodsReceipt.findMany({
    where: { siteId: site.id, receivedOn: { lte: addDays(sim.day, -2) } },
    include: { lines: true },
    orderBy: { number: "asc" },
  });
  for (const r of receipts) {
    const open = r.lines.filter((l) => Number(l.qty) > Number(l.qtyInvoiced));
    if (!open.length || addDays(r.receivedOn, unitInt(seed, r.id, "invoice", 2, 8)) > sim.day) continue;
    const ref = `F-${r.number}-${isoDate(sim.day).replaceAll("-", "")}`;
    await sim.step("supplier invoice", site.partsManager, site.id, (ctx) =>
      recordSupplierInvoice(ctx, {
        siteId: site.id,
        supplierId: r.supplierId,
        supplierReference: ref,
        invoiceDate: isoDate(sim.day),
        lines: open.map((l) => ({ receiptLineId: l.id, qty: String(Number(l.qty) - Number(l.qtyInvoiced)) })),
      }),
    );
  }
  const variances = await db.supplierInvoice.findMany({ where: { siteId: site.id, status: "VARIANCE", invoiceDate: { lte: addDays(sim.day, -2) } }, select: { id: true }, orderBy: { number: "asc" } });
  for (const v of variances) {
    await sim.step("supplier variance", site.partsManager, site.id, (ctx) => decideSupplierInvoice(ctx, v.id, "APPROVE", "Price increase confirmed by the supplier"));
  }
  const due = await db.supplierInvoice.findMany({ where: { siteId: site.id, status: "MATCHED", dueDate: { lte: sim.day } }, select: { id: true }, orderBy: { number: "asc" } });
  for (const inv of due) {
    await sim.step("supplier payment", sim.cast.accountant, site.id, (ctx) => paySupplierInvoice(ctx, inv.id, { method: "TRANSFER" }));
  }
}

/** A customer at the counter buys one to three parts that are on the shelf; trade accounts buy on account. */
async function counterSale(sim: Sim, site: SiteCast, customers: { id: string; kind: string }[]) {
  const customer = pick(sim.rng, customers);
  const count = weighted(sim.rng, [
    { value: 1, weight: 5 },
    { value: 2, weight: 3 },
    { value: 3, weight: 1 },
  ]);
  const method = weighted(sim.rng, [
    { value: "CARD" as const, weight: 7 },
    { value: "CASH" as const, weight: 2 },
    { value: "CHEQUE" as const, weight: 1 },
  ]);
  const draws = Array.from({ length: count }, () => ({ r: sim.rng(), q: between(sim.rng, 1, 3) }));
  await sim.step("counter sale", site.partsManager, site.id, async (ctx) => {
    const stock = await ctx.tx.stockItem.findMany({
      where: { siteId: site.id, qtyOnHand: { gt: 0 }, part: { active: true } },
      select: { qtyOnHand: true, qtyReserved: true, part: { select: { partNumber: true, unit: true } } },
      orderBy: { part: { partNumber: "asc" } },
    });
    const shelf = stock.filter((s) => Number(s.qtyOnHand) - Number(s.qtyReserved) >= 1);
    if (!shelf.length) return null;
    const lines = new Map<string, number>();
    for (const d of draws) {
      const item = shelf[Math.floor(d.r * shelf.length)];
      const free = Math.floor(Number(item.qtyOnHand) - Number(item.qtyReserved));
      lines.set(item.part.partNumber, Math.min(free, item.part.unit === "EA" ? d.q : d.q + 1));
    }
    const sale = await createCounterSale(ctx, { siteId: site.id, customerId: customer.id });
    for (const [partNumber, qty] of lines) await addCounterLine(ctx, sale.id, { partNumber, qty: String(qty) });
    return invoiceCounterSale(ctx, sale.id, { paymentMethod: customer.kind === "COMPANY" ? "ACCOUNT" : method });
  });
}

/** Mondays: the parts manager sends the suggested orders (items below their minimum). */
async function replenish(sim: Sim, site: SiteCast) {
  await sim.step("parts order", site.partsManager, site.id, async (ctx) => {
    const drafts = await createSuggestedOrders(ctx, { siteId: site.id }).catch((e) => {
      if (e instanceof ConflictError) return [];
      throw e;
    });
    for (const po of drafts) await sendPurchaseOrder(ctx, po.id);
    return drafts.length || null;
  });
}
