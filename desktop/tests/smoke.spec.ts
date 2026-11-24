import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

/**
 * Desktop smoke test (Phase 12, D-087), run against the packaged app: first launch restores the
 * demo data, one-click sign-in, a dashboard, a PDF, a one-day simulation, quit and relaunch with
 * the data kept, then Reset demo. Each run uses a throwaway data folder (DMS_USER_DATA).
 */
const desktop = path.resolve(__dirname, "..");
function defaultExecutable() {
  if (process.platform === "darwin") {
    const dir = process.arch === "arm64" ? "mac-arm64" : "mac";
    return path.join(desktop, "release", dir, "DMS Simulator.app", "Contents", "MacOS", "DMS Simulator");
  }
  if (process.platform === "win32") return path.join(desktop, "release", "win-unpacked", "DMS Simulator.exe");
  throw new Error(`No desktop build for ${process.platform}`);
}
const executablePath = process.env.DMS_APP ?? defaultExecutable();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dms-desktop-test-"));

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ executablePath, env: { ...process.env, DMS_USER_DATA: userData } as Record<string, string> });
  const page = await app.firstWindow();
  // The splash screen first, then the app once Postgres and the server are up.
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/(login|dashboard)$/, { timeout: 120_000 });
  return { app, page };
}

async function signInAs(page: Page, email: string) {
  // On a slow machine the page can show before React has wired its buttons; a click then does
  // nothing, so click again until the dashboard opens.
  await expect(async () => {
    await page.locator(`button[data-email="${email}"]`).click({ timeout: 5_000 });
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
}

test.describe.configure({ mode: "serial" });

test.afterAll(() => fs.rmSync(userData, { recursive: true, force: true }));

test("installs nothing, starts, signs in, prints, simulates, keeps its data and resets", async () => {
  test.setTimeout(600_000);

  // First launch: demo data restored, one-click sign-in, a dashboard.
  let { app, page } = await launch();
  await expect(page).toHaveURL(/\/login$/);
  expect(fs.existsSync(path.join(userData, "pgdata", "PG_VERSION"))).toBe(true);
  await signInAs(page, "admin@dms.test");
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toBeVisible();
  const seededDate = (await page.getByTestId("business-date").innerText()).trim();

  // A PDF is served by the bundled server (the window hands it to the system viewer).
  await page.goto(page.url().replace(/\/dashboard$/, "/accounting/invoices"));
  const href = await page.locator('a[href^="/accounting/invoices/c"]').first().getAttribute("href");
  const pdf = await page.evaluate(async (id) => {
    const r = await fetch(`/api/pdf/invoice/${id}`);
    return { status: r.status, type: r.headers.get("content-type"), size: (await r.arrayBuffer()).byteLength };
  }, href!.split("/").pop());
  expect(pdf).toMatchObject({ status: 200, type: "application/pdf" });
  expect(pdf.size).toBeGreaterThan(1000);

  // One simulated day moves the business date.
  await page.goto(page.url().replace(/\/accounting\/invoices$/, "/admin/simulation"));
  await page.locator('select[name="days"]').selectOption("1");
  await page.getByTestId("form-submit").click();
  await expect(page.getByText("Simulation finished")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("business-date")).not.toHaveText(seededDate);
  const simulatedDate = (await page.getByTestId("business-date").innerText()).trim();

  // Quit and relaunch: the data and the session are kept.
  await app.close();
  ({ app, page } = await launch());
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("business-date")).toHaveText(simulatedDate);

  // Demo → Reset demo (confirmed): back to the shipped data.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()!.getMenuItemById("reset-demo")!.click(undefined, BrowserWindow.getAllWindows()[0]);
  });
  await expect(page).toHaveURL(/^file:/, { timeout: 10_000 });
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 120_000 });
  await expect(page.getByTestId("business-date")).toHaveText(seededDate);
  await app.close();
});

test("reseeds six months of history ending today", async () => {
  test.setTimeout(1_200_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dms-desktop-reseed-"));
  try {
    const app = await electron.launch({ executablePath, env: { ...process.env, DMS_USER_DATA: dir } as Record<string, string> });
    const page = await app.firstWindow();
    await expect(page).toHaveURL(/\/login$/, { timeout: 120_000 });
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });
    await app.evaluate(({ Menu, BrowserWindow }) => {
      Menu.getApplicationMenu()!.getMenuItemById("reseed-demo")!.click(undefined, BrowserWindow.getAllWindows()[0]);
    });
    await expect(page).toHaveURL(/^file:/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login$/, { timeout: 1_100_000 });
    await signInAs(page, "admin@dms.test");
    const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    await expect(page.getByTestId("business-date")).toHaveText(today);
    expect(fs.readFileSync(path.join(dir, "logs", "main.log"), "utf8")).toMatch(/Demo reseeded in \d+ s/);
    await app.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
