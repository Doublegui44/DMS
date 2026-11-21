import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

// Integration tests run against dms_test (wiped between test files).
const env = loadEnv({ path: ".env.test" }).parsed ?? {};

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  esbuild: { jsx: "automatic" }, // as Next.js compiles it (PDF templates are .tsx)
  test: {
    env,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false, // integration files share one database
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
