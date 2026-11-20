import { beforeEach, describe, expect, it } from "vitest";
import { runCommand, type Actor, type ServiceContext } from "@/lib/context";
import { ConflictError, DomainError, ForbiddenError, ValidationError } from "@/lib/errors";
import {
  addCounterLine,
  cancelCounterSale,
  closePurchaseOrder,
  confirmCounterSale,
  createCounterSale,
  createCycleCount,
  createPurchaseOrder,
  createSuggestedOrders,
  decideSupplierInvoice,
  getSuggestions,
  invoiceCounterSale,
  paySupplierInvoice,
  postCycleCount,
  receivePurchaseOrder,
  recordCounts,
  recordSupplierInvoice,
  registerOpeningStock,
  sendPurchaseOrder,
  setStockLevels,
  supersedePart,
  transferStock,
} from "@/modules/parts";
import { balanceOf, db, makeActor, partsStockValue, resetHandlers, resetWithParts, sys } from "./helpers";

const D = new Date("2026-03-15");
let org: Awaited<ReturnType<typeof resetWithParts>>;

const as = <T>(actor: Actor, fn: (ctx: ServiceContext) => Promise<T>, businessDate = D) => runCommand({ actor, siteId: org.siteA.id, businessDate }, fn);

beforeEach(async () => {
  resetHandlers();
  org = await resetWithParts();
});

/** Order, send and fully receive parts at a site; returns the order. */
async function stockUp(siteId: string, lines: { partNumber: string; qty: number | string; unitCostCents?: number }[], supplierId = org.oem.id) {
  const po = await sys((ctx) => createPurchaseOrder(ctx, { siteId, supplierId, lines }));
  await sys((ctx) => sendPurchaseOrder(ctx, po.id));
  const poLines = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
  await sys((ctx) => receivePurchaseOrder(ctx, po.id, { lines: poLines.map((l) => ({ poLineId: l.id, qty: String(l.qtyOrdered) })) }));
  return po;
}

const item = (partId: string, siteId = org.siteA.id) => db.stockItem.findUniqueOrThrow({ where: { partId_siteId: { partId, siteId } } });

async function expectLedgerMatchesBooks() {
  expect(await balanceOf("373000")).toBe(await partsStockValue());
  for (const s of [org.siteA.id, org.siteB.id]) expect(await balanceOf("373000", { siteId: s })).toBe(await partsStockValue(s));
  const items = await db.stockItem.findMany({ include: { movements: true } });
  for (const i of items) expect(i.movements.reduce((s, m) => s + m.valueCents, 0)).toBe(i.valueCents);
}

describe("receipts and PMP", () => {
  it("receives in steps, recalculates the PMP and accrues goods received not invoiced", async () => {
    const po = await sys((ctx) => createPurchaseOrder(ctx, { siteId: org.siteA.id, supplierId: org.oem.id, lines: [{ partNumber: "1609438180", qty: 10 }] }));
    expect(po.number).toBe("NTE-CF-2026-00001");
    await sys((ctx) => sendPurchaseOrder(ctx, po.id));
    const sent = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { lines: true } });
    expect(sent.status).toBe("SENT");
    expect(sent.expectedOn?.toISOString().slice(0, 10)).toBe("2026-03-17");
    expect(sent.lines[0].unitCostCents).toBe(4_200); // list cost

    const lineId = sent.lines[0].id;
    await sys((ctx) => receivePurchaseOrder(ctx, po.id, { deliveryNote: "BL-1", lines: [{ poLineId: lineId, qty: "6" }] }));
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("PARTIAL");
    await expect(sys((ctx) => receivePurchaseOrder(ctx, po.id, { lines: [{ poLineId: lineId, qty: "5" }] }))).rejects.toThrow(ValidationError);
    await sys((ctx) => receivePurchaseOrder(ctx, po.id, { lines: [{ poLineId: lineId, qty: "4" }] }));
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEIVED");

    await stockUp(org.siteA.id, [{ partNumber: "1609438180", qty: 5, unitCostCents: 4_500 }]);
    const pads = await item(org.pads.id);
    expect(Number(pads.qtyOnHand)).toBe(15);
    expect(pads.valueCents).toBe(64_500);
    expect(Number(pads.pmpCents)).toBe(4_300);
    expect(pads.lastMovementOn?.toISOString().slice(0, 10)).toBe("2026-03-15");

    expect(await balanceOf("607300")).toBe(64_500);
    expect(await balanceOf("408100", { partyId: org.oem.id })).toBe(-64_500);
    expect(await balanceOf("603730")).toBe(-64_500);
    expect(await db.goodsReceipt.count()).toBe(3);
    expect(await db.partMovement.count({ where: { kind: "RECEIPT" } })).toBe(3);
    await expectLedgerMatchesBooks();
  });

  it("orders whole units of parts sold by the piece and decimals of fluids", async () => {
    await expect(sys((ctx) => createPurchaseOrder(ctx, { siteId: org.siteA.id, supplierId: org.oem.id, lines: [{ partNumber: "1109AY", qty: "1.5" }] }))).rejects.toThrow(ValidationError);
    await stockUp(org.siteA.id, [{ partNumber: "ATO5W30", qty: "20.5" }], org.aftermarket.id);
    const oil = await item(org.oil.id);
    expect(Number(oil.qtyOnHand)).toBe(20.5);
    expect(oil.valueCents).toBe(12_300);
  });

  it("orders the successor of a superseded number", async () => {
    const po = await sys((ctx) => createPurchaseOrder(ctx, { siteId: org.siteA.id, supplierId: org.oem.id, lines: [{ partNumber: "1609 4381 00", qty: 2 }] }));
    const lines = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0].partId).toBe(org.pads.id);
  });
});

describe("supplier invoices", () => {
  async function receiptLines(poId: string) {
    return db.goodsReceiptLine.findMany({ where: { receipt: { purchaseOrderId: poId } }, orderBy: { receipt: { number: "asc" } } });
  }

  it("matches within tolerance, posts at receipt value plus variance, then pays and letters", async () => {
    const po = await stockUp(org.siteA.id, [{ partNumber: "1609438180", qty: 10 }]);
    const [rl] = await receiptLines(po.id);
    const inv = await sys((ctx) =>
      recordSupplierInvoice(ctx, {
        siteId: org.siteA.id,
        supplierId: org.oem.id,
        supplierReference: "PF-1001",
        invoiceDate: D,
        lines: [{ receiptLineId: rl.id, qty: "6" }],
      }),
    );
    expect(inv).toMatchObject({ status: "MATCHED", totalExclVatCents: 25_200, vatCents: 5_040, totalInclVatCents: 30_240, receiptValueCents: 25_200, varianceCents: 0 });
    expect(inv.number).toBe("NTE-FR-2026-00001");
    const inv2 = await sys((ctx) =>
      recordSupplierInvoice(ctx, {
        siteId: org.siteA.id,
        supplierId: org.oem.id,
        supplierReference: "PF-1002",
        invoiceDate: D,
        lines: [{ receiptLineId: rl.id, qty: "4", unitCostCents: 4_210 }],
      }),
    );
    expect(inv2).toMatchObject({ status: "MATCHED", totalExclVatCents: 16_840, receiptValueCents: 16_800, varianceCents: 40 });
    const entry = await db.journalEntry.findUniqueOrThrow({ where: { id: inv2.entryId! }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    expect(entry.journalCode).toBe("AC");
    expect(entry.lines.map((l) => [l.accountCode, l.debitCents - l.creditCents])).toEqual([
      ["408100", 16_800],
      ["607300", 40],
      ["445660", 3_368],
      ["401100", -20_208],
    ]);
    expect(await balanceOf("408100", { partyId: org.oem.id })).toBe(0);
    expect(Number((await db.goodsReceiptLine.findUniqueOrThrow({ where: { id: rl.id } })).qtyInvoiced)).toBe(10);

    await expect(
      sys((ctx) => recordSupplierInvoice(ctx, { siteId: org.siteA.id, supplierId: org.oem.id, supplierReference: "PF-1001", invoiceDate: D, lines: [{ receiptLineId: rl.id, qty: "1" }] })),
    ).rejects.toThrow(/already recorded/);
    await expect(
      sys((ctx) => recordSupplierInvoice(ctx, { siteId: org.siteA.id, supplierId: org.oem.id, supplierReference: "PF-1003", invoiceDate: D, lines: [{ receiptLineId: rl.id, qty: "1" }] })),
    ).rejects.toThrow(ValidationError);

    const paid = await sys((ctx) => paySupplierInvoice(ctx, inv2.id, { method: "TRANSFER" }));
    expect(paid.status).toBe("PAID");
    expect(await balanceOf("401100", { partyId: org.oem.id })).toBe(-30_240);
    const payable = await db.journalLine.findMany({ where: { accountCode: "401100", entryId: { in: [inv2.entryId!, (await db.payment.findUniqueOrThrow({ where: { id: paid.paymentId! } })).journalEntryId!] } } });
    expect(payable).toHaveLength(2);
    expect(payable[0].letteringCode).toBeTruthy();
    expect(payable[0].letteringCode).toBe(payable[1].letteringCode);
    await expect(sys((ctx) => paySupplierInvoice(ctx, inv2.id, { method: "TRANSFER" }))).rejects.toThrow(ConflictError);
  });

  it("holds an invoice above tolerance until a manager approves it", async () => {
    const po = await stockUp(org.siteA.id, [{ partNumber: "1609438180", qty: 5, unitCostCents: 4_500 }]);
    const [rl] = await receiptLines(po.id);
    const advisor = await makeActor("PARTS_ADVISOR", org.siteA.id, "pa@t.test");
    const manager = await makeActor("PARTS_MANAGER", org.siteA.id, "pm@t.test");
    const inv = await as(advisor, (ctx) =>
      recordSupplierInvoice(ctx, { siteId: org.siteA.id, supplierId: org.oem.id, supplierReference: "PF-2001", invoiceDate: D, lines: [{ receiptLineId: rl.id, qty: "5", unitCostCents: 4_700 }] }),
    );
    expect(inv).toMatchObject({ status: "VARIANCE", varianceCents: 1_000, entryId: null });
    expect(await balanceOf("408100", { partyId: org.oem.id })).toBe(-22_500);
    await expect(sys((ctx) => paySupplierInvoice(ctx, inv.id, {}))).rejects.toThrow(ConflictError);
    await expect(as(advisor, (ctx) => decideSupplierInvoice(ctx, inv.id, "APPROVE", null))).rejects.toThrow(ForbiddenError);

    const approved = await as(manager, (ctx) => decideSupplierInvoice(ctx, inv.id, "APPROVE", "Price increase confirmed by the supplier"));
    expect(approved.status).toBe("MATCHED");
    expect(await balanceOf("408100", { partyId: org.oem.id })).toBe(0);
    expect(await balanceOf("607300")).toBe(22_500 + 1_000);
    expect(await balanceOf("401100", { partyId: org.oem.id })).toBe(-28_200);
  });

  it("frees the receipt lines of a rejected invoice for the corrected one", async () => {
    const po = await stockUp(org.siteA.id, [{ partNumber: "1609438180", qty: 5 }]);
    const [rl] = await receiptLines(po.id);
    const inv = await sys((ctx) =>
      recordSupplierInvoice(ctx, { siteId: org.siteA.id, supplierId: org.oem.id, supplierReference: "PF-3001", invoiceDate: D, lines: [{ receiptLineId: rl.id, qty: "5", unitCostCents: 9_999 }] }),
    );
    await expect(sys((ctx) => decideSupplierInvoice(ctx, inv.id, "REJECT", ""))).rejects.toThrow(ValidationError);
    await sys((ctx) => decideSupplierInvoice(ctx, inv.id, "REJECT", "Wrong price, credit note requested"));
    expect(Number((await db.goodsReceiptLine.findUniqueOrThrow({ where: { id: rl.id } })).qtyInvoiced)).toBe(0);
    const fixed = await sys((ctx) =>
      recordSupplierInvoice(ctx, { siteId: org.siteA.id, supplierId: org.oem.id, supplierReference: "PF-3002", invoiceDate: D, lines: [{ receiptLineId: rl.id, qty: "5" }] }),
    );
    expect(fixed).toMatchObject({ status: "MATCHED", receiptValueCents: 21_000, varianceCents: 0 });
  });
});

describe("counter sales", () => {
  it("prices by class, substitutes superseded numbers, reserves, issues at PMP and invoices", async () => {
    await stockUp(org.siteA.id, [{ partNumber: "1609438180", qty: 10 }]);
    await stockUp(org.siteA.id, [{ partNumber: "ATO5W30", qty: 20 }], org.aftermarket.id);
    const advisor = await makeActor("PARTS_ADVISOR", org.siteA.id, "pa@t.test");
    const sale = await as(advisor, (ctx) => createCounterSale(ctx, { siteId: org.siteA.id, customerId: org.garage.id }));
    expect(sale).toMatchObject({ status: "QUOTE", priceClass: "TRADE", number: "NTE-VC-2026-00001" });

    const pads = await as(advisor, (ctx) => addCounterLine(ctx, sale.id, { partNumber: "1609 4381 00", qty: "2" }));
    expect(pads).toMatchObject({ partId: org.pads.id, requestedNumber: "1609438100", unitPriceCents: 6_500, discountBp: 2_500, lineExclVatCents: 9_750 });
    await as(advisor, (ctx) => addCounterLine(ctx, sale.id, { partNumber: "ATO5W30", qty: "4,5" }));
    const merged = await as(advisor, (ctx) => addCounterLine(ctx, sale.id, { partNumber: "1609438180", qty: 1 }));
    expect(Number(merged.qty)).toBe(3);
    expect(merged.lineExclVatCents).toBe(14_625);
    await expect(as(advisor, (ctx) => addCounterLine(ctx, sale.id, { partNumber: "1109AY", qty: "1.5" }))).rejects.toThrow(ValidationError);
    await expect(as(advisor, (ctx) => addCounterLine(ctx, sale.id, { partNumber: "NOPE123", qty: 1 }))).rejects.toThrow(/Unknown part/);
    expect((await db.counterSale.findUniqueOrThrow({ where: { id: sale.id } })).totalExclVatCents).toBe(14_625 + 4_860);

    await as(advisor, (ctx) => confirmCounterSale(ctx, sale.id));
    expect(Number((await item(org.pads.id)).qtyReserved)).toBe(3);
    const other = await as(advisor, (ctx) => createCounterSale(ctx, { siteId: org.siteA.id, customerId: org.retail.id }));
    await as(advisor, (ctx) => addCounterLine(ctx, other.id, { partNumber: "1609438180", qty: 8 }));
    await expect(as(advisor, (ctx) => confirmCounterSale(ctx, other.id))).rejects.toThrow(/Only 7/);
    await expect(as(advisor, (ctx) => invoiceCounterSale(ctx, other.id, {}))).rejects.toThrow(/Only 7/);

    const invoiced = await as(advisor, (ctx) => invoiceCounterSale(ctx, sale.id, { paymentMethod: "CARD" }));
    expect(invoiced).toMatchObject({ status: "INVOICED", costCents: 12_600 + 2_700, totalExclVatCents: 19_485 });
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiced.invoiceId! }, include: { lines: true } });
    expect(invoice).toMatchObject({ status: "PAID", totalExclVatCents: 19_485, vatCents: 3_897, totalInclVatCents: 23_382, sourceType: "COUNTER_SALE" });
    expect(invoice.lines.every((l) => l.revenueKey === "REVENUE_PARTS" && l.departmentCode === "PARTS")).toBe(true);

    const padsItem = await item(org.pads.id);
    expect(Number(padsItem.qtyOnHand)).toBe(7);
    expect(Number(padsItem.qtyReserved)).toBe(0);
    expect(padsItem.valueCents).toBe(29_400);
    const oilItem = await item(org.oil.id);
    expect(Number(oilItem.qtyOnHand)).toBe(15.5);
    expect(oilItem.valueCents).toBe(9_300);
    expect(await balanceOf("707300")).toBe(-19_485);
    expect(await balanceOf("603730")).toBe(-(42_000 + 12_000) + 15_300);
    expect(await balanceOf("411000", { partyId: org.garage.id })).toBe(0);
    await expectLedgerMatchesBooks();

    await expect(as(advisor, (ctx) => cancelCounterSale(ctx, sale.id))).rejects.toThrow(ConflictError);
  });

  it("releases the reservation when a confirmed sale is cancelled", async () => {
    await stockUp(org.siteA.id, [{ partNumber: "1609438180", qty: 4 }]);
    const sale = await sys((ctx) => createCounterSale(ctx, { siteId: org.siteA.id, customerId: org.retail.id }));
    await sys((ctx) => addCounterLine(ctx, sale.id, { partNumber: "1609438180", qty: 4 }));
    await sys((ctx) => confirmCounterSale(ctx, sale.id));
    expect(Number((await item(org.pads.id)).qtyReserved)).toBe(4);
    await sys((ctx) => cancelCounterSale(ctx, sale.id));
    expect(Number((await item(org.pads.id)).qtyReserved)).toBe(0);
  });

  it("checks permissions and sites", async () => {
    const advisor = await makeActor("PARTS_ADVISOR", org.siteA.id, "pa@t.test");
    const technician = await makeActor("TECHNICIAN", org.siteA.id, "t@t.test");
    await expect(as(advisor, (ctx) => createCounterSale(ctx, { siteId: org.siteB.id, customerId: org.retail.id }))).rejects.toThrow(ForbiddenError);
    await expect(as(technician, (ctx) => createCounterSale(ctx, { siteId: org.siteA.id, customerId: org.retail.id }))).rejects.toThrow(ForbiddenError);
  });
});

describe("stock integrity", () => {
  it("never lets stock go negative, even through raw SQL, and keeps the ledger immutable", async () => {
    await stockUp(org.siteA.id, [{ partNumber: "1609438180", qty: 2 }]);
    const pads = await item(org.pads.id);
    await expect(db.$executeRaw`UPDATE stock_item SET "qtyOnHand" = -1 WHERE id = ${pads.id}`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE stock_item SET "qtyOnHand" = 0 WHERE id = ${pads.id}`).rejects.toThrow(); // value left without units
    await expect(db.$executeRaw`UPDATE part_movement SET "valueCents" = 0`).rejects.toThrow(/MOVEMENT_IMMUTABLE/);
    await expect(db.$executeRaw`DELETE FROM part_movement`).rejects.toThrow(/MOVEMENT_IMMUTABLE/);
  });

  it("registers seed opening stock without posting", async () => {
    const total = await sys((ctx) =>
      registerOpeningStock(ctx, {
        siteId: org.siteB.id,
        items: [
          { partId: org.pads.id, qty: 3, valueCents: 12_000, bin: "A-01", minQty: 2, maxQty: 6, lastMovementOn: new Date("2025-01-10") },
          { partId: org.filter.id, qty: 0, valueCents: 0, bin: null, minQty: 0, maxQty: 0, lastMovementOn: D },
        ],
      }),
    );
    expect(total).toBe(12_000);
    const pads = await item(org.pads.id, org.siteB.id);
    expect(Number(pads.pmpCents)).toBe(4_000);
    expect(pads.lastMovementOn?.toISOString().slice(0, 10)).toBe("2025-01-10");
    expect(await db.partMovement.count({ where: { kind: "OPENING" } })).toBe(1);
    expect(await db.journalEntry.count()).toBe(0);
    const advisor = await makeActor("PARTS_MANAGER", org.siteA.id, "pm@t.test");
    await expect(as(advisor, (ctx) => registerOpeningStock(ctx, { siteId: org.siteA.id, items: [] }))).rejects.toThrow(DomainError);
  });
});

describe("transfers", () => {
  it("moves stock at the sending site's PMP through the liaison account", async () => {
    await stockUp(org.siteA.id, [{ partNumber: "1609438180", qty: 10 }]);
    const t = await sys((ctx) => transferStock(ctx, { fromSiteId: org.siteA.id, toSiteId: org.siteB.id, lines: [{ partNumber: "1609438180", qty: 4 }] }));
    expect(t).toMatchObject({ number: "NTE-TS-2026-00001", valueCents: 16_800 });
    const a = await item(org.pads.id);
    const b = await item(org.pads.id, org.siteB.id);
    expect([Number(a.qtyOnHand), a.valueCents]).toEqual([6, 25_200]);
    expect([Number(b.qtyOnHand), b.valueCents, Number(b.pmpCents)]).toEqual([4, 16_800, 4_200]);
    expect(await balanceOf("181000", { siteId: org.siteA.id })).toBe(16_800);
    expect(await balanceOf("181000", { siteId: org.siteB.id })).toBe(-16_800);
    expect(await balanceOf("181000")).toBe(0);
    await expectLedgerMatchesBooks();

    await expect(sys((ctx) => transferStock(ctx, { fromSiteId: org.siteA.id, toSiteId: org.siteB.id, lines: [{ partNumber: "1609438180", qty: 7 }] }))).rejects.toThrow(ValidationError);
    await expect(sys((ctx) => transferStock(ctx, { fromSiteId: org.siteA.id, toSiteId: org.siteA.id, lines: [{ partNumber: "1609438180", qty: 1 }] }))).rejects.toThrow(ValidationError);
  });
});

describe("cycle counts", () => {
  it("posts shortfalls and surpluses at PMP once every item is counted", async () => {
    await stockUp(org.siteA.id, [{ partNumber: "1609438180", qty: 10 }]);
    await stockUp(org.siteA.id, [{ partNumber: "ATO5W30", qty: 20 }], org.aftermarket.id);
    const advisor = await makeActor("PARTS_ADVISOR", org.siteA.id, "pa@t.test");
    const manager = await makeActor("PARTS_MANAGER", org.siteA.id, "pm@t.test");
    const count = await as(manager, (ctx) => createCycleCount(ctx, { siteId: org.siteA.id, label: "Brakes and fluids" }));
    const lines = await db.cycleCountLine.findMany({ where: { countId: count.id }, include: { stockItem: true } });
    expect(lines).toHaveLength(2);
    const lineOf = (partId: string) => lines.find((l) => l.stockItem.partId === partId)!.id;
    await as(advisor, (ctx) => recordCounts(ctx, count.id, { lines: [{ lineId: lineOf(org.pads.id), countedQty: "9" }] }));
    await expect(as(manager, (ctx) => postCycleCount(ctx, count.id))).rejects.toThrow(/not counted/);
    await as(advisor, (ctx) => recordCounts(ctx, count.id, { lines: [{ lineId: lineOf(org.oil.id), countedQty: "21,5" }] }));
    await expect(as(advisor, (ctx) => postCycleCount(ctx, count.id))).rejects.toThrow(ForbiddenError);

    const posted = await as(manager, (ctx) => postCycleCount(ctx, count.id));
    expect(posted).toMatchObject({ status: "POSTED", varianceValueCents: -4_200 + 900 });
    expect((await item(org.pads.id)).valueCents).toBe(37_800);
    expect(Number((await item(org.oil.id)).qtyOnHand)).toBe(21.5);
    expect((await item(org.oil.id)).lastCountedOn?.toISOString().slice(0, 10)).toBe("2026-03-15");
    expect(await balanceOf("603730")).toBe(-(42_000 + 12_000) + 3_300);
    await expectLedgerMatchesBooks();
    // Items on an open count are not offered again; posted ones are.
    const next = await as(manager, (ctx) => createCycleCount(ctx, { siteId: org.siteA.id, label: "Again", limit: 1 }));
    expect(await db.cycleCountLine.count({ where: { countId: next.id } })).toBe(1);
  });
});

describe("replenishment", () => {
  it("suggests orders under the minimum, drafts one order per supplier and counts what is on order", async () => {
    await stockUp(org.siteA.id, [{ partNumber: "1609438180", qty: 10 }]);
    await sys((ctx) => setStockLevels(ctx, { siteId: org.siteA.id, partId: org.pads.id, bin: "a-12", minQty: "12", maxQty: "20" }));
    await sys((ctx) => setStockLevels(ctx, { siteId: org.siteA.id, partId: org.filter.id, minQty: "4", maxQty: "10" }));
    await sys((ctx) => setStockLevels(ctx, { siteId: org.siteA.id, partId: org.oil.id, minQty: "10", maxQty: "40" }));
    expect((await item(org.pads.id)).bin).toBe("A-12");
    await expect(sys((ctx) => setStockLevels(ctx, { siteId: org.siteA.id, partId: org.oil.id, minQty: "10", maxQty: "5" }))).rejects.toThrow(ValidationError);

    const s = await sys((ctx) => getSuggestions(ctx, org.siteA.id));
    expect(s.count).toBe(3);
    const qty = (partId: string) => s.groups.flatMap((g) => g.rows).find((r) => r.part.id === partId)?.qty.toNumber();
    expect([qty(org.pads.id), qty(org.filter.id), qty(org.oil.id)]).toEqual([10, 10, 40]);

    const orders = await sys((ctx) => createSuggestedOrders(ctx, { siteId: org.siteA.id }));
    expect(orders).toHaveLength(2); // OEM and aftermarket
    await expect(sys((ctx) => createSuggestedOrders(ctx, { siteId: org.siteA.id }))).rejects.toThrow(ConflictError);

    // A superseded part is never suggested: its successor carries the levels.
    await sys((ctx) => supersedePart(ctx, org.filter.id, { newPartNumber: "1609438180" }));
    await db.purchaseOrder.updateMany({ data: { status: "CANCELLED" } });
    const after = await sys((ctx) => getSuggestions(ctx, org.siteA.id));
    expect(after.groups.flatMap((g) => g.rows).map((r) => r.part.partNumber).sort()).toEqual(["1609438180", "ATO5W30"]);
  });

  it("closes a partly received order and stops expecting its backorder", async () => {
    const po = await sys((ctx) => createPurchaseOrder(ctx, { siteId: org.siteA.id, supplierId: org.oem.id, kind: "EMERGENCY", lines: [{ partNumber: "1109AY", qty: 6 }] }));
    await sys((ctx) => sendPurchaseOrder(ctx, po.id));
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).expectedOn?.toISOString().slice(0, 10)).toBe("2026-03-16");
    const [line] = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    await sys((ctx) => receivePurchaseOrder(ctx, po.id, { lines: [{ poLineId: line.id, qty: "4" }] }));
    await sys((ctx) => closePurchaseOrder(ctx, po.id));
    await sys((ctx) => setStockLevels(ctx, { siteId: org.siteA.id, partId: org.filter.id, minQty: "6", maxQty: "12" }));
    const s = await sys((ctx) => getSuggestions(ctx, org.siteA.id));
    expect(s.groups.flatMap((g) => g.rows)[0].qty.toNumber()).toBe(8);
  });
});
