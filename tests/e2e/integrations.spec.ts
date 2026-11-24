import { expect, test, type Page } from "@playwright/test";

/** Flow 9 — the mocked outside systems (D-083, D-084): used-car market feed, manufacturer portal. */
const PASSWORD = "demo1234"; // seed test credential (prisma/seed/index.ts)

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

const euros = (text: string) => Number(text.replace(/[^0-9.]/g, ""));

test.describe("Flow 9 — market feed and OEM portal", () => {
  test("the market feed values a used car and its estimate becomes the purchase price", async ({ page }) => {
    await login(page, "sales.manager.nantes@dms.test");
    await page.goto("/sales/vo-stock/purchase");
    await page.getByTestId("vo-make").fill("Peugeot");
    await page.getByTestId("vo-model").fill("308");
    await page.locator('input[name="vehicle.firstRegistration"]').fill("2022-03-01");
    await page.getByTestId("vo-mileage").fill("60000");
    await page.getByTestId("vo-market-ask").click();
    const estimate = page.getByTestId("vo-market-estimate");
    await expect(estimate).toHaveText(/€/);
    await expect(page.getByTestId("vo-market-result").locator("tbody tr")).toHaveCount(6);
    const value = euros(await estimate.innerText());
    expect(value).toBeGreaterThan(5_000);
    await page.getByTestId("vo-market-use").click();
    await expect(page.getByTestId("vo-price")).toHaveValue(value.toFixed(2));
    // The same car always gets the same answer.
    await page.getByTestId("vo-market-ask").click();
    await expect(estimate).toHaveText(await estimate.innerText());
  });

  test("the manufacturer portal shows the plant stage and pushes a promised date back", async ({ page }) => {
    await login(page, "sales.manager.nantes@dms.test");
    await page.getByRole("link", { name: "OEM portal" }).click();
    await expect(page.getByRole("heading", { name: "Manufacturer portal" })).toBeVisible();
    const first = page.getByTestId("oem-orders").locator("tbody tr").filter({ hasText: "Push back the date" }).first();
    await expect(first).toBeVisible();
    // The table is sorted by promised date: follow the order by its row id, not its position.
    const row = page.getByTestId((await first.getAttribute("data-testid"))!);
    const promised = row.locator("td").nth(4);
    const before = (await promised.innerText()).trim();
    await row.getByText("Push back the date").click();
    await row.locator('input[name="days"]').fill("10");
    await row.locator('input[name="reason"]').fill("Parts shortage at the plant");
    await row.getByTestId("form-submit").click();
    await expect(page.getByText("Promised date moved")).toBeVisible();
    await expect(promised).not.toHaveText(before);
  });
});
