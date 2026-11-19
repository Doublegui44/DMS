import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "demo1234"; // seed test credential (prisma/seed/index.ts)

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

test.describe("accounting", () => {
  test("an accountant issues an invoice, records the payment and the invoice is paid", async ({ page }) => {
    await login(page, "accountant@dms.test");
    await page.goto("/accounting/invoices/new");
    await page.locator("#siteId").selectOption({ label: "Nantes Atlantique" });
    await page.locator("#customerId").selectOption({ index: 1 });
    await page.getByLabel("Line 1 label").fill("Bodywork estimate");
    await page.getByLabel("Line 1 revenue").selectOption({ label: "Workshop labour" });
    await page.getByLabel("Line 1 quantity").fill("2");
    await page.getByLabel("Line 1 unit price").fill("50");
    await expect(page.getByTestId("invoice-total")).toHaveText("€120.00");
    await page.getByTestId("invoice-issue").click();

    await expect(page).toHaveURL(/\/accounting\/invoices\/[a-z0-9]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Invoice NTE-FA-\d{4}-\d{6}/);
    await expect(page.getByTestId("invoice-due")).toHaveText("€120.00");
    const invoiceUrl = page.url();

    await page.getByRole("link", { name: "Record payment" }).click();
    await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("120.00");
    await page.getByTestId("form-submit").click();
    await expect(page).toHaveURL(/\/accounting\/payments\/[a-z0-9]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Receipt NTE-RC-\d{4}-\d{6}/);

    await page.goto(invoiceUrl);
    await expect(page.locator("[data-status=PAID]").first()).toBeVisible();
    await expect(page.getByTestId("invoice-due")).toHaveText("€0.00");
  });

  test("a manual entry must balance before it can be posted, and can be reversed", async ({ page }) => {
    await login(page, "accountant@dms.test");
    await page.goto("/accounting/entries/new");
    await page.getByLabel("Label", { exact: true }).fill("Office supplies");
    await page.getByLabel("Line 1 account").fill("602200");
    await page.getByLabel("Line 1 department").selectOption("OVERHEAD");
    await page.getByLabel("Line 1 debit").fill("50");
    await page.getByLabel("Line 2 account").fill("530000");
    await page.getByLabel("Line 2 credit").fill("40");
    await expect(page.getByTestId("entry-balance")).toContainText("Difference");
    await expect(page.getByTestId("form-submit")).toBeDisabled();
    await page.getByLabel("Line 2 credit").fill("50");
    await expect(page.getByTestId("entry-balance")).toHaveText("Balanced");
    await page.getByTestId("form-submit").click();

    await expect(page).toHaveURL(/\/accounting\/entries\/[a-z0-9]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Entry OD-\d{4}-\d{6}/);
    await expect(page.getByTestId("entry-lines")).toContainText("602200");

    await page.getByLabel("Reason for reversal").fill("Wrong account");
    await page.getByRole("button", { name: "Reverse" }).click();
    await expect(page.getByText(/^Reversal of OD-/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("the accountant locks the last finished month; a salesperson cannot see the periods screen", async ({ page }) => {
    await login(page, "accountant@dms.test");
    await page.goto("/accounting/periods");
    const checklist = page.getByTestId("close-checklist");
    await expect(checklist).toContainText("All earlier periods are locked");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Lock period" }).click();
    await expect(page.getByText("Period locked")).toBeVisible({ timeout: 15_000 });
    await expect(checklist).toContainText("Period is already locked");

    await page.context().clearCookies();
    await login(page, "salesperson1.nantes@dms.test");
    await page.goto("/accounting/periods");
    await expect(page).toHaveURL(/\/forbidden$/);
  });
});
