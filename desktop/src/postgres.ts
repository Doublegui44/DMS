import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import pg from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { splitDump } from "./lib/dump";

export const DB_USER = "dms";
export const DB_NAME = "dms";

/**
 * The app's own Postgres 17 (D-087). Binaries come from the embedded-postgres platform package;
 * the app drives them with initdb and pg_ctl itself: pg_ctl drops administrator rights on Windows
 * (Postgres refuses to run as an administrator) and stops the server cleanly on every platform.
 */
export interface Postgres {
  dataDir: string;
  port: number;
  password: string;
  logFile: string;
}

interface Binaries {
  initdb: string;
  pg_ctl: string;
}

async function binaries(): Promise<Binaries> {
  const key = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  const mod = (await import(`@embedded-postgres/${key}`)) as Binaries;
  const exe = (p: string) => (process.platform === "win32" && !p.endsWith(".exe") ? `${p}.exe` : p);
  return { initdb: exe(mod.initdb), pg_ctl: exe(mod.pg_ctl) };
}

/** A free TCP port on 127.0.0.1, chosen by the OS. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function run(cmd: string, args: string[], log: (m: string) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    child.stdout.on("data", (d) => log(`[${path.basename(cmd)}] ${String(d).trim()}`));
    child.stderr.on("data", (d) => log(`[${path.basename(cmd)}] ${String(d).trim()}`));
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/** Initialises the cluster on first launch, then starts Postgres on 127.0.0.1:<port>. */
export async function startPostgres(o: { dataDir: string; port: number; password: string; logDir: string; log: (m: string) => void }): Promise<Postgres> {
  const bin = await binaries();
  const logFile = path.join(o.logDir, "postgres.log");
  if (!fs.existsSync(path.join(o.dataDir, "PG_VERSION"))) {
    o.log("Initialising the database cluster");
    fs.rmSync(o.dataDir, { recursive: true, force: true });
    const pwfile = path.join(os.tmpdir(), `dms-pw-${crypto.randomBytes(6).toString("hex")}`);
    fs.writeFileSync(pwfile, o.password, { mode: 0o600 });
    try {
      const code = await run(bin.initdb, ["-D", o.dataDir, "-U", DB_USER, "--pwfile", pwfile, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"], o.log);
      if (code !== 0) throw new Error(`initdb failed (code ${code})`);
    } finally {
      fs.rmSync(pwfile, { force: true });
    }
  } else {
    // A Postgres left running by a crashed app is stopped; a lock file without a server is removed.
    const status = await run(bin.pg_ctl, ["status", "-D", o.dataDir], o.log);
    if (status === 0) {
      o.log("Stopping a database server left running");
      await run(bin.pg_ctl, ["stop", "-D", o.dataDir, "-m", "fast", "-w"], o.log);
    } else if (fs.existsSync(path.join(o.dataDir, "postmaster.pid"))) {
      o.log("Removing a stale postmaster.pid");
      fs.rmSync(path.join(o.dataDir, "postmaster.pid"));
    }
  }
  // TCP on 127.0.0.1 only, no Unix socket: nothing else on the computer needs to reach it.
  const options = `-p ${o.port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=`;
  const code = await run(bin.pg_ctl, ["start", "-D", o.dataDir, "-w", "-t", "60", "-l", logFile, "-o", options], o.log);
  if (code !== 0) throw new Error(`The database did not start (code ${code}); see postgres.log.`);
  return { dataDir: o.dataDir, port: o.port, password: o.password, logFile };
}

export async function stopPostgres(p: Postgres, log: (m: string) => void) {
  const bin = await binaries();
  await run(bin.pg_ctl, ["stop", "-D", p.dataDir, "-m", "fast", "-w", "-t", "30"], log);
}

function client(p: Postgres, database: string) {
  return new pg.Client({ host: "127.0.0.1", port: p.port, user: DB_USER, password: p.password, database });
}

/** Drops and recreates the demo database, then replays the shipped dump into it. */
export async function restoreDump(p: Postgres, dumpFile: string, onProgress: (done: number, total: number) => void) {
  const admin = client(p, "postgres");
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
  } finally {
    await admin.end();
  }
  const parts = splitDump(zlib.gunzipSync(fs.readFileSync(dumpFile)).toString("utf8"));
  const c = client(p, DB_NAME);
  await c.connect();
  try {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.kind === "sql") await c.query(part.text);
      else await copyRows(c, part.statement, part.rows);
      onProgress(i + 1, parts.length);
    }
  } finally {
    await c.end();
  }
}

function copyRows(c: pg.Client, statement: string, rows: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = c.query(copyFrom(statement));
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    stream.end(rows);
  });
}

/** Migration names recorded in the database, oldest first (null when the database is missing). */
export async function appliedMigrations(p: Postgres): Promise<string[] | null> {
  const c = client(p, DB_NAME);
  try {
    await c.connect();
    const r = await c.query<{ migration_name: string }>(
      `SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    );
    return r.rows.map((x) => x.migration_name);
  } catch {
    return null;
  } finally {
    await c.end().catch(() => {});
  }
}
