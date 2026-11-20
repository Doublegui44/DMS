import { beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "@/lib/context";
import { on } from "@/lib/events";
import { ConflictError, ForbiddenError, InvalidTransitionError, ValidationError } from "@/lib/errors";
import {
  changeVehicleStatus,
  createCustomer,
  createVehicle,
  nextDocumentNumber,
  advanceBusinessDay,
  patchVehicle,
  setBusinessDate,
  updateVehicle,
} from "@/modules/core";
import { db, makeActor, resetHandlers, resetWithMinimalOrg, sys } from "./helpers";

let org: Awaited<ReturnType<typeof resetWithMinimalOrg>>;

beforeEach(async () => {
  resetHandlers();
  org = await resetWithMinimalOrg();
});

const vnInput = (siteId: string, vin = "VF3AAAAA0T1234567") => ({
  vin,
  make: "Peugeot",
  model: "208",
  version: "Active",
  fuel: "PETROL" as const,
  stockType: "VN" as const,
  status: "ORDERED" as const,
  siteId,
  stockValueCents: 1_500_000,
});

/** The sales flows create and move stock cars (trusted); the vehicle screens cannot (D-048). */
const flow = { trusted: true } as const;

describe("gap-free numbering", () => {
  it("increments per scope and type", async () => {
    const a = await sys((ctx) => nextDocumentNumber(ctx, { docType: "INVOICE", scope: org.siteA.id, sitePrefix: "NTE" }));
    const b = await sys((ctx) => nextDocumentNumber(ctx, { docType: "INVOICE", scope: org.siteA.id, sitePrefix: "NTE" }));
    const c = await sys((ctx) => nextDocumentNumber(ctx, { docType: "INVOICE", scope: org.siteB.id, sitePrefix: "REN" }));
    expect([a, b, c]).toEqual(["NTE-FA-2026-000001", "NTE-FA-2026-000002", "REN-FA-2026-000001"]);
  });

  it("does not leave a gap when the command rolls back", async () => {
    await expect(
      sys(async (ctx) => {
        await nextDocumentNumber(ctx, { docType: "INVOICE", scope: org.siteA.id, sitePrefix: "NTE" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const n = await sys((ctx) => nextDocumentNumber(ctx, { docType: "INVOICE", scope: org.siteA.id, sitePrefix: "NTE" }));
    expect(n).toBe("NTE-FA-2026-000001");
  });

  it("restarts each fiscal year", async () => {
    await sys((ctx) => nextDocumentNumber(ctx, { docType: "INVOICE", scope: org.siteA.id, sitePrefix: "NTE" }));
    const next = await sys(
      (ctx) => nextDocumentNumber(ctx, { docType: "INVOICE", scope: org.siteA.id, sitePrefix: "NTE" }),
      new Date("2027-01-02"),
    );
    expect(next).toBe("NTE-FA-2027-000001");
  });

  it("stays gap-free under concurrent commands", async () => {
    const numbers = await Promise.all(
      Array.from({ length: 10 }, () => sys((ctx) => nextDocumentNumber(ctx, { docType: "CUSTOMER", scope: "GROUP" }))),
    );
    expect(new Set(numbers).size).toBe(10);
    expect([...numbers].sort()).toEqual(Array.from({ length: 10 }, (_, i) => `C${String(i + 1).padStart(6, "0")}`));
  });
});

describe("customers", () => {
  it("creates a customer with number, account, audit entry and event", async () => {
    const c = await sys((ctx) => createCustomer(ctx, { kind: "INDIVIDUAL", firstName: "Jeanne", lastName: "Martin" }));
    expect(c.number).toBe("C000001");
    expect(c.accountCode).toBe("411C000001");
    expect(c.displayName).toBe("Jeanne MARTIN");
    expect(await db.auditLog.count({ where: { entityId: c.id, action: "customer.create" } })).toBe(1);
    expect(await db.domainEvent.count({ where: { aggregateId: c.id, type: "CustomerCreated" } })).toBe(1);
  });

  it("rejects an invalid SIREN with a field error", async () => {
    const err = await sys((ctx) => createCustomer(ctx, { kind: "COMPANY", companyName: "X", siren: "123456789" })).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors.siren).toBeDefined();
  });
});

describe("vehicles", () => {
  it("records the initial status in the history", async () => {
    const v = await sys((ctx) => createVehicle(ctx, vnInput(org.siteA.id), flow));
    const history = await db.vehicleStatusHistory.findMany({ where: { vehicleId: v.id } });
    expect(history).toHaveLength(1);
    expect(history[0].toStatus).toBe("ORDERED");
  });

  it("refuses an initial status outside the stock lifecycle", async () => {
    await expect(sys((ctx) => createVehicle(ctx, { ...vnInput(org.siteA.id), status: "SOLD" }, flow))).rejects.toBeInstanceOf(ValidationError);
  });

  it("enforces unique VIN", async () => {
    await sys((ctx) => createVehicle(ctx, vnInput(org.siteA.id), flow));
    await expect(sys((ctx) => createVehicle(ctx, vnInput(org.siteA.id), flow))).rejects.toMatchObject({ code: "P2002" });
  });

  it("moves along the lifecycle and sets the stock-in date on arrival", async () => {
    const v = await sys((ctx) => createVehicle(ctx, vnInput(org.siteA.id), flow));
    await sys((ctx) => changeVehicleStatus(ctx, v.id, "IN_TRANSIT", null, flow));
    const arrived = await sys((ctx) => changeVehicleStatus(ctx, v.id, "IN_STOCK", "Unloaded", flow), new Date("2026-04-01"));
    expect(arrived.status).toBe("IN_STOCK");
    expect(arrived.stockInDate?.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(await db.vehicleStatusHistory.count({ where: { vehicleId: v.id } })).toBe(3);
  });

  it("rejects an invalid transition and changes nothing", async () => {
    const v = await sys((ctx) => createVehicle(ctx, vnInput(org.siteA.id), flow));
    await expect(sys((ctx) => changeVehicleStatus(ctx, v.id, "DELIVERED", null, flow))).rejects.toBeInstanceOf(InvalidTransitionError);
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("ORDERED");
  });

  it("rolls back the whole command when an event handler fails", async () => {
    const v = await sys((ctx) => createVehicle(ctx, vnInput(org.siteA.id), flow));
    on("VehicleStatusChanged", () => {
      throw new Error("downstream failure");
    });
    await expect(sys((ctx) => changeVehicleStatus(ctx, v.id, "IN_TRANSIT", null, flow))).rejects.toThrow("downstream failure");
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("ORDERED");
    expect(await db.auditLog.count({ where: { entityId: v.id, action: "vehicle.status" } })).toBe(0);
  });

  it("leaves stock cars to the sales flows: no manual creation, status change or commercial edit", async () => {
    // Created by hand, a car in stock would have a value with no purchase behind it.
    const err = await sys((ctx) => createVehicle(ctx, { ...vnInput(org.siteA.id), status: "IN_STOCK" })).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors.stockType).toBeDefined();

    const v = await sys((ctx) => createVehicle(ctx, { ...vnInput(org.siteA.id), listPriceCents: 2_500_000 }, flow));
    await expect(sys((ctx) => changeVehicleStatus(ctx, v.id, "IN_STOCK", "By hand"))).rejects.toBeInstanceOf(ConflictError);
    await expect(sys((ctx) => patchVehicle(ctx, v.id, { stockInDate: new Date("2026-03-15") }))).rejects.toBeInstanceOf(ConflictError);

    // The descriptive fields can be corrected; the site, brand, owner, price and VAT regime stay.
    const owner = await sys((ctx) => createCustomer(ctx, { kind: "INDIVIDUAL", firstName: "Jeanne", lastName: "Martin" }));
    const edited = await sys((ctx) =>
      updateVehicle(ctx, v.id, {
        ...vnInput(org.siteA.id),
        colour: "Blue",
        siteId: org.siteB.id,
        ownerCustomerId: owner.id,
        listPriceCents: 100,
        vatRegime: "MARGIN",
        stockValueCents: 1,
      }),
    );
    expect(edited).toMatchObject({
      colour: "Blue",
      siteId: org.siteA.id,
      ownerCustomerId: null,
      listPriceCents: 2_500_000,
      vatRegime: "STANDARD",
      stockValueCents: 1_500_000,
      status: "ORDERED",
      stockInDate: null,
    });
  });

  it("lets the vehicle screens register and edit a customer's car", async () => {
    const owner = await sys((ctx) => createCustomer(ctx, { kind: "INDIVIDUAL", firstName: "Jeanne", lastName: "Martin" }));
    const car = await sys((ctx) =>
      createVehicle(ctx, { ...vnInput(org.siteA.id), stockType: "NONE", status: "CUSTOMER", siteId: null, ownerCustomerId: owner.id }),
    );
    expect(car).toMatchObject({ stockType: "NONE", status: "CUSTOMER", stockValueCents: 0, stockInDate: null });
    const other = await sys((ctx) => createCustomer(ctx, { kind: "INDIVIDUAL", firstName: "Paul", lastName: "Durand" }));
    const edited = await sys((ctx) =>
      updateVehicle(ctx, car.id, { ...vnInput(org.siteA.id), stockType: "NONE", status: "CUSTOMER", siteId: org.siteB.id, ownerCustomerId: other.id }),
    );
    expect(edited).toMatchObject({ siteId: org.siteB.id, ownerCustomerId: other.id });
  });
});

describe("permissions", () => {
  it("lets a salesperson view but not create vehicles", async () => {
    const actor = await makeActor("SALESPERSON", org.siteA.id);
    await expect(
      runCommand({ actor, siteId: org.siteA.id }, (ctx) => createVehicle(ctx, vnInput(org.siteA.id))),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("scopes a site role to its site", async () => {
    const actor = await makeActor("SALES_MANAGER", org.siteA.id);
    const owner = await sys((ctx) => createCustomer(ctx, { kind: "INDIVIDUAL", firstName: "Jeanne", lastName: "Martin" }));
    const customerCar = (siteId: string, vin?: string) => ({
      ...vnInput(siteId, vin),
      stockType: "NONE" as const,
      status: "CUSTOMER" as const,
      ownerCustomerId: owner.id,
    });
    const ok = await runCommand({ actor, siteId: org.siteA.id }, (ctx) => createVehicle(ctx, customerCar(org.siteA.id)));
    expect(ok.siteId).toBe(org.siteA.id);
    await expect(
      runCommand({ actor, siteId: org.siteB.id }, (ctx) => createVehicle(ctx, customerCar(org.siteB.id, "VF3AAAAA0T7654321"))),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("checks the declared permission before running the command", async () => {
    const actor = await makeActor("TECHNICIAN", org.siteA.id);
    await expect(
      runCommand({ actor, permission: { resource: "customer", action: "create" } }, async () => "ran"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("business clock", () => {
  it("advances one day and publishes BusinessDayAdvanced", async () => {
    await sys((ctx) => setBusinessDate(ctx, new Date("2026-03-31")));
    const seen: string[] = [];
    on("BusinessDayAdvanced", (_ctx, e) => void seen.push(e.payload.to));
    const clock = await db.businessClock.findUniqueOrThrow({ where: { id: 1 } });
    await runCommand({ actor: (await import("@/lib/context")).SYSTEM_ACTOR, businessDate: clock.currentDate }, advanceBusinessDay);
    expect(seen).toEqual(["2026-04-01"]);
    expect((await db.businessClock.findUniqueOrThrow({ where: { id: 1 } })).currentDate.toISOString().slice(0, 10)).toBe("2026-04-01");
  });
});
