import { db } from "@/lib/db";
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
