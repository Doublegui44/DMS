/**
 * DMS Simulator desktop app (Phase 12, D-087). Starts the app's own Postgres, restores the demo
 * data on first launch, runs the Next.js standalone server as a child process on 127.0.0.1 and
 * shows it in a window. Nothing listens beyond this computer.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, dialog, Menu, shell, utilityProcess, type MenuItemConstructorOptions, type UtilityProcess } from "electron";
import { databaseUrl, launchPlan } from "./lib/dump";
import { appliedMigrations, DB_NAME, DB_USER, freePort, restoreDump, startPostgres, stopPostgres, type Postgres } from "./postgres";

// ── Paths ────────────────────────────────────────────────────────────────────
/** Packaged: next to app.asar in Resources. In development (`npm start` in desktop/): desktop/build. */
const resources = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "build");
const serverDir = path.join(resources, "server");
const demoDir = path.join(resources, "demo");
// Tests run each launch against a throwaway data folder.
if (process.env.DMS_USER_DATA) app.setPath("userData", process.env.DMS_USER_DATA);
const userDir = app.getPath("userData");
const dataDir = path.join(userDir, "pgdata");
const logDir = path.join(userDir, "logs");
const stateFile = path.join(userDir, "state.json");

interface State {
  password: string;
  authSecret: string;
  restored: boolean;
  migrations: string[] | null;
  dataBuiltOn: string | null;
}
interface Manifest {
  version: string;
  builtOn: string;
  migrations: string[];
}

fs.mkdirSync(logDir, { recursive: true });
const logStream = fs.createWriteStream(path.join(logDir, "main.log"), { flags: "a" });
function log(message: string) {
  const line = `${new Date().toISOString()} ${message}`;
  logStream.write(line + "\n");
  if (!app.isPackaged) console.log(line);
}

function loadState(): State {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8")) as State;
  } catch {
    const secret = () => crypto.randomBytes(32).toString("base64url");
    return { password: secret(), authSecret: secret(), restored: false, migrations: null, dataBuiltOn: null };
  }
}
function saveState(s: State) {
  fs.writeFileSync(stateFile, JSON.stringify(s, null, 2), { mode: 0o600 });
}
const manifest = JSON.parse(fs.readFileSync(path.join(demoDir, "manifest.json"), "utf8")) as Manifest;

// ── Runtime ──────────────────────────────────────────────────────────────────
let state = loadState();
let postgres: Postgres | null = null;
let pgPort = 0;
let server: UtilityProcess | null = null;
let appPort = 0;
let win: BrowserWindow | null = null;
/** Startup, Reset and Reseed stop or start the server: the Demo menu waits until they are done. */
let busy = true;
let quitting = false;
let failed = false;

const appUrl = (p = "/") => `http://127.0.0.1:${appPort}${p}`;
const splashFile = path.join(app.getAppPath(), "dist", "splash.html");

/**
 * Shows a page in the window. A load that a newer one replaces before it finishes rejects with
 * ERR_ABORTED (-3), and at times so does the newer load although its page shows: the newer page
 * wins, so that is not an error. It happens when Reset comes while a slow computer is still
 * loading the page.
 */
async function show(target: string) {
  try {
    if (target === splashFile) await win?.loadFile(target);
    else await win?.loadURL(target);
  } catch (e) {
    if ((e as { errno?: number }).errno !== -3) throw e;
    log(`ERR_ABORTED loading ${target}: one page replaced another`);
  }
}

function splash(status: string) {
  if (!win) return;
  win.webContents.executeJavaScript(`window.setStatus && window.setStatus(${JSON.stringify(status)})`).catch(() => {});
}

async function restore(reason: string) {
  splash(reason);
  state.restored = false;
  saveState(state);
  let last = -1;
  await restoreDump(postgres!, path.join(demoDir, "demo.sql.gz"), (done, total) => {
    const pct = Math.floor((100 * done) / total);
    if (pct !== last && pct % 5 === 0) splash(`${reason} ${pct} %`);
    last = pct;
  });
  state = { ...state, restored: true, migrations: manifest.migrations, dataBuiltOn: manifest.builtOn };
  saveState(state);
  log(`Demo data restored (built ${manifest.builtOn})`);
}

async function startDatabase() {
  pgPort = await freePort();
  splash("Starting the database…");
  postgres = await startPostgres({ dataDir, port: pgPort, password: state.password, logDir, log });
  const plan = launchPlan({ restored: state.restored, migrations: state.restored ? await appliedMigrations(postgres) : null }, manifest.migrations);
  log(`Database on 127.0.0.1:${pgPort}, plan ${plan}`);
  if (plan === "upgrade") {
    await dialog.showMessageBox({
      type: "info",
      message: "This version changes the database",
      detail: "Your demo data will be replaced by the demo data of this version.",
    });
  }
  if (plan !== "ready") await restore("Loading the demo data…");
}

function waitForHttp(url: string, timeoutMs: number, alive: () => boolean): Promise<void> {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (!alive()) reject(new Error("The application server stopped while starting; see server.log."));
        else if (Date.now() > until) reject(new Error(`No answer from ${url}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function startServer() {
  appPort = await freePort();
  splash("Starting the application…");
  const out = fs.createWriteStream(path.join(logDir, "server.log"), { flags: "a" });
  const child = (server = utilityProcess.fork(path.join(serverDir, "server.js"), [], {
    cwd: serverDir,
    stdio: "pipe",
    serviceName: "DMS server",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(appPort),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: databaseUrl({ port: pgPort, user: DB_USER, password: state.password, database: DB_NAME }),
      AUTH_SECRET: state.authSecret,
      AUTH_TRUST_HOST: "true",
      AUTH_URL: appUrl(),
      DEMO_MODE: "true",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  }));
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  child.on("exit", (code) => {
    log(`Server exited with code ${code}`);
    if (server === child) server = null;
    if (!quitting && !busy) void fail(new Error(`The application server stopped (code ${code}).`));
  });
  await waitForHttp(appUrl("/login"), 60_000, () => server === child);
  log(`Server on ${appUrl()}`);
}

async function stopServer() {
  const s = server;
  if (!s) return;
  server = null;
  await new Promise<void>((resolve) => {
    s.once("exit", () => resolve());
    s.kill();
  });
}

async function stopAll() {
  await stopServer();
  if (postgres) {
    const p = postgres;
    postgres = null;
    await stopPostgres(p, log).catch((e) => log(`Postgres stop failed: ${e}`));
  }
}

async function fail(error: unknown) {
  log(`Error: ${error instanceof Error ? error.stack : String(error)}`);
  // One dialog, and none on the way out (a reset cut short by Quit fails as Postgres stops).
  if (failed || quitting) return;
  failed = true;
  busy = true; // the app is closing: the Demo menu does nothing more
  const r = await dialog.showMessageBox({
    type: "error",
    message: "DMS Simulator could not start",
    detail: error instanceof Error ? error.message : String(error),
    buttons: ["Open logs", "Quit"],
    defaultId: 1,
  });
  if (r.response === 0) await shell.openPath(logDir);
  quitting = true;
  await stopAll();
  app.quit();
}

// ── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "DMS Simulator",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => win?.show());
  void win.loadFile(splashFile);
  const contents = win.webContents;

  // Other sites open in the system browser; PDFs open in the system viewer.
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(appUrl()) && new URL(url).pathname.startsWith("/api/pdf/")) void openPdf(url);
    else if (url.startsWith(appUrl())) void contents.loadURL(url);
    else void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:") || url.startsWith(appUrl())) {
      if (url.startsWith(appUrl()) && new URL(url).pathname.startsWith("/api/pdf/")) {
        event.preventDefault();
        void openPdf(url);
      }
      return;
    }
    event.preventDefault();
    void shell.openExternal(url);
  });
  win.on("closed", () => (win = null));
}

async function openPdf(url: string) {
  try {
    const res = await win!.webContents.session.fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const name = /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `${path.basename(new URL(url).pathname)}.pdf`;
    const file = path.join(os.tmpdir(), "dms-simulator", name.replace(/[^\w.-]/g, "_"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    await shell.openPath(file);
  } catch (e) {
    log(`PDF failed: ${e}`);
    dialog.showErrorBox("PDF", `The document could not be opened: ${e instanceof Error ? e.message : e}`);
  }
}

/** Runs startup, Reset or Reseed with the Demo menu on hold, then shows the app. An error ends the app. */
async function whileBusy(step: () => Promise<void>) {
  busy = true;
  try {
    await step();
  } catch (e) {
    return fail(e);
  }
  busy = false;
  await show(appUrl("/")).catch(fail);
}

// ── Menu ─────────────────────────────────────────────────────────────────────
async function resetDemo() {
  if (busy) return;
  const r = await dialog.showMessageBox(win!, {
    type: "warning",
    message: "Reset the demo?",
    detail: `Everything done in the app since its installation (or the last reset) is replaced by the demo data, dated ${manifest.builtOn}.`,
    buttons: ["Reset", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });
  if (r.response !== 0 || busy) return;
  await whileBusy(async () => {
    await show(splashFile);
    await stopServer();
    await restore("Resetting the demo data…");
    await startServer();
  });
}

async function reseedDemo() {
  if (busy) return;
  const r = await dialog.showMessageBox(win!, {
    type: "warning",
    message: "Reseed the demo at today's date?",
    detail: "Six months of history are generated again, ending today. It takes a few minutes, and everything done in the app until now is replaced.",
    buttons: ["Reseed", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });
  if (r.response !== 0 || busy) return;
  await whileBusy(async () => {
    const started = Date.now();
    const tick = setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      splash(`Generating six months of history… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} (usually 3–5 minutes)`);
    }, 1000);
    try {
      await show(splashFile);
      await stopServer();
      // Start from the shipped schema and data, then empty and reseed (the seed sets the date).
      await restore("Preparing the database…");
      state.restored = false;
      saveState(state);
      await runReseed();
      state = { ...state, restored: true, dataBuiltOn: new Date().toISOString().slice(0, 10) };
      saveState(state);
      log(`Demo reseeded in ${Math.round((Date.now() - started) / 1000)} s`);
    } finally {
      clearInterval(tick);
    }
    await startServer();
  });
}

function runReseed(): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(path.join(logDir, "reseed.log"), { flags: "a" });
    const child = utilityProcess.fork(path.join(serverDir, "reseed.cjs"), [], {
      cwd: serverDir,
      stdio: "pipe",
      serviceName: "DMS reseed",
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: databaseUrl({ port: pgPort, user: DB_USER, password: state.password, database: DB_NAME }) },
    });
    child.stdout?.pipe(out);
    child.stderr?.pipe(out);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`The reseed stopped (code ${code}); see reseed.log.`))));
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "Demo",
      submenu: [
        {
          id: "sign-in",
          label: "Sign-in page",
          accelerator: "CmdOrCtrl+Shift+L",
          click: () => {
            if (!busy) void show(appUrl("/login")).catch(fail);
          },
        },
        { type: "separator" },
        { id: "reset-demo", label: "Reset demo…", click: () => void resetDemo() },
        { id: "reseed-demo", label: "Reseed at today\u2019s date…", click: () => void reseedDemo() },
        { type: "separator" },
        { label: "Open data folder", click: () => void shell.openPath(userDir) },
        { label: "Open logs", click: () => void shell.openPath(logDir) },
        ...(isMac ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }]),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "About DMS Simulator",
          click: () =>
            dialog.showMessageBox(win!, {
              message: `DMS Simulator ${app.getVersion()}`,
              detail: `Demo data built on ${manifest.builtOn}.\nData folder: ${userDir}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    log(`Starting DMS Simulator ${app.getVersion()} (${process.platform} ${process.arch})`);
    saveState(state);
    buildMenu();
    createWindow();
    return whileBusy(async () => {
      await startDatabase();
      await startServer();
    });
  });

  app.on("window-all-closed", () => app.quit());

  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    stopAll().finally(() => app.quit());
  });
}
