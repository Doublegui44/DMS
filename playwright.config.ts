import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// e2e uses its own database (dms_e2e), reset and seeded before the server starts.
const env = loadEnv({ path: ".env.e2e" }).parsed ?? {};
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx tsx scripts/db-reset.ts && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { ...env, NEXT_DIST_DIR: ".next-e2e" },
  },
});
