// Builds the Next.js standalone server for the desktop app (D-087) into desktop/build/server,
// with the seed bundled beside it (reseed.cjs) for Reseed at today's date.
// The web app is built from the repository root with NEXT_STANDALONE=1 into .next-desktop, so
// dev, CI and e2e builds are untouched. Env files are never copied into the app.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "..");
const dist = path.join(root, ".next-desktop");
const out = path.join(desktop, "build", "server");

execSync("npx prisma generate", { cwd: root, stdio: "inherit" });
execSync("npx next build", {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NEXT_STANDALONE: "1", NEXT_DIST_DIR: ".next-desktop", AUTH_SECRET: "build-only-placeholder", NEXT_TELEMETRY_DISABLED: "1" },
});

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(dist, "standalone"), out, { recursive: true, verbatimSymlinks: true });
for (const f of fs.readdirSync(out)) if (f.startsWith(".env")) fs.rmSync(path.join(out, f));
fs.cpSync(path.join(dist, "static"), path.join(out, ".next-desktop", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
// Next's standalone trace copies typescript for next.config.ts; the server never needs it.
fs.rmSync(path.join(out, "node_modules", "typescript"), { recursive: true, force: true });

// Reseed at today's date: the seed bundled next to server.js, sharing its Prisma client.
execSync(
  `${path.join(desktop, "node_modules", ".bin", "esbuild")} scripts/desktop-reseed.ts --bundle --platform=node --format=cjs --target=node22 --external:@prisma/client --external:.prisma --outfile=${JSON.stringify(path.join(out, "reseed.cjs"))} --log-level=warning`,
  { cwd: root, stdio: "inherit" },
);

const leftovers = fs.readdirSync(out).filter((f) => f.startsWith(".env"));
if (leftovers.length) throw new Error(`Env files left in the server: ${leftovers.join(", ")}`);
console.log(`Server ready in ${path.relative(root, out)}`);
