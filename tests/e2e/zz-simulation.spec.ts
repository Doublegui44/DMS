import { expect, test, type Page } from "@playwright/test";

/**
 * Flow 7 — simulation. Named to run last (Playwright runs files in alphabetical order with one
 * worker): it moves the business clock of dms_e2e, which the other flows read as "today".
 */
const PASSWORD = "demo1234"; // seed test credential (prisma/seed/index.ts)

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

const nextDay = (text: string) => {
  const d = new Date(`${text} UTC`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};

test.describe("Flow 7 — simulation", () => {
  test("the admin runs one simulated day: the clock moves and the books still hold", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, "admin@dms.test");
    await page.goto("/admin/simulation");
    const date = page.getByTestId("sim-business-date");
    const before = (await date.textContent())!.trim();
    await page.locator('select[name="days"]').selectOption("1");
    await page.getByTestId("form-submit").click();
    await expect(page.getByText("Simulation finished")).toBeVisible({ timeout: 120_000 });
    await expect(date).toHaveText(nextDay(before));
    const latest = page.getByTestId("sim-runs").locator("tbody tr").first();
    await expect(latest).toContainText("Balanced");
    await expect(latest).toContainText("Stock reconciled");
    await expect(latest).toContainText("OK");
    await expect(page.getByTestId("sim-counts")).toContainText(/check-in/i);
  });

  test("a salesperson cannot open the simulation", async ({ page }) => {
    await login(page, "salesperson1.nantes@dms.test");
    await page.goto("/admin/simulation");
    await expect(page).toHaveURL(/\/forbidden$/);
  });
});
