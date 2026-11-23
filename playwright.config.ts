import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// e2e uses its own database (dms_e2e), reset and seeded while a production build is made
// (scripts/e2e-server.sh; E2E_DEV=1 runs the dev server instead). D-076.
const env = loadEnv({ path: ".env.e2e" }).parsed ?? {};
const PORT = 3100;
const DEV = process.env.E2E_DEV === "1";

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
    command: "sh scripts/e2e-server.sh",
    url: `http://localhost:${PORT}/login`,
    timeout: 420_000,
    reuseExistingServer: false,
    env: { ...env, PORT: String(PORT), E2E_DEV: DEV ? "1" : "", NEXT_DIST_DIR: DEV ? ".next-e2e" : ".next-e2e-build" },
  },
});
