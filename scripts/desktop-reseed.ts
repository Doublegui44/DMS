/**
 * Reseed at today's date, inside the desktop app (D-087). Bundled by build-server.mjs into the
 * server folder (reseed.cjs), so it uses the server's Prisma client; the app forks it with
 * DATABASE_URL pointing at its own Postgres. Same steps as `npm run db:reset` without migrations
 * (the schema is already the shipped one): empty every table, then the deterministic seed.
 */
import { db } from "@/lib/db";
import { truncateAll } from "./db-reset";
import { seed } from "../prisma/seed/index";

truncateAll()
  .then(() => seed())
  .then(() => db.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect().catch(() => {});
    process.exit(1);
  });
