import { defineConfig } from "@playwright/test";

/** Desktop smoke tests (D-087): they launch the packaged app, so build it first (npm run dist:mac). */
export default defineConfig({
  testDir: "tests",
  workers: 1,
  timeout: 600_000,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
});
