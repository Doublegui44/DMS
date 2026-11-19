/**
 * Reset a LOCAL dms_* database to the known seed state: apply migrations, truncate every
 * table, reseed. Refuses to run on anything that is not a local database named dms_*.
 *
 *   npm run db:reset                 → DATABASE_URL from .env (dms_dev)
 *   npm run db:reset -- --no-seed    → empty tables only
 */
import { execSync } from "node:child_process";
import { db } from "@/lib/db";
import { seed } from "../prisma/seed/index";

export function assertSafeDatabase(url = process.env.DATABASE_URL ?? "") {
  const u = new URL(url);
  const name = u.pathname.replace(/^\//, "");
  const host = u.searchParams.get("host") ?? u.hostname;
  const local = ["localhost", "127.0.0.1", "::1", "/tmp", "/var/run/postgresql"].includes(host);
  if (!local || !name.startsWith("dms_")) {
    throw new Error(`Refusing to reset database "${name}" on "${host}": only local dms_* databases can be reset.`);
  }
  return name;
}

export async function truncateAll() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

async function main() {
  const name = assertSafeDatabase();
  console.log(`Resetting ${name}…`);
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  await truncateAll();
  if (!process.argv.includes("--no-seed")) await seed();
}

if (process.argv[1]?.endsWith("db-reset.ts")) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
