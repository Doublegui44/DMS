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

/** "€1,234.56" → 123456 cents ("" and "—" are zero). */
function cents(text: string): number {
  const t = text.trim();
  if (!t || t === "—") return 0;
  return Math.round(Number(t.replace(/[^0-9.-]/g, "")) * 100);
}

const qty = (text: string) => Number(text.trim().replace(/,/g, ""));

/** Debit-minus-credit balances from the trial balance (all sites). */
async function balances(page: Page, accounts: string[]) {
  await page.goto("/accounting/trial-balance");
  const table = page.getByTestId("trial-balance");
  await expect(table).toBeVisible();
  const out: Record<string, number> = {};
  for (const account of accounts) {
    const row = table.locator("tbody tr").filter({ has: page.getByRole("link", { name: account, exact: true }) });
    if ((await row.count()) === 0) {
      out[account] = 0;
      continue;
    }
    const cells = row.locator("td");
    out[account] = cents(await cells.nth(4).innerText()) - cents(await cells.nth(5).innerText());
  }
  return out;
}

async function stockFigures(page: Page) {
  return {
    onHand: qty(await page.getByTestId("stock-on-hand").innerText()),
    pmp: cents(await page.getByTestId("stock-pmp").innerText()),
    value: cents(await page.getByTestId("stock-value").innerText()),
  };
}

test.describe("parts", () => {
  test("Flow 5 — below min → suggested order → receipt → PMP → supplier invoice matched → entries", async ({ page }) => {
    test.setTimeout(180_000);
    page.on("dialog", (dialog) => dialog.accept());

    await login(page, "parts.manager.nantes@dms.test");
    const before = await balances(page, ["373000", "408100"]);

    // A filter held at Nantes; its minimum is raised above what is on the shelf.
    await page.goto("/parts/stock?family=FILTERS&sort=qtyOnHand&dir=desc");
    const first = page.getByTestId("table-row").first();
    const partNumber = (await first.locator("td").first().innerText()).trim();
    await first.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/parts\/stock\/[a-z0-9]+$/);
    const itemUrl = page.url();
    const start = await stockFigures(page);
    expect(start.onHand).toBeGreaterThan(0);
    await page.getByTestId("levels-min").fill(String(start.onHand + 5));
    await page.getByTestId("levels-max").fill(String(start.onHand + 10));
    await page.getByTestId("form-submit").click();
    await expect(page.getByText("Below min")).toBeVisible();

    // The suggestion orders up to max (net of anything already on order), from the part's supplier.
    await page.goto("/parts/purchasing/suggestions");
    const suggestion = page.locator(`tr[data-part="${partNumber}"]`);
    await expect(suggestion).toBeVisible();
    const toOrder = qty(await suggestion.locator("td").nth(6).innerText());
    const unitCost = cents(await suggestion.locator("td").nth(7).innerText());
    expect(toOrder).toBeGreaterThan(0);
    const group = page.locator("section").filter({ has: suggestion });
    await group.getByRole("button", { name: "Draft order" }).click();
    await expect(page).toHaveURL(/\/parts\/purchasing\/[a-z0-9]+$/, { timeout: 15_000 });
    const supplierName = (await page.getByTestId("po-supplier").innerText()).trim();
    await expect(page.locator(`[data-testid="po-lines"] tr[data-part="${partNumber}"]`)).toBeVisible();

    // Send, then receive everything the supplier delivered.
    await page.getByRole("button", { name: "Send order" }).click();
    await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId(`receive-${partNumber}`)).toHaveValue(String(toOrder));
    await page.getByTestId("receipt-note").fill("BL-E2E");
    await page.getByTestId("form-submit").click();
    const receiptRow = page.getByTestId("po-receipts").locator("tbody tr").first();
    await expect(receiptRow).toBeVisible({ timeout: 15_000 });
    const receiptNumber = (await receiptRow.locator("td").first().innerText()).trim();
    const receiptValue = cents(await receiptRow.locator("td").nth(4).innerText());
    await expect(page.getByText("Received", { exact: true }).first()).toBeVisible();

    // Stock and weighted average cost updated by the receipt.
    await page.goto(itemUrl);
    const after = await stockFigures(page);
    expect(after.onHand).toBe(start.onHand + toOrder);
    expect(after.value).toBe(start.value + toOrder * unitCost);
    expect(Math.abs(after.pmp - Math.round(after.value / after.onHand))).toBeLessThanOrEqual(1);

    // The supplier's invoice, at the order price, billing exactly this receipt.
    await page.goto("/parts/purchasing/invoices/new");
    await page.getByTestId("si-supplier").selectOption({ label: supplierName });
    await page.getByTestId("si-load").click();
    await expect(page.getByText(receiptNumber).first()).toBeVisible();
    for (const box of await page.locator('input[name="bill"]').all()) await box.uncheck();
    for (const row of await page.locator("tbody tr").filter({ hasText: receiptNumber }).all()) await row.locator('input[name="bill"]').check();
    await page.getByTestId("si-reference").fill(`E2E-${Date.now()}`);
    await page.getByTestId("form-submit").click();
    await expect(page).toHaveURL(/\/parts\/purchasing\/invoices\/[a-z0-9]+$/, { timeout: 15_000 });
    await expect(page.getByText("Matched", { exact: true }).first()).toBeVisible();
    expect(cents(await page.getByTestId("si-variance").innerText())).toBe(0);
    const total = cents(await page.getByTestId("si-total").innerText());
    expect(total).toBeGreaterThan(receiptValue);

    const invoiceUrl = page.url();

    // Paid by transfer.
    await page.getByTestId("si-pay-method").selectOption("TRANSFER");
    await page.getByTestId("form-submit").click();
    await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    // The books follow the stock: 37x up by the receipt, and nothing left awaiting an invoice.
    const end = await balances(page, ["373000", "408100"]);
    expect(end["373000"] - before["373000"]).toBe(receiptValue);
    expect(end["408100"]).toBe(before["408100"]);

    // The accountant sees the invoice's entry: goods received not invoiced cleared against the supplier, with deductible VAT.
    await login(page, "accountant@dms.test");
    await page.goto(invoiceUrl);
    await page.getByTestId("si-entry").click();
    const lines = page.getByTestId("entry-lines");
    await expect(lines).toBeVisible();
    await expect(lines.getByText("408100").first()).toBeVisible();
    await expect(lines.getByText("445660").first()).toBeVisible();
    await expect(lines.getByText(/^401\d{3}$/).first()).toBeVisible();
  });

  test("a counter sale is invoiced at the customer's price, out of stock at PMP", async ({ page }) => {
    test.setTimeout(120_000);
    page.on("dialog", (dialog) => dialog.accept());
    await login(page, "parts.advisor.nantes@dms.test");

    // A part with stock at Nantes.
    await page.goto("/parts/stock?family=FILTERS&sort=qtyOnHand&dir=desc");
    const first = page.getByTestId("table-row").first();
    const partNumber = (await first.locator("td").first().innerText()).trim();
    await first.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/parts\/stock\/[a-z0-9]+$/);
    const itemUrl = page.url();
    const start = await stockFigures(page);

    await page.goto("/parts/counter/new");
    const customer = page.getByTestId("counter-customer");
    const option = await customer.locator("option").nth(1).getAttribute("value");
    await customer.selectOption(option!);
    await page.getByTestId("form-submit").click();
    await expect(page).toHaveURL(/\/parts\/counter\/[a-z0-9]+$/, { timeout: 15_000 });
    await page.getByTestId("counter-line-part").fill(partNumber);
    await page.getByTestId("counter-line-qty").fill("1");
    await page.getByRole("button", { name: "Add line" }).click();
    await expect(page.locator(`[data-testid="counter-lines"] tr[data-part="${partNumber}"]`)).toBeVisible();

    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(page.getByText("Invoiced", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("counter-invoice")).toBeVisible();

    await page.goto(itemUrl);
    const after = await stockFigures(page);
    expect(after.onHand).toBe(start.onHand - 1);
    expect(Math.abs(start.value - after.value - start.pmp)).toBeLessThanOrEqual(1);
  });
});
