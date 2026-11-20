import { db } from "@/lib/db";
import { clearHandlers } from "@/lib/events";
import { registerAllHandlers } from "@/modules/register";
import { loadActor } from "@/lib/actor";
import { runCommand, SYSTEM_ACTOR, type ServiceContext } from "@/lib/context";
import { assertSafeDatabase, truncateAll } from "../../scripts/db-reset";
import { seedRolesAndPermissions, createUser, type RoleKey } from "@/modules/admin";

export const sys = <T>(fn: (ctx: ServiceContext) => Promise<T>, businessDate = new Date("2026-03-15")) =>
  runCommand({ actor: SYSTEM_ACTOR, siteId: null, businessDate }, fn);

/** Wipe dms_test and create a minimal organisation: FR, 2 sites, 1 brand, roles. */
export async function resetWithMinimalOrg() {
  assertSafeDatabase();
  await truncateAll();
  await db.country.create({ data: { code: "FR", name: "France" } });
  const group = await db.group.create({ data: { name: "Test group", legalName: "Test SAS" } });
  const brand = await db.brand.create({ data: { code: "PEUGEOT", name: "Peugeot", groupId: group.id } });
  const mk = (code: string, slug: string) =>
    db.site.create({
      data: {
        groupId: group.id,
        code,
        slug,
        name: slug,
        address: "1 rue",
        postalCode: "44000",
        city: slug,
        countryCode: "FR",
        labourRateCents: 9500,
      },
    });
  const siteA = await mk("NTE", "nantes");
  const siteB = await mk("REN", "rennes");
  await sys((ctx) => seedRolesAndPermissions(ctx));
  return { group, brand, siteA, siteB };
}

export async function makeActor(role: RoleKey, siteId: string | null, email = `${role.toLowerCase()}@t.test`) {
  const user = await sys((ctx) =>
    createUser(ctx, { email, firstName: "T", lastName: role, password: "password123", roles: [{ roleKey: role, siteId }] }),
  );
  const actor = await loadActor(user.id);
  if (!actor) throw new Error("actor");
  return actor;
}

export { db };

/** Drop ad-hoc test handlers and re-register the modules' own (runCommand refuses to run without them). */
export function resetHandlers() {
  clearHandlers();
  registerAllHandlers();
}

/** Minimal org + VAT rates + default chart, journals and mappings. */
export async function resetWithAccounting() {
  const org = await resetWithMinimalOrg();
  const { installDefaultChart } = await import("@/modules/accounting");
  await db.vatRate.createMany({
    data: [
      { countryCode: "FR", code: "STANDARD", label: "20 %", rateBp: 2000, validFrom: new Date("2014-01-01") },
      { countryCode: "FR", code: "INTERMEDIATE", label: "10 %", rateBp: 1000, validFrom: new Date("2014-01-01") },
      { countryCode: "FR", code: "REDUCED", label: "5.5 %", rateBp: 550, validFrom: new Date("2014-01-01") },
      { countryCode: "FR", code: "ZERO", label: "0 %", rateBp: 0, validFrom: new Date("2014-01-01") },
    ],
  });
  await sys((ctx) => installDefaultChart(ctx));
  return org;
}

/**
 * Accounting org + what sales needs: the brand sold at site A (WMI, OEM customer and supplier),
 * discount approval rules, a small catalogue (208 Allure, one paint option), one add-on product,
 * open periods for 2026 and a customer.
 */
export async function resetWithSales() {
  const org = await resetWithAccounting();
  const { createCustomer, createSupplier } = await import("@/modules/core");
  const { ensurePeriods } = await import("@/modules/accounting");
  await sys((ctx) => ensurePeriods(ctx.tx, new Date("2026-01-01"), new Date("2026-12-31")));
  await db.siteBrand.create({ data: { siteId: org.siteA.id, brandId: org.brand.id } });
  const oemCustomer = await sys((ctx) => createCustomer(ctx, { kind: "OEM", companyName: "Peugeot France (OEM)", paymentTermsDays: 45 }));
  const oemSupplier = await sys((ctx) => createSupplier(ctx, { name: "Peugeot France — Distribution", isOem: true, paymentTermsDays: 30 }));
  const bodyshop = await sys((ctx) => createSupplier(ctx, { name: "Carrosserie Test", paymentTermsDays: 30 }));
  const auction = await sys((ctx) => createSupplier(ctx, { name: "Enchères Test", paymentTermsDays: 15 }));
  await db.brand.update({ where: { id: org.brand.id }, data: { wmi: "VF3", oemCustomerId: oemCustomer.id, oemSupplierId: oemSupplier.id } });
  const roles = await db.role.findMany({ where: { key: { in: ["SALES_MANAGER", "DEALER_PRINCIPAL"] } } });
  const roleId = (k: string) => roles.find((r) => r.key === k)!.id;
  await db.approvalRule.createMany({
    data: [
      { key: "deal.discount", label: "Discount above 5 %", thresholdBp: 500, approverRoleId: roleId("SALES_MANAGER") },
      { key: "deal.discount", label: "Discount above 10 %", thresholdBp: 1000, approverRoleId: roleId("DEALER_PRINCIPAL") },
    ],
  });
  const model = await db.catalogueModel.create({ data: { brandId: org.brand.id, name: "208" } });
  const version = await db.catalogueVersion.create({
    data: {
      modelId: model.id,
      code: "P208-ALL-HY100",
      name: "Allure Hybrid 100",
      fuel: "HYBRID",
      co2: 102,
      powerHp: 100,
      listPriceExclVatCents: 2_108_333,
      dealerCostCents: 1_813_167,
      oemIncentiveCents: 50_000,
      leadTimeDays: 45,
      options: { create: [{ code: "PAINT-MET", label: "Metallic paint", kind: "PAINT", listPriceExclVatCents: 57_500, dealerCostCents: 43_125 }] },
    },
    include: { options: true },
  });
  const addOn = await db.addOnProduct.create({ data: { code: "WAR24", kind: "WARRANTY", name: "Extended warranty 24 months", months: 24, priceExclVatCents: 59_000, costCents: 32_000 } });
  const customer = await sys((ctx) =>
    createCustomer(ctx, { kind: "INDIVIDUAL", firstName: "Jeanne", lastName: "Martin", address: "4 rue de la Paix", postalCode: "44000", city: "Nantes", homeSiteId: org.siteA.id }),
  );
  return { ...org, oemCustomer, oemSupplier, bodyshop, auction, version, option: version.options[0], addOn, customer };
}

/** Net balance (debit − credit) of an account, optionally for one site and one party. */
export async function balanceOf(accountCode: string, opts: { siteId?: string; partyId?: string } = {}) {
  const agg = await db.journalLine.aggregate({
    where: { accountCode, ...(opts.siteId ? { siteId: opts.siteId } : {}), ...(opts.partyId ? { partyId: opts.partyId } : {}) },
    _sum: { debitCents: true, creditCents: true },
  });
  return (agg._sum.debitCents ?? 0) - (agg._sum.creditCents ?? 0);
}

/**
 * Accounting org + what parts needs: open 2026 periods, the brand's OEM supplier and an
 * aftermarket one, two discount codes with their matrix rows, four parts (one superseded by
 * another), a retail customer and a trade (garage) customer.
 */
export async function resetWithParts() {
  const org = await resetWithAccounting();
  const { createCustomer, createSupplier } = await import("@/modules/core");
  const { ensurePeriods } = await import("@/modules/accounting");
  await sys((ctx) => ensurePeriods(ctx.tx, new Date("2026-01-01"), new Date("2026-12-31")));
  const oem = await sys((ctx) => createSupplier(ctx, { name: "Peugeot France — Pièces", isOem: true, paymentTermsDays: 30 }));
  const aftermarket = await sys((ctx) => createSupplier(ctx, { name: "Autodistribution Test", paymentTermsDays: 45 }));
  await db.brand.update({ where: { id: org.brand.id }, data: { oemSupplierId: oem.id } });
  const codeA = await db.discountCode.create({ data: { code: "A", label: "Fast movers", rates: { create: [{ priceClass: "TRADE", discountBp: 2_500 }, { priceClass: "INTERNAL", discountBp: 3_000 }] } } });
  const codeB = await db.discountCode.create({ data: { code: "B", label: "Consumables", rates: { create: [{ priceClass: "TRADE", discountBp: 1_000 }] } } });
  const part = (partNumber: string, description: string, retailPriceCents: number, listCostCents: number, extra: Record<string, unknown> = {}) =>
    db.part.create({
      data: { partNumber, description, family: "BRAKES", brandId: org.brand.id, supplierId: oem.id, discountCodeId: codeA.id, retailPriceCents, listCostCents, ...extra },
    });
  const pads = await part("1609438180", "Front brake pads", 6_500, 4_200);
  const padsOld = await part("1609438100", "Front brake pads (old)", 6_200, 4_000);
  const filter = await part("1109AY", "Oil filter", 1_490, 690, { family: "FILTERS" });
  const oil = await part("ATO5W30", "Engine oil 5W-30", 1_200, 600, { family: "FLUIDS", brandId: null, supplierId: aftermarket.id, discountCodeId: codeB.id, unit: "L" });
  await db.partSupersession.create({ data: { oldPartId: padsOld.id, newPartId: pads.id, effectiveOn: new Date("2026-01-01") } });
  const retail = await sys((ctx) => createCustomer(ctx, { kind: "INDIVIDUAL", firstName: "Paul", lastName: "Durand", city: "Nantes" }));
  const garage = await sys((ctx) => createCustomer(ctx, { kind: "COMPANY", companyName: "Garage du Port", priceClass: "TRADE", paymentTermsDays: 30, city: "Nantes" }));
  return { ...org, oem, aftermarket, codeA, codeB, pads, padsOld, filter, oil, retail, garage };
}

/** Sum of the parts stock sub-ledger (stock items' values), optionally for one site. */
export async function partsStockValue(siteId?: string) {
  const agg = await db.stockItem.aggregate({ where: siteId ? { siteId } : {}, _sum: { valueCents: true } });
  return agg._sum.valueCents ?? 0;
}

/**
 * Sales org (brand with its OEM customer, a customer) + what the workshop needs: parts with a
 * discount code (trade, internal and warranty rates) and stock, two labour operations, an insurer,
 * the customer's own car, and a technician, an advisor and a workshop manager at site A.
 */
export async function resetWithWorkshop() {
  const org = await resetWithSales();
  const { createCustomer, createSupplier, createVehicle } = await import("@/modules/core");
  const { createPurchaseOrder, sendPurchaseOrder, receivePurchaseOrder } = await import("@/modules/parts");
  const partsSupplier = await sys((ctx) => createSupplier(ctx, { name: "Peugeot France — Pièces", paymentTermsDays: 30 }));
  const code = await db.discountCode.create({
    data: { code: "A", label: "Fast movers", rates: { create: [{ priceClass: "TRADE", discountBp: 2_500 }, { priceClass: "INTERNAL", discountBp: 3_000 }, { priceClass: "WARRANTY", discountBp: 1_000 }] } },
  });
  const part = (partNumber: string, description: string, retailPriceCents: number, listCostCents: number, extra: Record<string, unknown> = {}) =>
    db.part.create({ data: { partNumber, description, family: "BRAKES", brandId: org.brand.id, supplierId: partsSupplier.id, discountCodeId: code.id, retailPriceCents, listCostCents, ...extra } });
  const pads = await part("1609438180", "Front brake pads", 6_500, 4_200);
  const filter = await part("1109AY", "Oil filter", 1_490, 690, { family: "FILTERS" });
  const oil = await part("ATO5W30", "Engine oil 5W-30", 1_200, 600, { family: "CONSUMABLES", brandId: null, unit: "L" });
  const po = await sys((ctx) =>
    createPurchaseOrder(ctx, { siteId: org.siteA.id, supplierId: partsSupplier.id, lines: [{ partNumber: pads.partNumber, qty: 10 }, { partNumber: filter.partNumber, qty: 10 }, { partNumber: oil.partNumber, qty: "50" }] }),
  );
  await sys((ctx) => sendPurchaseOrder(ctx, po.id));
  const poLines = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
  await sys((ctx) => receivePurchaseOrder(ctx, po.id, { lines: poLines.map((l) => ({ poLineId: l.id, qty: String(l.qtyOrdered) })) }));

  const oilService = await db.labourOperation.create({ data: { code: "OIL-SVC", label: "Oil and filter change", category: "SERVICE", standardCentiHours: 80 } });
  const brakePads = await db.labourOperation.create({ data: { code: "BRK-PADS-F", label: "Replace front brake pads", category: "BRAKES", brandId: org.brand.id, standardCentiHours: 120 } });
  const insurer = await sys((ctx) => createCustomer(ctx, { kind: "COMPANY", companyName: "Assurance Test", paymentTermsDays: 30 }));
  const car = await sys((ctx) =>
    createVehicle(ctx, {
      vin: "VF3AAAAA0K2222222",
      registration: "AB-123-CD",
      brandId: org.brand.id,
      make: "Peugeot",
      model: "308",
      version: "Allure 1.2 PureTech 130",
      mileage: 40_000,
      fuel: "PETROL",
      stockType: "NONE",
      status: "CUSTOMER",
      ownerCustomerId: org.customer.id,
      firstRegistration: "2021-03-01",
    }),
  );
  const technician = await makeActor("TECHNICIAN", org.siteA.id, "tech@t.test");
  await db.technician.create({ data: { userId: technician.userId!, siteId: org.siteA.id, dailyCapacityCentiHours: 780 } });
  const advisor = await makeActor("SERVICE_ADVISOR", org.siteA.id, "advisor@t.test");
  const workshopManager = await makeActor("SERVICE_MANAGER", org.siteA.id, "workshop@t.test");
  return { ...org, partsSupplier, code, pads, filter, oil, oilService, brakePads, insurer, car, technician, advisor, workshopManager };
}
