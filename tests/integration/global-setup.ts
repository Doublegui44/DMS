import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

/** Apply migrations to dms_test once before the run (non-destructive). */
export default function setup() {
  const env = loadEnv({ path: ".env.test" }).parsed ?? {};
  if (!env.DATABASE_URL?.includes("dms_test")) throw new Error("Integration tests must use dms_test");
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, ...env } });
}
