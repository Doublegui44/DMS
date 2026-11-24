// electron-builder afterPack hook (D-087), run before signing.
// 1. Copies the Next.js standalone server into Resources/server: electron-builder drops
//    node_modules folders from extraResources, and the server needs its own.
// 2. macOS: the Postgres libraries come from npm as three identical copies per library
//    (libx.dylib, libx.68.dylib, libx.68.2.dylib); the copies become symlinks again (~180 MB).
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const resources =
    electronPlatformName === "darwin"
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");

  const server = path.join(packager.projectDir, "build", "server");
  if (!fs.existsSync(path.join(server, "server.js"))) throw new Error("Run npm run build:server first");
  fs.cpSync(server, path.join(resources, "server"), { recursive: true, verbatimSymlinks: true });

  if (electronPlatformName !== "darwin") return;
  const pgRoot = path.join(resources, "app", "node_modules", "@embedded-postgres");
  for (const pkg of fs.existsSync(pgRoot) ? fs.readdirSync(pgRoot) : []) {
    const lib = path.join(pgRoot, pkg, "native", "lib");
    if (!fs.existsSync(lib)) continue;
    const byHash = new Map();
    for (const name of fs.readdirSync(lib)) {
      const file = path.join(lib, name);
      if (!name.endsWith(".dylib") || fs.lstatSync(file).isSymbolicLink()) continue;
      const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      (byHash.get(hash) ?? byHash.set(hash, []).get(hash)).push(name);
    }
    let saved = 0;
    for (const names of byHash.values()) {
      if (names.length < 2) continue;
      // Keep the most specific name (libicudata.68.2.dylib); the others point to it.
      names.sort((a, b) => b.length - a.length);
      for (const alias of names.slice(1)) {
        saved += fs.statSync(path.join(lib, alias)).size;
        fs.rmSync(path.join(lib, alias));
        fs.symlinkSync(names[0], path.join(lib, alias));
      }
    }
    console.log(`  • Postgres libraries deduplicated  package=${pkg} saved=${(saved / 1e6).toFixed(0)}MB`);
  }
};
