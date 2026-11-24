import { ConflictError } from "@/lib/errors";
import { addDays, isoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import {
  addCounterLine,
  createCounterSale,
  createCycleCount,
  createPurchaseOrder,
  createSuggestedOrders,
  postCycleCount,
  recordCounts,
  transferStock,
  decideSupplierInvoice,
  invoiceCounterSale,
  paySupplierInvoice,
  receivePurchaseOrder,
  recordSupplierInvoice,
  sendPurchaseOrder,
} from "@/modules/parts";
import { between, chance, perOpenDay, pick, poisson, unit, unitInt, weighted } from "../domain/random";
import type { Sim, SiteCast } from "./shared";

/**
 * The parts department of one site for one day: deliveries, supplier invoices, the counter,
 * Monday orders, customer (emergency) orders, Thursday transfers to sites that are short, and the
 * monthly cycle count on the first Tuesday.
 */
export async function partsDay(sim: Sim, site: SiteCast) {
  await receiveDeliveries(sim, site);
  await supplierInvoices(sim, site);
  const sales = poisson(sim.rng, sim.rates.counterSalesPerDay);
  if (sales) {
    const customers = await db.customer.findMany({ where: { homeSiteId: site.id, kind: { in: ["INDIVIDUAL", "COMPANY"] } }, select: { id: true, kind: true }, orderBy: { number: "asc" } });
    for (let i = 0; i < sales && customers.length; i++) await counterSale(sim, site, customers);
  }
  const weekday = sim.day.getUTCDay();
  if (weekday === 1) await replenish(sim, site);
  if (weekday !== 6 && chance(sim.rng, perOpenDay(sim.rates.emergencyOrdersPerWeek) * 1.2)) await emergencyOrder(sim, site);
  if (weekday === 4) await transfers(sim, site);
  if (weekday === 2 && sim.day.getUTCDate() <= 7) await cycleCount(sim, site);
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
    // The first invoice of a delivery is sometimes at another price on one line; a corrected one never is.
    const corrected = (await db.supplierInvoiceLine.count({ where: { receiptLineId: { in: r.lines.map((l) => l.id) } } })) > 0;
    const variance = !corrected && unit(seed, r.id, "price") < sim.rates.supplierVarianceRate;
    const factor = unit(seed, r.id, "price-size") < 0.6 ? 1.004 : 1.12 + unit(seed, r.id, "price-up") * 0.13;
    const bumped = unitInt(seed, r.id, "price-line", 0, open.length - 1);
    await sim.step("supplier invoice", site.partsManager, site.id, (ctx) =>
      recordSupplierInvoice(ctx, {
        siteId: site.id,
        supplierId: r.supplierId,
        supplierReference: `F-${r.number}-${isoDate(sim.day).replaceAll("-", "")}`,
        invoiceDate: isoDate(sim.day),
        notes: corrected ? "Corrected invoice" : null,
        lines: open.map((l, i) => ({
          receiptLineId: l.id,
          qty: String(Number(l.qty) - Number(l.qtyInvoiced)),
          unitCostCents: variance && i === bumped ? Math.round(l.unitCostCents * factor) : undefined,
        })),
      }),
    );
  }
  // Price differences are settled a few days later: most increases are confirmed, some refused (a corrected invoice follows).
  const variances = await db.supplierInvoice.findMany({ where: { siteId: site.id, status: "VARIANCE" }, select: { id: true, invoiceDate: true }, orderBy: { number: "asc" } });
  for (const v of variances) {
    if (addDays(v.invoiceDate, unitInt(seed, v.id, "decide", 1, 4)) > sim.day) continue;
    const approve = unit(seed, v.id, "approve") < 0.75;
    await sim.step(approve ? "supplier variance approved" : "supplier invoice rejected", site.partsManager, site.id, (ctx) =>
      decideSupplierInvoice(ctx, v.id, approve ? "APPROVE" : "REJECT", approve ? "Price increase confirmed by the supplier" : "Price not agreed: corrected invoice requested"),
    );
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

/** A part the site does not stock, ordered for a customer and delivered the next day. */
async function emergencyOrder(sim: Sim, site: SiteCast) {
  const where = { brandId: { in: site.brandIds }, active: true, stock: { none: { siteId: site.id } }, replacedBy: null };
  const total = await db.part.count({ where });
  if (!total) return;
  const part = await db.part.findFirstOrThrow({ where, orderBy: { partNumber: "asc" }, skip: Math.floor(sim.rng() * total) });
  await sim.step("emergency order", site.partsManager, site.id, async (ctx) => {
    const po = await createPurchaseOrder(ctx, { siteId: site.id, supplierId: part.supplierId, kind: "EMERGENCY", notes: "Customer order", lines: [{ partNumber: part.partNumber, qty: "1" }] });
    return sendPurchaseOrder(ctx, po.id);
  });
}

/** Thursdays: a few units sent to each other site that is below its minimum, from what this site has above its own. */
async function transfers(sim: Sim, site: SiteCast) {
  const others = await db.site.findMany({ where: { id: { not: site.id } }, select: { id: true }, orderBy: { code: "asc" } });
  for (const to of others) {
    const rows = await db.$queryRaw<{ partNumber: string; qty: number }[]>`
      SELECT p."partNumber", LEAST(t."minQty" - (t."qtyOnHand" - t."qtyReserved"), (s."qtyOnHand" - s."qtyReserved") - s."minQty")::int AS qty
      FROM stock_item t
      JOIN stock_item s ON s."partId" = t."partId" AND s."siteId" = ${site.id}
      JOIN part p ON p.id = t."partId"
      WHERE t."siteId" = ${to.id} AND t."minQty" > 0 AND t."qtyOnHand" - t."qtyReserved" < t."minQty"
        AND s."qtyOnHand" - s."qtyReserved" - s."minQty" >= 1 AND p.unit = 'EA'
      ORDER BY p."partNumber" LIMIT 3`;
    const lines = rows.filter((r) => r.qty >= 1).map((r) => ({ partNumber: r.partNumber, qty: String(r.qty) }));
    if (!lines.length) continue;
    await sim.step("stock transfer", site.partsManager, site.id, (ctx) => transferStock(ctx, { fromSiteId: site.id, toSiteId: to.id, notes: "Rebalancing between sites", lines }));
  }
}

/** First Tuesday of the month: one aisle counted (in turn); about one item in eight is a unit off. */
async function cycleCount(sim: Sim, site: SiteCast) {
  const bins = await db.stockItem.findMany({ where: { siteId: site.id, bin: { not: null } }, select: { bin: true }, distinct: ["bin"] });
  const aisles = [...new Set(bins.map((b) => b.bin!.charAt(0).toUpperCase()))].sort();
  if (!aisles.length) return;
  const month = sim.day.getUTCFullYear() * 12 + sim.day.getUTCMonth();
  const aisle = aisles[month % aisles.length];
  await sim.step("cycle count", site.partsManager, site.id, async (ctx) => {
    const count = await createCycleCount(ctx, { siteId: site.id, label: `Monthly count ${isoDate(sim.day).slice(0, 7)} — aisle ${aisle}`, binPrefix: aisle, limit: 25 });
    const lines = await ctx.tx.cycleCountLine.findMany({ where: { countId: count.id }, include: { stockItem: { select: { part: { select: { unit: true } } } } }, orderBy: { id: "asc" } });
    await recordCounts(ctx, count.id, {
      lines: lines.map((l) => {
        const expected = Number(l.expectedQty);
        const step = l.stockItem.part.unit === "L" ? 0.5 : 1;
        const off = unit(sim.rates.seed, l.id, "off") < 0.12;
        const up = unit(sim.rates.seed, l.id, "up") < 0.35;
        return { lineId: l.id, countedQty: String(off ? Math.max(0, expected + (up ? step : -step)) : expected) };
      }),
    });
    return postCycleCount(ctx, count.id);
  });
}
