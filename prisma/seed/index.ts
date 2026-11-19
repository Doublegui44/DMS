/**
 * Seed — organisation, roles, users, customers, vehicles (v1), accounting (Phase 2).
 * Everything business-related goes through the service layer (runCommand + services),
 * so the same rules, numbering, audit and events apply as in the UI.
 *
 * Deterministic: faker.seed(42). Run with `npm run db:seed` (or `npm run db:reset`).
 */
import { faker } from "@faker-js/faker/locale/fr";
import { db } from "@/lib/db";
import { runCommand, SYSTEM_ACTOR } from "@/lib/context";
import { addDays, localToday } from "@/lib/dates";
import { roundCents } from "@/lib/money";
import {
  addContact,
  createCustomer,
  createVehicle,
  frenchVatNumber,
  generateFrenchPlate,
  generateVin,
  setBusinessDate,
  type VehicleInput,
} from "@/modules/core";
import { createUser, seedRolesAndPermissions, type RoleKey } from "@/modules/admin";
import { seedAccounting } from "./accounting";
import { APPROVAL_RULES, BRANDS, COLOURS, SETTINGS, SITES, VN_MODELS, VO_MODELS } from "./data";

export const DEMO_PASSWORD = "demo1234";
const SEED = 42;

const sys = <T>(fn: Parameters<typeof runCommand<T>>[1], siteId: string | null = null, businessDate?: Date) =>
  runCommand({ actor: SYSTEM_ACTOR, siteId, businessDate }, fn);

const rnd = () => faker.number.float({ min: 0, max: 1, fractionDigits: 6 }) % 1;

function sirenFromSeed(): string {
  // 8 random digits + Luhn check digit.
  const base = faker.string.numeric({ length: 8, allowLeadingZeros: false });
  for (let d = 0; d <= 9; d++) {
    const s = base + d;
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      let n = Number(s[i]);
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
    }
    if (sum % 10 === 0) return s;
  }
  throw new Error("unreachable");
}

async function seedOrganisation(today: Date) {
  await db.country.create({ data: { code: "FR", name: "France", currency: "EUR", defaultLocale: "fr-FR" } });
  await db.vatRate.createMany({
    data: [
      { countryCode: "FR", code: "STANDARD", label: "TVA 20 %", rateBp: 2000, validFrom: new Date("2014-01-01") },
      { countryCode: "FR", code: "INTERMEDIATE", label: "TVA 10 %", rateBp: 1000, validFrom: new Date("2014-01-01") },
      { countryCode: "FR", code: "REDUCED", label: "TVA 5,5 %", rateBp: 550, validFrom: new Date("2014-01-01") },
      { countryCode: "FR", code: "ZERO", label: "Exonéré", rateBp: 0, validFrom: new Date("2014-01-01") },
    ],
  });
  const groupSiren = "552081317";
  const group = await db.group.create({
    data: {
      name: "Groupe Atlantique Automobiles",
      legalName: "Atlantique Automobiles SAS",
      siren: groupSiren,
      vatNumber: frenchVatNumber(groupSiren),
    },
  });
  const brands = new Map<string, string>();
  for (const b of BRANDS) {
    const brand = await db.brand.create({ data: { code: b.code, name: b.name, groupId: group.id } });
    brands.set(b.code, brand.id);
  }
  const sites = new Map<string, string>();
  for (const s of SITES) {
    const site = await db.site.create({
      data: {
        groupId: group.id,
        code: s.code,
        slug: s.slug,
        name: s.name,
        address: s.address,
        postalCode: s.postalCode,
        city: s.city,
        countryCode: "FR",
        phone: s.phone,
        labourRateCents: s.labourRateCents,
        brands: { create: s.brands.map((code) => ({ brandId: brands.get(code)! })) },
        departments: {
          create: [
            { code: "VN", name: "New vehicles" },
            { code: "VO", name: "Used vehicles" },
            { code: "WORKSHOP", name: "Workshop" },
            { code: "PARTS", name: "Parts" },
            { code: "ACCOUNTING", name: "Accounting" },
            { code: "OVERHEAD", name: "Overheads" },
          ],
        },
      },
    });
    sites.set(s.code, site.id);
  }
  for (const [key, value] of Object.entries(SETTINGS)) {
    await db.setting.create({ data: { key, value: value as object } });
  }
  await sys((ctx) => setBusinessDate(ctx, today));
  return { groupId: group.id, brands, sites };
}

interface UserPlan {
  email: string;
  role: RoleKey;
  site: string | null;
  isTechnician?: boolean;
}

function userPlan(): UserPlan[] {
  const plan: UserPlan[] = [
    { email: "admin@dms.test", role: "ADMIN", site: null },
    { email: "dealer.principal@dms.test", role: "DEALER_PRINCIPAL", site: null },
    { email: "accountant@dms.test", role: "ACCOUNTANT", site: null },
  ];
  for (const s of SITES) {
    const slug = s.slug;
    plan.push(
      { email: `sales.manager.${slug}@dms.test`, role: "SALES_MANAGER", site: s.code },
      { email: `salesperson1.${slug}@dms.test`, role: "SALESPERSON", site: s.code },
      { email: `salesperson2.${slug}@dms.test`, role: "SALESPERSON", site: s.code },
      { email: `service.manager.${slug}@dms.test`, role: "SERVICE_MANAGER", site: s.code },
      { email: `service.advisor.${slug}@dms.test`, role: "SERVICE_ADVISOR", site: s.code },
      { email: `technician1.${slug}@dms.test`, role: "TECHNICIAN", site: s.code, isTechnician: true },
      { email: `technician2.${slug}@dms.test`, role: "TECHNICIAN", site: s.code, isTechnician: true },
      { email: `parts.manager.${slug}@dms.test`, role: "PARTS_MANAGER", site: s.code },
    );
  }
  plan.push({ email: "parts.advisor.nantes@dms.test", role: "PARTS_ADVISOR", site: "NTE" });
  return plan;
}

async function seedUsers(sites: Map<string, string>) {
  await sys((ctx) => seedRolesAndPermissions(ctx));
  const roles = await db.role.findMany();
  const roleId = new Map(roles.map((r) => [r.key, r.id]));
  for (const rule of APPROVAL_RULES) {
    await db.approvalRule.create({
      data: { key: rule.key, label: rule.label, thresholdBp: rule.thresholdBp, approverRoleId: roleId.get(rule.role)! },
    });
  }
  for (const u of userPlan()) {
    await sys((ctx) =>
      createUser(ctx, {
        email: u.email,
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        phone: faker.phone.number({ style: "national" }),
        isTechnician: u.isTechnician ?? false,
        password: DEMO_PASSWORD,
        roles: [{ roleKey: u.role, siteId: u.site ? sites.get(u.site)! : null }],
      }),
    );
  }
}

async function seedCustomers(sites: Map<string, string>, brands: Map<string, string>) {
  const siteIds = [...sites.values()];
  // OEM customers (warranty receivables).
  for (const b of BRANDS) {
    const siren = sirenFromSeed();
    const oem = await sys((ctx) =>
      createCustomer(ctx, {
        kind: "OEM",
        companyName: b.oemName,
        siren,
        vatNumber: frenchVatNumber(siren),
        priceClass: "WARRANTY",
        paymentTermsDays: 45,
        email: `warranty@${b.code.toLowerCase()}-oem.test`,
        city: "Paris",
        postalCode: "75008",
        address: faker.location.streetAddress(),
        countryCode: "FR",
      }),
    );
    await db.brand.update({ where: { id: brands.get(b.code)! }, data: { oemCustomerId: oem.id } });
  }

  const customerIds: string[] = [];
  const TOTAL = 300;
  for (let i = 0; i < TOTAL; i++) {
    const isCompany = i % 7 === 0;
    const homeSiteId = faker.helpers.arrayElement(siteIds);
    const site = SITES.find((s) => sites.get(s.code) === homeSiteId)!;
    const nearby = faker.datatype.boolean(0.7);
    const common = {
      email: undefined as string | undefined,
      phone: faker.phone.number({ style: "national" }),
      address: faker.location.streetAddress(),
      postalCode: nearby ? site.postalCode.slice(0, 2) + faker.string.numeric(3) : faker.location.zipCode(),
      city: nearby ? site.city : faker.location.city(),
      countryCode: "FR",
      homeSiteId,
      consentEmail: faker.datatype.boolean(0.55),
      consentSms: faker.datatype.boolean(0.35),
      consentPhone: faker.datatype.boolean(0.25),
    };
    let created;
    if (isCompany) {
      const siren = sirenFromSeed();
      const companyName = faker.company.name();
      created = await sys(
        (ctx) =>
          createCustomer(ctx, {
            ...common,
            kind: "COMPANY",
            companyName,
            siren,
            vatNumber: frenchVatNumber(siren),
            email: `contact@${faker.internet.domainWord()}.test`,
            priceClass: faker.datatype.boolean(0.3) ? "TRADE" : "RETAIL",
            paymentTermsDays: 30,
          }),
        homeSiteId,
      );
      await sys(async (ctx) => {
        await addContact(ctx, created!.id, {
          firstName: faker.person.firstName(),
          lastName: faker.person.lastName(),
          role: faker.helpers.arrayElement(["Fleet manager", "Gérant", "Office manager", "Directeur administratif"]),
          email: `fleet@${faker.internet.domainWord()}.test`,
          phone: faker.phone.number({ style: "national" }),
          isPrimary: true,
        });
      }, homeSiteId);
    } else {
      const sex = faker.helpers.arrayElement(["female", "male"] as const);
      const firstName = faker.person.firstName(sex);
      const lastName = faker.person.lastName();
      created = await sys(
        (ctx) =>
          createCustomer(ctx, {
            ...common,
            kind: "INDIVIDUAL",
            title: sex === "female" ? "Mme" : "M.",
            firstName,
            lastName,
            email: faker.datatype.boolean(0.85)
              ? faker.internet.email({ firstName, lastName, provider: "example.test" }).toLowerCase()
              : undefined,
          }),
        homeSiteId,
      );
    }
    customerIds.push(created.id);
  }
  return customerIds;
}

async function seedVehicles(
  today: Date,
  sites: Map<string, string>,
  brands: Map<string, string>,
  customerIds: string[],
) {
  const vins = new Set<string>();
  const plates = new Set<string>();
  const uniqueVin = (wmi: string, yearCode: string) => {
    for (;;) {
      const v = generateVin(wmi, rnd, yearCode);
      if (!vins.has(v)) {
        vins.add(v);
        return v;
      }
    }
  };
  const uniquePlate = () => {
    for (;;) {
      const p = generateFrenchPlate(rnd);
      if (!plates.has(p)) {
        plates.add(p);
        return p;
      }
    }
  };
  const create = (input: VehicleInput, siteId: string | null) => sys((ctx) => createVehicle(ctx, input), siteId);

  // ── VN stock: ~90 vehicles across sites, matching each site's brands.
  let vnCount = 0;
  for (const s of SITES) {
    const siteId = sites.get(s.code)!;
    const perSite = s.brands.length === 2 ? 40 : 25;
    for (let i = 0; i < perSite; i++) {
      const brandCode = s.brands[i % s.brands.length];
      const brand = BRANDS.find((b) => b.code === brandCode)!;
      const model = faker.helpers.arrayElement(VN_MODELS[brandCode]);
      const version = faker.helpers.arrayElement(model.versions);
      const status = faker.helpers.weightedArrayElement([
        { value: "IN_STOCK" as const, weight: 7 },
        { value: "IN_TRANSIT" as const, weight: 2 },
        { value: "ORDERED" as const, weight: 1 },
      ]);
      const priceCents = version.priceEuros * 100 + faker.helpers.arrayElement([0, 0, 59000, 89000, 120000]);
      const daysInStock = faker.number.int({ min: 0, max: 160 });
      await create(
        {
          vin: uniqueVin(brand.wmi, "T"),
          registration: null,
          brandId: brands.get(brandCode)!,
          make: brand.name,
          model: model.model,
          version: version.name,
          mileage: faker.number.int({ min: 5, max: 40 }),
          fuel: version.fuel,
          co2: version.co2,
          powerHp: version.hp,
          colour: faker.helpers.arrayElement(COLOURS),
          stockType: "VN",
          status,
          siteId,
          listPriceCents: priceCents,
          // Dealer cost ≈ 84–88 % of the excl.-VAT list price.
          stockValueCents: roundCents((priceCents / 1.2) * faker.number.float({ min: 0.84, max: 0.88 })),
          stockInDate: status === "IN_STOCK" ? addDays(today, -daysInStock) : null,
          vatRegime: "STANDARD",
        },
        siteId,
      );
      vnCount++;
    }
  }

  // ── VO stock: ~60 used vehicles.
  let voCount = 0;
  for (let i = 0; i < 60; i++) {
    const s = SITES[i % SITES.length];
    const siteId = sites.get(s.code)!;
    const maker = faker.helpers.weightedArrayElement(
      VO_MODELS.map((m) => ({ value: m, weight: m.brandCode && (s.brands as readonly string[]).includes(m.brandCode) ? 4 : 1 })),
    );
    const m = faker.helpers.arrayElement(maker.models);
    const ageYears = faker.number.int({ min: 1, max: 8 });
    const firstReg = addDays(today, -Math.round(ageYears * 365 + faker.number.int({ min: 0, max: 300 })));
    const mileage = Math.round(ageYears * faker.number.int({ min: 9_000, max: 18_000 }) / 100) * 100;
    // Simple depreciation curve for a plausible market value.
    const marketEuros = m.newPriceEuros * Math.pow(0.85, ageYears) * (1 - Math.min(mileage, 200_000) / 1_000_000);
    const listPriceCents = Math.round(marketEuros / 100) * 10_000 - 10_00; // ends in …990 €
    const purchaseCents = roundCents(listPriceCents * faker.number.float({ min: 0.78, max: 0.86 }));
    const fromPrivate = faker.datatype.boolean(0.7);
    const status = faker.helpers.weightedArrayElement([
      { value: "FOR_SALE" as const, weight: 7 },
      { value: "RECONDITIONING" as const, weight: 2 },
      { value: "INTAKE" as const, weight: 1 },
    ]);
    await create(
      {
        vin: uniqueVin(maker.wmi, "L"),
        registration: uniquePlate(),
        brandId: maker.brandCode ? brands.get(maker.brandCode)! : null,
        make: maker.make,
        model: m.model,
        version: m.version,
        firstRegistration: firstReg,
        mileage,
        fuel: m.fuel,
        powerHp: m.hp,
        colour: faker.helpers.arrayElement(COLOURS),
        stockType: "VO",
        status,
        siteId,
        listPriceCents,
        stockValueCents: purchaseCents,
        stockInDate: addDays(today, -faker.number.int({ min: 2, max: 150 })),
        vatRegime: fromPrivate ? "MARGIN" : "STANDARD",
      },
      siteId,
    );
    voCount++;
  }

  // ── Customer vehicles (not in stock), seen by the workshop: ~1 per individual customer.
  let customerVehicles = 0;
  for (const ownerId of customerIds) {
    if (!faker.datatype.boolean(0.7)) continue;
    const maker = faker.helpers.weightedArrayElement(
      VO_MODELS.map((m) => ({ value: m, weight: m.brandCode ? 4 : 1 })),
    );
    const m = faker.helpers.arrayElement(maker.models);
    const ageYears = faker.number.int({ min: 0, max: 12 });
    await create(
      {
        vin: uniqueVin(maker.wmi, "K"),
        registration: uniquePlate(),
        brandId: maker.brandCode ? brands.get(maker.brandCode)! : null,
        make: maker.make,
        model: m.model,
        version: m.version,
        firstRegistration: addDays(today, -Math.round(ageYears * 365 + faker.number.int({ min: 30, max: 300 }))),
        mileage: Math.round((ageYears + 0.5) * faker.number.int({ min: 8_000, max: 20_000 }) / 100) * 100,
        fuel: m.fuel,
        powerHp: m.hp,
        colour: faker.helpers.arrayElement(COLOURS),
        stockType: "NONE",
        status: "CUSTOMER",
        ownerCustomerId: ownerId,
      },
      null,
    );
    customerVehicles++;
  }
  return { vnCount, voCount, customerVehicles };
}

export async function seed() {
  faker.seed(SEED);
  const started = Date.now();
  const today = localToday();
  const { brands, sites } = await seedOrganisation(today);
  await seedUsers(sites);
  const customerIds = await seedCustomers(sites, brands);
  const vehicles = await seedVehicles(today, sites, brands, customerIds);
  const accounting = await seedAccounting(today, sites, brands, customerIds);
  const counts = {
    sites: sites.size,
    users: await db.user.count(),
    customers: await db.customer.count(),
    ...vehicles,
    ...accounting,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  console.log("Seed complete", counts);
  return counts;
}
