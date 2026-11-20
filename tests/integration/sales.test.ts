import { beforeEach, describe, expect, it } from "vitest";
import { runCommand, type Actor, type ServiceContext } from "@/lib/context";
import { ConflictError, DomainError, ForbiddenError } from "@/lib/errors";
import { advanceBusinessDay, createCustomer, createVehicle, getSetting, isValidFrenchPlate, vehicleStockLedger } from "@/modules/core";
import {
  acceptQuote,
  addVehicleCost,
  cancelOrder,
  createLead,
  createQuote,
  decideQuoteApproval,
  deliverOrder,
  invoiceOrder,
  purchaseVo,
  receiveVehicle,
  recordOrderPayment,
  registerPastArrival,
  registerPastVoPurchase,
  reserveQuoteVehicle,
  setForSale,
  shipFactoryOrder,
  DEFAULT_REGISTRATION_FEE,
  salesSettings,
  submitQuote,
  type QuoteInput,
} from "@/modules/sales";
import { balanceOf, db, makeActor, resetHandlers, resetWithSales, sys } from "./helpers";

const D = new Date("2026-03-15");
let org: Awaited<ReturnType<typeof resetWithSales>>;
let manager: Actor;

const as = <T>(actor: Actor, fn: (ctx: ServiceContext) => Promise<T>, businessDate = D) =>
  runCommand({ actor, siteId: org.siteA.id, businessDate }, fn);

beforeEach(async () => {
  resetHandlers();
  org = await resetWithSales();
  manager = await makeActor("SALES_MANAGER", org.siteA.id, "sm@t.test");
});

/** A new 208 on order at site A, matching the catalogue entry (so the OEM incentive applies). */
async function vnOnOrder(vin = "VF3AAAAA0T1234567") {
  return sys((ctx) =>
    createVehicle(
      ctx,
      {
        vin,
        brandId: org.brand.id,
        make: "Peugeot",
        model: "208",
        version: "Allure Hybrid 100",
        fuel: "HYBRID",
        co2: 102,
        powerHp: 100,
        stockType: "VN",
        status: "ORDERED",
        siteId: org.siteA.id,
        listPriceCents: 2_530_000,
        stockValueCents: 1_813_167,
      },
      { trusted: true },
    ),
  );
}

async function vnInStock(vin?: string) {
  const v = await vnOnOrder(vin);
  await as(manager, (ctx) => receiveVehicle(ctx, v.id));
  return v;
}

async function customerCar(ownerId: string) {
  return sys((ctx) =>
    createVehicle(ctx, {
      vin: "VF1BBBBB0K7654321",
      registration: "AB-123-CD",
      make: "Renault",
      model: "Clio",
      version: "Zen dCi 90",
      mileage: 85_000,
      fuel: "DIESEL",
      stockType: "NONE",
      status: "CUSTOMER",
      ownerCustomerId: ownerId,
    }),
  );
}

async function newLead(customerId = org.customer.id, actor = manager) {
  return as(actor, (ctx) => createLead(ctx, { siteId: org.siteA.id, customerId, source: "WALK_IN", interest: "VN" }));
}

async function sentQuote(input: QuoteInput, actor = manager) {
  const q = await as(actor, (ctx) => createQuote(ctx, input));
  return as(actor, (ctx) => submitQuote(ctx, q.id));
}

async function expectStockLedgerMatchesGl() {
  const ledger = await sys((ctx) => vehicleStockLedger(ctx.tx, org.siteA.id));
  const sub = (t: "VN" | "VO") => ledger.find((r) => r.stockType === t)?.valueCents ?? 0;
  expect(await balanceOf("371000", { siteId: org.siteA.id })).toBe(sub("VN"));
  expect(await balanceOf("372000", { siteId: org.siteA.id })).toBe(sub("VO"));
}

describe("Flow 1 — VN sale with a trade-in", () => {
  it("runs quote → order → invoice → payment → delivery with every downstream effect", async () => {
    const vn = await vnInStock();
    expect(await balanceOf("371000", { siteId: org.siteA.id })).toBe(1_813_167);
    expect(await balanceOf("401100", { partyId: org.oemSupplier.id })).toBe(-(1_813_167 + 362_633));
    const car = await customerCar(org.customer.id);
    const lead = await newLead();

    const quote = await sentQuote({
      leadId: lead.id,
      vehicleId: vn.id,
      accessories: [{ label: "Floor mats", priceExclVatCents: 9_000, costCents: 5_000 }],
      addOnIds: [org.addOn.id],
      discountInclVatCents: 60_000,
      tradeIn: {
        vehicleId: car.id,
        vin: car.vin,
        registration: car.registration,
        make: "Renault",
        model: "Clio",
        version: "Zen dCi 90",
        mileage: 86_000,
        fuel: "DIESEL",
        marketValueCents: 900_000,
        estimatedRepairCents: 60_000,
        offerCents: 800_000,
      },
      financing: { lender: "Atlantique Financement", principalCents: 1_000_000, months: 48 },
    });
    expect(quote).toMatchObject({
      status: "SENT",
      totalExclVatCents: 2_103_209,
      vatCents: 415_267,
      totalInclVatCents: 2_518_476,
      discountBp: 237,
      tradeInCents: 800_000,
      financedCents: 1_000_000,
      balanceDueCents: 718_476,
      frontEndMarginCents: 249_166,
      backEndMarginCents: 52_000,
      commissionCents: 34_917,
    });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("QUOTED");

    // Order: the VN is held, the trade-in enters VO stock (purchase + police register + stock entry).
    const order = await as(manager, (ctx) => acceptQuote(ctx, quote.id));
    expect(order.status).toBe("CONFIRMED");
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: vn.id } })).status).toBe("RESERVED");
    const tradeIn = await db.vehicle.findUniqueOrThrow({ where: { id: car.id } });
    expect(tradeIn).toMatchObject({ stockType: "VO", status: "INTAKE", siteId: org.siteA.id, ownerCustomerId: null, stockValueCents: 800_000, vatRegime: "MARGIN", mileage: 86_000 });
    const register = await db.policeRegisterEntry.findFirstOrThrow({ where: { vehicleId: car.id } });
    expect(register).toMatchObject({ number: "NTE-LP00001", purchasePriceCents: 800_000, outDate: null });
    expect(await balanceOf("372000", { siteId: org.siteA.id })).toBe(800_000);
    expect(await balanceOf("467400", { partyId: org.customer.id })).toBe(-800_000);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("WON");

    await as(manager, (ctx) => recordOrderPayment(ctx, order.id, { amountCents: 200_000, method: "CARD" }));
    expect(await balanceOf("411000", { partyId: org.customer.id })).toBe(-200_000);

    // Invoice: VN out of stock, settled by trade-in + finance company + deposit.
    const invoiced = await as(manager, (ctx) => invoiceOrder(ctx, order.id));
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiced.invoiceId! } });
    expect(invoice).toMatchObject({ totalInclVatCents: 2_518_476, vatCents: 415_267, paidCents: 2_000_000, status: "PARTIALLY_PAID" });
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: vn.id } })).status).toBe("SOLD");
    expect(await balanceOf("371000", { siteId: org.siteA.id })).toBe(0);
    expect(await balanceOf("603710", { siteId: org.siteA.id })).toBe(0); // +cost at sale, −cost at arrival
    expect(await balanceOf("467400", { partyId: org.customer.id })).toBe(0); // trade-in owed, then set against the invoice
    expect(await balanceOf("467300")).toBe(1_025_000); // financed amount + dealer commission
    expect(await balanceOf("706600")).toBe(-25_000);
    expect(await balanceOf("707100")).toBe(-(2_108_333 + 9_000)); // incentive deducted, then claimed from the OEM
    expect(await balanceOf("709000")).toBe(50_000);
    expect(await balanceOf("706500")).toBe(-59_000);
    expect(await balanceOf("467100")).toBe(-26_876);
    expect(await balanceOf("408100")).toBe(-37_000);
    expect(await balanceOf("411100", { partyId: org.oemCustomer.id })).toBe(60_000);

    await expect(as(manager, (ctx) => deliverOrder(ctx, order.id, {}))).rejects.toThrow(/still due/);
    await as(manager, (ctx) => recordOrderPayment(ctx, order.id, { amountCents: 518_476, method: "TRANSFER" }));
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PAID");
    expect(await balanceOf("411000", { partyId: org.customer.id })).toBe(0);

    const delivered = await as(manager, (ctx) => deliverOrder(ctx, order.id, { mileage: 12 }));
    expect(delivered.status).toBe("DELIVERED");
    const handedOver = await db.vehicle.findUniqueOrThrow({ where: { id: vn.id } });
    expect(handedOver).toMatchObject({ status: "CUSTOMER", stockType: "NONE", ownerCustomerId: org.customer.id, siteId: null, mileage: 12 });
    expect(isValidFrenchPlate(handedOver.registration!)).toBe(true);
    expect(handedOver.firstRegistration?.toISOString().slice(0, 10)).toBe("2026-03-15");
    const commission = await db.commission.findUniqueOrThrow({ where: { salesOrderId: order.id } });
    expect(commission).toMatchObject({ amountCents: 34_917, frontEndCents: 24_917, addOnCents: 5_000, financeCents: 5_000, userId: manager.userId });

    await expectStockLedgerMatchesGl();
    const unbalanced = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM (SELECT "entryId" FROM journal_line GROUP BY "entryId" HAVING sum("debitCents") <> sum("creditCents")) x`;
    expect(Number(unbalanced[0].n)).toBe(0);
  });
});

describe("double sale and reservations", () => {
  it("never sells the same vehicle twice", async () => {
    const vn = await vnInStock();
    const other = await sys((ctx) => createCustomer(ctx, { kind: "INDIVIDUAL", firstName: "Paul", lastName: "Durand", homeSiteId: org.siteA.id }));
    const q1 = await sentQuote({ leadId: (await newLead()).id, vehicleId: vn.id });
    const q2 = await sentQuote({ leadId: (await newLead(other.id)).id, vehicleId: vn.id });
    const order = await as(manager, (ctx) => acceptQuote(ctx, q1.id));
    await expect(as(manager, (ctx) => acceptQuote(ctx, q2.id))).rejects.toThrow(/sold on order/);
    // Even bypassing the service, the database refuses a second open order on the vehicle.
    await expect(
      db.salesOrder.create({
        data: { number: "X-1", quoteId: q2.id, leadId: q2.leadId, siteId: org.siteA.id, customerId: other.id, vehicleId: vn.id, stockType: "VN", orderDate: D, totalInclVatCents: 1 },
      }),
    ).rejects.toThrow(/Unique constraint/);
    expect(order.vehicleId).toBe(vn.id);
  });

  it("holds a vehicle for a customer until the reservation expires", async () => {
    const vn = await vnInStock();
    const other = await sys((ctx) => createCustomer(ctx, { kind: "INDIVIDUAL", firstName: "Paul", lastName: "Durand", homeSiteId: org.siteA.id }));
    const q1 = await sentQuote({ leadId: (await newLead()).id, vehicleId: vn.id });
    const q2 = await sentQuote({ leadId: (await newLead(other.id)).id, vehicleId: vn.id });
    const r = await as(manager, (ctx) => reserveQuoteVehicle(ctx, q1.id));
    expect(r.expiresOn.toISOString().slice(0, 10)).toBe("2026-03-22");
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: vn.id } })).status).toBe("RESERVED");
    await expect(as(manager, (ctx) => reserveQuoteVehicle(ctx, q2.id))).rejects.toThrow(ConflictError);
    await expect(as(manager, (ctx) => acceptQuote(ctx, q2.id))).rejects.toThrow(/reserved for Jeanne/);

    await sys((ctx) => advanceBusinessDay(ctx), new Date("2026-03-23")); // end of day: 03-23 → 03-24
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("EXPIRED");
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: vn.id } })).status).toBe("IN_STOCK");
    const order = await as(manager, (ctx) => acceptQuote(ctx, q2.id), new Date("2026-03-24"));
    expect(order.customerId).toBe(other.id);
  });

  it("converts the customer's own reservation into the order", async () => {
    const vn = await vnInStock();
    const q = await sentQuote({ leadId: (await newLead()).id, vehicleId: vn.id });
    const r = await as(manager, (ctx) => reserveQuoteVehicle(ctx, q.id));
    await as(manager, (ctx) => acceptQuote(ctx, q.id));
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CONVERTED");
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: vn.id } })).status).toBe("RESERVED");
  });
});

describe("discount approval", () => {
  it("routes discounts above 5 % to the sales manager and above 10 % to the dealer principal", async () => {
    const vn = await vnInStock();
    const salesperson = await makeActor("SALESPERSON", org.siteA.id, "sp@t.test");
    const principal = await makeActor("DEALER_PRINCIPAL", null, "dp@t.test");

    const q8 = await sentQuote({ leadId: (await newLead(org.customer.id, salesperson)).id, vehicleId: vn.id, discountInclVatCents: 202_400 }, salesperson);
    expect(q8.status).toBe("PENDING_APPROVAL");
    expect(await db.approvalRequest.count({ where: { entityId: q8.id, status: "PENDING" } })).toBe(1);
    await expect(as(salesperson, (ctx) => decideQuoteApproval(ctx, q8.id, "APPROVE"))).rejects.toThrow(ForbiddenError);
    await expect(as(manager, (ctx) => acceptQuote(ctx, q8.id))).rejects.toThrow(/waiting for approval/);
    expect((await as(manager, (ctx) => decideQuoteApproval(ctx, q8.id, "APPROVE"))).status).toBe("SENT");

    const q12 = await sentQuote({ leadId: (await newLead(org.customer.id, salesperson)).id, vehicleId: vn.id, discountInclVatCents: 303_600 }, salesperson);
    await expect(as(manager, (ctx) => decideQuoteApproval(ctx, q12.id, "APPROVE"))).rejects.toThrow(/Dealer Principal/);
    expect((await as(principal, (ctx) => decideQuoteApproval(ctx, q12.id, "APPROVE"))).status).toBe("SENT");

    const own = await sentQuote({ leadId: (await newLead()).id, vehicleId: vn.id, discountInclVatCents: 202_400 });
    await expect(as(manager, (ctx) => decideQuoteApproval(ctx, own.id, "APPROVE"))).rejects.toThrow(/your own/);
    expect((await as(principal, (ctx) => decideQuoteApproval(ctx, own.id, "REJECT", "Too generous"))).status).toBe("DRAFT");
  });

  it("counts the trade-in over-allowance as a discount", async () => {
    const vn = await vnInStock();
    const car = await customerCar(org.customer.id);
    const q = await sentQuote({
      leadId: (await newLead()).id,
      vehicleId: vn.id,
      tradeIn: { vehicleId: car.id, vin: car.vin, make: "Renault", model: "Clio", mileage: 85_000, fuel: "DIESEL", marketValueCents: 900_000, estimatedRepairCents: 0, offerCents: 1_100_000 },
    });
    expect(q.discountBp).toBe(791); // €2,000 over the market value / €25,300 list price
    expect(q.status).toBe("PENDING_APPROVAL");
  });
});

describe("factory orders", () => {
  it("orders a configured VN from the OEM and invoices it only once it has arrived", async () => {
    const q = await sentQuote({ leadId: (await newLead()).id, catalogueVersionId: org.version.id, optionIds: [org.option.id], colour: "Bleu Vertigo" });
    expect(q.totalInclVatCents).toBe(2_108_333 + 57_500 - 50_000 + 26_876 + (421_667 + 11_500 - 10_000));
    const order = await as(manager, (ctx) => acceptQuote(ctx, q.id));
    const vehicle = await db.vehicle.findUniqueOrThrow({ where: { id: order.vehicleId }, include: { options: true, factoryOrder: true } });
    expect(vehicle).toMatchObject({ status: "RESERVED", stockType: "VN", stockInDate: null, colour: "Bleu Vertigo", stockValueCents: 1_813_167 + 43_125 });
    expect(vehicle.vin.startsWith("VF3")).toBe(true);
    expect(vehicle.options.map((o) => o.code)).toEqual(["PAINT-MET"]);
    expect(vehicle.factoryOrder).toMatchObject({ salesOrderId: order.id, status: "ORDERED" });
    expect(vehicle.factoryOrder!.expectedOn.toISOString().slice(0, 10)).toBe("2026-04-29");

    await expect(as(manager, (ctx) => invoiceOrder(ctx, order.id))).rejects.toThrow(/not arrived/);
    await as(manager, (ctx) => shipFactoryOrder(ctx, vehicle.factoryOrder!.id));
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).status).toBe("RESERVED");
    await as(manager, (ctx) => receiveVehicle(ctx, vehicle.id), new Date("2026-04-28"));
    expect(await balanceOf("371000", { siteId: org.siteA.id })).toBe(1_856_292);
    await expectStockLedgerMatchesGl();
    await as(manager, (ctx) => invoiceOrder(ctx, order.id), new Date("2026-04-28"));
    expect(await balanceOf("371000", { siteId: org.siteA.id })).toBe(0);
    expect((await db.factoryOrder.findUniqueOrThrow({ where: { id: vehicle.factoryOrder!.id } })).status).toBe("ARRIVED");
  });
});

describe("used vehicles", () => {
  it("buys from a private seller and sells under the margin regime", async () => {
    const seller = await sys((ctx) => createCustomer(ctx, { kind: "INDIVIDUAL", firstName: "Paul", lastName: "Durand", homeSiteId: org.siteA.id }));
    const { vehicle, purchase } = await as(manager, (ctx) =>
      purchaseVo(ctx, {
        siteId: org.siteA.id,
        source: "PRIVATE",
        customerId: seller.id,
        priceCents: 1_000_000,
        vehicle: { vin: "VF1CCCCC0K1111111", registration: "CD-456-EF", make: "Renault", model: "Captur", version: "Intens TCe 130", mileage: 60_000, fuel: "PETROL", firstRegistration: "2021-05-01" },
      }),
    );
    expect(vehicle).toMatchObject({ stockType: "VO", status: "INTAKE", vatRegime: "MARGIN", stockValueCents: 1_000_000, brandId: null });
    expect(purchase.source).toBe("PRIVATE");
    expect(await balanceOf("467400")).toBe(0); // owed, then paid at once
    expect(await balanceOf("512100")).toBe(-1_000_000);

    await as(manager, (ctx) => addVehicleCost(ctx, vehicle.id, { kind: "RECONDITIONING", label: "Bodywork", amountCents: 80_000, supplierId: org.bodyshop.id }));
    expect(await balanceOf("401000", { partyId: org.bodyshop.id })).toBe(-96_000);
    expect(await balanceOf("372000", { siteId: org.siteA.id })).toBe(1_080_000);
    await as(manager, (ctx) => setForSale(ctx, vehicle.id, { listPriceCents: 1_399_000 }));

    const q = await sentQuote({ leadId: (await newLead()).id, vehicleId: vehicle.id, includeRegistration: false });
    expect(q).toMatchObject({ vatRegime: "MARGIN", totalInclVatCents: 1_399_000, vatCents: 66_500, frontEndMarginCents: 1_332_500 - 1_080_000 });
    const order = await as(manager, (ctx) => acceptQuote(ctx, q.id));
    const invoiced = await as(manager, (ctx) => invoiceOrder(ctx, order.id));
    expect(await balanceOf("445715")).toBe(-66_500);
    expect(await balanceOf("707200")).toBe(-1_332_500);
    expect(await balanceOf("372000", { siteId: org.siteA.id })).toBe(0);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiced.invoiceId! }, include: { lines: true } });
    expect(invoice.notes).toContain("Order");
    expect(invoice.lines[0]).toMatchObject({ vatRegime: "MARGIN", vatCents: 66_500 });
    const register = await db.policeRegisterEntry.findFirstOrThrow({ where: { vehicleId: vehicle.id } });
    expect(register).toMatchObject({ sellerName: seller.displayName, purchasePriceCents: 1_000_000, buyerName: org.customer.displayName, salePriceCents: 1_399_000, saleReference: invoice.number });
    await expectStockLedgerMatchesGl();
  });

  it("buys from a professional with deductible VAT", async () => {
    const { vehicle, purchase } = await as(manager, (ctx) =>
      purchaseVo(ctx, {
        siteId: org.siteA.id,
        source: "PROFESSIONAL",
        supplierId: org.auction.id,
        vatRegime: "STANDARD",
        priceCents: 1_500_000,
        vehicle: { vin: "VF3DDDDD0L2222222", make: "Peugeot", model: "3008", version: "GT", mileage: 30_000, fuel: "HYBRID" },
      }),
    );
    expect(purchase.vatCents).toBe(300_000);
    expect(vehicle).toMatchObject({ vatRegime: "STANDARD", brandId: org.brand.id });
    expect(await balanceOf("445660")).toBe(300_000);
    expect(await balanceOf("401000", { partyId: org.auction.id })).toBe(-1_800_000);
    await expectStockLedgerMatchesGl();
  });
});

describe("seed stock replay", () => {
  it("books the seed's own stock on its stock-in date, like a real arrival or purchase", async () => {
    const day = new Date("2026-03-10");
    const vn = await sys((ctx) =>
      createVehicle(
        ctx,
        {
          vin: "VF3AAAAA0T7654321",
          brandId: org.brand.id,
          make: "Peugeot",
          model: "208",
          version: "Allure Hybrid 100",
          fuel: "HYBRID",
          stockType: "VN",
          status: "IN_STOCK",
          siteId: org.siteA.id,
          listPriceCents: 2_530_000,
          stockValueCents: 1_813_167,
          stockInDate: day,
        },
        { trusted: true },
      ),
    );
    const dates = { orderedOn: new Date("2026-01-20"), shippedOn: new Date("2026-03-05") };
    await expect(sys((ctx) => registerPastArrival(ctx, vn.id, dates), new Date("2026-03-11"))).rejects.toThrow(ConflictError);
    const fo = await sys((ctx) => registerPastArrival(ctx, vn.id, dates), day);
    expect(fo).toMatchObject({ status: "ARRIVED", orderedOn: dates.orderedOn, shippedOn: dates.shippedOn, arrivedOn: day });
    expect(await balanceOf("371000", { siteId: org.siteA.id })).toBe(1_813_167);
    expect(await balanceOf("401100", { partyId: org.oemSupplier.id })).toBe(-2_175_800);
    await expect(sys((ctx) => registerPastArrival(ctx, vn.id, dates), day)).rejects.toThrow(ConflictError);

    const seller = await sys((ctx) => createCustomer(ctx, { kind: "INDIVIDUAL", firstName: "Paul", lastName: "Durand", homeSiteId: org.siteA.id }));
    const vo = await sys((ctx) =>
      createVehicle(
        ctx,
        {
          vin: "VF1CCCCC0K1111111",
          registration: "CD-456-EF",
          make: "Renault",
          model: "Captur",
          version: "Intens TCe 130",
          mileage: 60_000,
          fuel: "PETROL",
          stockType: "VO",
          status: "FOR_SALE",
          siteId: org.siteA.id,
          vatRegime: "MARGIN",
          listPriceCents: 1_299_000,
          stockValueCents: 1_000_000,
          stockInDate: day,
        },
        { trusted: true },
      ),
    );
    const purchase = await sys((ctx) => registerPastVoPurchase(ctx, vo.id, { customerId: seller.id }), day);
    expect(purchase).toMatchObject({ source: "PRIVATE", priceCents: 1_000_000, purchaseDate: day });
    expect(await balanceOf("372000", { siteId: org.siteA.id })).toBe(1_000_000);
    expect(await balanceOf("512100")).toBe(-1_000_000); // the private seller is paid at once
    const register = await db.policeRegisterEntry.findFirstOrThrow({ where: { vehicleId: vo.id } });
    expect(register).toMatchObject({ inDate: day, sellerName: seller.displayName, purchasePriceCents: 1_000_000 });
    await expectStockLedgerMatchesGl();
  });
});

describe("cancellation and guards", () => {
  it("cancels a confirmed order: vehicle back in stock, trade-in handed back, deposit kept on account", async () => {
    const vn = await vnInStock();
    const car = await customerCar(org.customer.id);
    const lead = await newLead();
    const q = await sentQuote({
      leadId: lead.id,
      vehicleId: vn.id,
      tradeIn: { vehicleId: car.id, vin: car.vin, make: "Renault", model: "Clio", mileage: 85_000, fuel: "DIESEL", marketValueCents: 900_000, estimatedRepairCents: 0, offerCents: 800_000 },
    });
    const order = await as(manager, (ctx) => acceptQuote(ctx, q.id));
    await as(manager, (ctx) => recordOrderPayment(ctx, order.id, { amountCents: 100_000, method: "CHEQUE" }));
    const salesperson = await makeActor("SALESPERSON", org.siteA.id, "sp@t.test");
    await expect(as(salesperson, (ctx) => cancelOrder(ctx, order.id, "Changed mind"))).rejects.toThrow(ForbiddenError);

    await as(manager, (ctx) => cancelOrder(ctx, order.id, "Customer changed their mind"));
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: vn.id } })).status).toBe("IN_STOCK");
    expect(await db.vehicle.findUniqueOrThrow({ where: { id: car.id } })).toMatchObject({ status: "CUSTOMER", stockType: "NONE", ownerCustomerId: org.customer.id, siteId: null });
    expect((await db.voPurchase.findFirstOrThrow({ where: { vehicleId: car.id } })).cancelledOn).not.toBeNull();
    expect((await db.policeRegisterEntry.findFirstOrThrow({ where: { vehicleId: car.id } })).outDate).not.toBeNull();
    expect(await balanceOf("372000", { siteId: org.siteA.id })).toBe(0);
    expect(await balanceOf("607200")).toBe(0);
    expect(await balanceOf("467400")).toBe(0);
    expect(await balanceOf("411000", { partyId: org.customer.id })).toBe(-100_000);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("LOST");
    await expectStockLedgerMatchesGl();
  });

  it("refuses to cancel an invoiced order and lets only managers invoice", async () => {
    const vn = await vnInStock();
    const q = await sentQuote({ leadId: (await newLead()).id, vehicleId: vn.id });
    const order = await as(manager, (ctx) => acceptQuote(ctx, q.id));
    const salesperson = await makeActor("SALESPERSON", org.siteA.id, "sp@t.test");
    await expect(as(salesperson, (ctx) => invoiceOrder(ctx, order.id))).rejects.toThrow(ForbiddenError);
    await as(manager, (ctx) => invoiceOrder(ctx, order.id));
    await expect(as(manager, (ctx) => cancelOrder(ctx, order.id, "Too late"))).rejects.toThrow(/credit note/);
    await expect(as(manager, (ctx) => deliverOrder(ctx, order.id, {}))).rejects.toThrow(DomainError);
  });
});

describe("settings", () => {
  it("merges a partial site override over the group value, not over the code default", async () => {
    await db.setting.create({ data: { key: "sales.registrationFee", value: { fixedCents: 2_000, perFiscalHpCents: 5_100, electricExempt: true } } });
    await db.setting.create({ data: { key: "sales.registrationFee", siteId: org.siteB.id, value: { perFiscalHpCents: 6_000 } } });
    const fee = (siteId: string | null) => getSetting(db, "sales.registrationFee", siteId, DEFAULT_REGISTRATION_FEE);
    expect(await fee(org.siteB.id)).toEqual({ fixedCents: 2_000, perFiscalHpCents: 6_000, electricExempt: true });
    expect(await fee(org.siteA.id)).toEqual({ fixedCents: 2_000, perFiscalHpCents: 5_100, electricExempt: true });
    expect((await salesSettings(db, null)).quoteValidityDays).toBe(15); // nothing stored: code default
  });
});
