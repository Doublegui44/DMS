import { expect, test, type Page } from "@playwright/test";

/** Flow 8 — the app in French (D-081, D-082): switcher, screens, formats, business-rule messages. */
const PASSWORD = "demo1234"; // seed test credential (prisma/seed/index.ts)

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

test.describe("Flow 8 — French", () => {
  test("the switcher turns the whole app French, with French dates and amounts, and back", async ({ page }) => {
    await login(page, "admin@dms.test");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await page.getByTestId("language-switcher").selectOption("fr");
    await expect(page.getByRole("link", { name: "Tableau de bord" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Bienvenue/ })).toBeVisible();
    await expect(page).toHaveTitle(/Tableau de bord/);
    // "29 nov. 2026": French month abbreviations; "1 703 987 €": the euro after the amount.
    await expect(page.getByTestId("business-date")).toHaveText(/^\d{2} [a-zéû]+\.? \d{4}$/);
    await page.goto("/accounting/invoices");
    await expect(page.getByRole("heading", { name: "Factures" })).toBeVisible();
    await expect(page.locator("main").getByText(/\d\s€$/).first()).toBeVisible();

    // The language is kept across pages and on the next visit (cookie).
    await page.goto("/workshop/repair-orders");
    await expect(page.getByRole("heading", { name: "Ordres de réparation" })).toBeVisible();

    await page.getByTestId("language-switcher").selectOption("en");
    await expect(page.getByRole("heading", { name: "Repair orders" })).toBeVisible();
  });

  test("business-rule and field messages come back in French", async ({ page }) => {
    await login(page, "sales.manager.nantes@dms.test");
    await page.getByTestId("language-switcher").selectOption("fr");
    await expect(page.getByRole("link", { name: "Tableau de bord" })).toBeVisible();
    await page.goto("/customers/new");
    await page.getByTestId("form-submit").click();
    await expect(page.getByText("Le nom est obligatoire").first()).toBeVisible();
  });

  test("the login page offers the language too", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByTestId("language-switcher").selectOption("fr");
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
    await expect(page.getByText("Utilisateurs de démo")).toBeVisible();
  });
});
