import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/errors";
import { createCustomer, createVehicle, setBusinessDate } from "@/modules/core";
import { setStockLevels } from "@/modules/parts";
import { orderForStock, purchaseVo, receiveVehicle, shipFactoryOrder } from "@/modules/sales";
import { checkSimulationInvariants, JOB_TEMPLATES, RECONDITIONING_TEMPLATES, runSimulation, WARRANTY_TEMPLATES, type SimulationReport } from "@/modules/simulation";
import { db, makeActor, resetWithWorkshop, sys } from "./helpers";

/**
 * Phase 7 "done when": 30 simulated days run with no error and the books still hold — the journal
 * balances and every stock account equals its sub-ledger. The org is the workshop test org plus
 * the staff the runner acts through, a few customers with their cars, new and used cars in stock
 * and parts with reorder levels.
 */
describe("simulation runner", () => {
  let org: Awaited<ReturnType<typeof resetWithWorkshop>>;
  let report: SimulationReport;
  const start = new Date("2026-03-02"); // a Monday

  beforeAll(async () => {
    org = await resetWithWorkshop();
    const site = org.siteA.id;
    await makeActor("SALES_MANAGER", site, "sm@t.test");
    await makeActor("SALESPERSON", site, "sp@t.test");
    await makeActor("PARTS_MANAGER", site, "pm@t.test");
    await makeActor("ACCOUNTANT", null, "acc@t.test");
    await makeActor("DEALER_PRINCIPAL", null, "dp@t.test");
    const on = <T,>(fn: Parameters<typeof sys<T>>[0]) => sys(fn, new Date("2026-02-20"));
    // Every operation the job templates use (the workshop org has two of them).
    const codes = new Set(["INSPECTION", ...[...JOB_TEMPLATES, ...WARRANTY_TEMPLATES, ...RECONDITIONING_TEMPLATES].map((t) => t.op)]);
    const existing = new Set((await db.labourOperation.findMany({ select: { code: true } })).map((o) => o.code));
    await db.labourOperation.createMany({ data: [...codes].filter((c) => !existing.has(c)).map((code) => ({ code, label: code, category: "SERVICE", standardCentiHours: 60 })) });

    for (let i = 0; i < 12; i++) {
      const company = i % 4 === 3;
      const c = await on((ctx) =>
        createCustomer(ctx, company ? { kind: "COMPANY", companyName: `Société ${i}`, paymentTermsDays: 30, homeSiteId: site } : { kind: "INDIVIDUAL", firstName: `Client${i}`, lastName: "Test", homeSiteId: site }),
      );
      await on((ctx) =>
        createVehicle(ctx, {
          vin: `VF3BBBBB0K${String(1_000_000 + i)}`,
          registration: `AA-${String(100 + i)}-ZZ`,
          brandId: org.brand.id,
          make: "Peugeot",
          model: "208",
          version: "Active 1.2 PureTech 75",
          mileage: 20_000 + i * 5_000,
          fuel: "PETROL",
          stockType: "NONE",
          status: "CUSTOMER",
          ownerCustomerId: c.id,
          firstRegistration: `${2019 + (i % 6)}-06-01`,
        }),
      );
    }
    for (let i = 0; i < 4; i++) {
      const fo = await on((ctx) => orderForStock(ctx, { siteId: site, catalogueVersionId: org.version.id, optionIds: [], colour: "Blanc Nacré" }));
      await on((ctx) => shipFactoryOrder(ctx, fo.id));
      await on((ctx) => receiveVehicle(ctx, fo.vehicleId));
    }
    await on((ctx) =>
      purchaseVo(ctx, {
        siteId: site,
        source: "PROFESSIONAL",
        supplierId: org.auction.id,
        vatRegime: "MARGIN",
        priceCents: 1_200_000,
        supplierReference: "LOT-1",
        vehicle: { vin: "VF3DDDDD0K1111111", registration: "DD-111-DD", brandId: org.brand.id, make: "Peugeot", model: "2008", version: "Allure", mileage: 45_000, fuel: "PETROL", firstRegistration: "2022-04-01" },
      }),
    );
    for (const p of [org.pads, org.filter, org.oil]) await on((ctx) => setStockLevels(ctx, { siteId: site, partId: p.id, minQty: 6, maxQty: 20 }));
    await sys((ctx) => setBusinessDate(ctx, start));

    report = await runSimulation((await import("@/lib/context")).SYSTEM_ACTOR, {
      days: 30,
      rates: { leadsPerDay: 1.5, workshopVisitsPerDay: 3, counterSalesPerDay: 2, voPurchasesPerWeek: 2, vnStockTarget: 4 },
    });
  }, 240_000);

  it("runs 30 days without error and the books still hold", async () => {
    expect(report.error).toBeNull();
    expect(report.days).toBe(30);
    expect(report.from).toBe("2026-03-02");
    expect(report.to).toBe("2026-04-01");
    expect((await db.businessClock.findUniqueOrThrow({ where: { id: 1 } })).currentDate).toEqual(new Date("2026-04-01"));
    expect(report.invariants.balanced).toBe(true);
    expect(report.invariants.stockReconciled).toBe(true);
    expect(report.ok).toBe(true);
    expect(await checkSimulationInvariants()).toMatchObject({ balanced: true, stockReconciled: true });
  });

  it("acts through every desk: sales, workshop, parts and accounts", async () => {
    for (const step of ["new lead", "quote", "order signed", "invoice sale", "deliver car", "buy used car", "check-in", "workshop work", "clocking", "internal repair", "counter sale", "parts order", "parts delivery", "supplier invoice"]) {
      expect(report.counts[step] ?? 0, step).toBeGreaterThan(0);
    }
    expect(await db.lead.count()).toBeGreaterThan(20);
    expect(await db.repairOrder.count({ where: { status: { in: ["INVOICED", "CLOSED"] } } })).toBeGreaterThan(10);
    expect(await db.invoice.count({ where: { sourceType: "COUNTER_SALE" } })).toBeGreaterThan(20);
    // Steps are taken by the site's own users, never by the system.
    const authors = await db.repairOrder.findMany({ select: { advisorId: true }, distinct: ["advisorId"] });
    expect(authors.map((a) => a.advisorId).sort()).toEqual([org.advisor.userId, org.workshopManager.userId].sort());
  });

  it("has no step refused by the business rules on this org", () => {
    expect(report.skipped).toEqual([]);
  });

  it("leaves the stock sub-ledgers equal to the stock accounts per site", async () => {
    expect(report.invariants.stockDifferences.every((d) => d.differenceCents === null || d.differenceCents === 0)).toBe(true);
    const event = await db.domainEvent.findFirstOrThrow({ where: { type: "SimulationRun" } });
    expect(event.payload).toMatchObject({ from: "2026-03-02", to: "2026-04-01", ok: true });
  });

  it("needs the simulation right", async () => {
    const salesperson = await db.user.findUniqueOrThrow({ where: { email: "sp@t.test" } });
    const actor = (await (await import("@/lib/actor")).loadActor(salesperson.id))!;
    await expect(runSimulation(actor, { days: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runSimulation((await import("@/lib/context")).SYSTEM_ACTOR, { days: 1, site: "nowhere" })).rejects.toThrow(/Unknown site/);
  });
});
