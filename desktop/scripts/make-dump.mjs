// Seeds a throwaway embedded Postgres with the demo data and writes desktop/build/demo:
// demo.sql.gz (plain pg_dump, replayed by the app on first launch and on Reset) and
// manifest.json (migrations, business date of the data, app version). D-087.
// Needs pg_dump 17 on PATH, or its path in PG_DUMP. The seed takes a few minutes.
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "..");
const out = path.join(desktop, "build", "demo");
const pgDump = process.env.PG_DUMP ?? "pg_dump";

const version = execFileSync(pgDump, ["--version"]).toString();
const major = Number(/(\d+)\.\d+/.exec(version)?.[1]);
if (major < 17) throw new Error(`pg_dump 17 or later is needed, found: ${version.trim()}`);

const port = await new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dms-dump-"));
const password = "dump-only";
const pg = new EmbeddedPostgres({
  databaseDir: path.join(dir, "data"),
  port,
  user: "dms",
  password,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories="],
  onLog: () => {},
});
await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("dms_desktop");
  const url = `postgresql://dms:${password}@127.0.0.1:${port}/dms_desktop`;
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx tsx scripts/db-reset.ts", { cwd: root, stdio: "inherit", env });

  const client = pg.getPgClient("dms_desktop", "127.0.0.1");
  await client.connect();
  const clock = await client.query(`SELECT to_char("currentDate", 'YYYY-MM-DD') AS day FROM business_clock WHERE id = 1`);
  const migrations = (await client.query(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`)).rows.map((r) => r.migration_name);
  await client.end();

  const sql = execFileSync(pgDump, ["--no-owner", "--no-privileges", "--format=plain", "--dbname", url], { maxBuffer: 1024 * 1024 * 1024, env: { ...process.env, PGPASSWORD: password } });
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "demo.sql.gz"), zlib.gzipSync(sql, { level: 9 }));
  const appVersion = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8")).version;
  const builtOn = clock.rows[0].day;
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ version: appVersion, builtOn, migrations }, null, 2) + "\n");
  console.log(`Demo dump ready: ${(sql.length / 1e6).toFixed(1)} MB of SQL, business date ${builtOn}, ${migrations.length} migrations`);
} finally {
  await pg.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
