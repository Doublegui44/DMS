import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      ".next-e2e/**",
      ".next-e2e-build/**",
      ".next-preview/**",
      ".next-desktop/**",
      "desktop/**",
      "test-results/**",
      "playwright-report/**",
      "src/components/ui/**",
    ],
  },
  {
    // Module boundaries: import other modules only through their public index.ts.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/*/*", "!@/modules/*/index"],
              message: "Import other modules through their public API (@/modules/<name>), not their internals.",
            },
          ],
        },
      ],
    },
  },
  {
    // Inside a module, relative imports are used; tests may reach into domain internals.
    files: ["tests/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Business code reads the simulated clock, never wall-clock time.
    files: ["src/modules/*/domain/**/*.ts", "src/modules/*/services/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "Use ctx.businessDate (D-009)." },
      ],
    },
  },
];

export default eslintConfig;
