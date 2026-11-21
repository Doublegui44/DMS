import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "demo1234"; // seed test credential (prisma/seed/index.ts)

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

const cents = async (page: Page, selector: string) => Number(await page.locator(selector).first().getAttribute("data-cents"));

test.describe("Flow 6 — month-end close", () => {
  test("the accountant reviews the close pack, locks the month and can no longer post into it", async ({ page }) => {
    await login(page, "accountant@dms.test");
    await page.goto("/accounting/periods");
    const checklist = page.getByTestId("close-checklist");
    await expect(checklist).toContainText("All earlier periods are locked");
    const pnlHref = (await page.getByTestId("close-pack-pnl").getAttribute("href"))!;
    const lastDay = new URL(pnlHref, "http://x").searchParams.get("to")!;

    // Trial balance and P&L of the month agree on the result.
    await page.getByTestId("close-pack-trialBalance").click();
    await expect(page.getByTestId("trial-balance")).toBeVisible();
    const tbResult = await cents(page, '[data-testid="tb-result"]');
    await page.goto(pnlHref);
    await expect(page.getByTestId("pnl-table")).toBeVisible();
    expect(await cents(page, '[data-testid="pnl-result"] [data-dep="TOTAL"]')).toBe(tbResult);

    // VAT return: every euro of collected VAT is explained by the month's invoices.
    await page.goto("/accounting/periods");
    await page.getByTestId("close-pack-vat").click();
    await expect(page.getByTestId("vat-unexplained")).toHaveText("€0.00");
    await expect(page.getByText("Open", { exact: true }).first()).toBeVisible();

    // Lock.
    await page.goto("/accounting/periods");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Lock period" }).click();
    await expect(page.getByText("Period locked")).toBeVisible({ timeout: 15_000 });
    await expect(checklist).toContainText("Period is already locked");

    // Nothing can be posted into it any more.
    await page.goto("/accounting/entries/new");
    await page.locator("#entryDate").fill(lastDay);
    await page.getByLabel("Label", { exact: true }).fill("Late accrual");
    await page.getByLabel("Line 1 account").fill("602200");
    await page.getByLabel("Line 1 department").selectOption("OVERHEAD");
    await page.getByLabel("Line 1 debit").fill("10");
    await page.getByLabel("Line 2 account").fill("530000");
    await page.getByLabel("Line 2 credit").fill("10");
    await page.getByTestId("form-submit").click();
    await expect(page.getByText(/is locked/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/accounting\/entries\/new$/);

    // The VAT return of the month now shows it as locked.
    await page.goto(`/accounting/reports/vat?period=${lastDay.slice(0, 7)}`);
    await expect(page.getByText("Locked", { exact: true }).first()).toBeVisible();

    // A salesperson cannot reach the periods screen.
    await login(page, "salesperson1.nantes@dms.test");
    await page.goto("/accounting/periods");
    await expect(page).toHaveURL(/\/forbidden$/);
  });

  test("each role's dashboard shows the report figures it is allowed to see", async ({ page }) => {
    // Accountant: receivables on the dashboard tie to the ageing report.
    await login(page, "accountant@dms.test");
    await expect(page.getByTestId("widget-receivables")).toBeVisible();
    await expect(page.getByTestId("widget-vat")).toBeVisible();
    await expect(page.getByTestId("widget-units")).toHaveCount(0);
    const balance = await cents(page, '[data-testid="receivables-balance"]');
    await page.goto("/accounting/reports/ageing?type=receivables");
    expect(await cents(page, '[data-testid="ageing-balanceCents"]')).toBe(balance);

    // Dealer principal: year-to-date VN margin equals the P&L (default range = year to date).
    await login(page, "dealer.principal@dms.test");
    await expect(page.getByTestId("chart-units")).toBeVisible();
    await expect(page.getByTestId("chart-margin")).toBeVisible();
    const vnYtd = await cents(page, '[data-testid="widget-margin"] tr[data-dep="VN"] td[data-period="year"]');
    await page.goto("/accounting/reports/pnl");
    expect(await cents(page, '[data-testid="pnl-gross-margin"] [data-dep="VN"]')).toBe(vnYtd);

    // Technician: only their own productivity.
    await login(page, "technician1.angers@dms.test");
    await expect(page.getByRole("heading", { name: "My productivity" })).toBeVisible();
    await expect(page.getByTestId("widget-productivity").locator("tbody tr")).toHaveCount(1);
    await expect(page.getByTestId("widget-margin")).toHaveCount(0);
    await expect(page.getByTestId("widget-receivables")).toHaveCount(0);
  });

  test("invoices, order forms and repair orders print as PDF", async ({ page }) => {
    await login(page, "dealer.principal@dms.test");
    for (const [list, kind] of [
      ["/accounting/invoices", "invoice"],
      ["/sales/orders", "order"],
      ["/workshop/repair-orders", "repair-order"],
    ] as const) {
      await page.goto(list);
      await page.locator("table tbody tr a").first().click();
      const href = await page.getByTestId(`pdf-${kind}`).getAttribute("href");
      expect(href).toMatch(new RegExp(`^/api/pdf/${kind}/`));
      const res = await page.request.get(href!);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("application/pdf");
      expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
    }
    // A technician may not print an invoice.
    await login(page, "technician1.angers@dms.test");
    const res = await page.request.get("/api/pdf/invoice/unknown", { maxRedirects: 0 });
    expect([302, 303, 307, 403, 404]).toContain(res.status());
  });
});
