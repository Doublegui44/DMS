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

/** Debit-minus-credit balance of the VN and VO stock accounts, all sites, from the trial balance. */
async function stockAccounts(page: Page) {
  await page.goto("/accounting/trial-balance");
  const table = page.getByTestId("trial-balance");
  await expect(table).toBeVisible();
  const balance = async (account: string) => {
    const row = table.locator("tbody tr").filter({ has: page.getByRole("link", { name: account, exact: true }) });
    if ((await row.count()) === 0) return 0;
    const cells = row.locator("td");
    return cents(await cells.nth(4).innerText()) - cents(await cells.nth(5).innerText());
  };
  return { vn: await balance("371000"), vo: await balance("372000") };
}

// Random identifiers so a rerun never collides with seeded vehicles or an earlier run.
const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];
const LETTERS = "ABCDEFGHJKLMNPQRTVXYZ"; // plate letters, without I/O/U and the forbidden SS/WW pairs
const randomPlate = () => `${pick(LETTERS)}${pick(LETTERS)}-${100 + Math.floor(Math.random() * 900)}-${pick(LETTERS)}${pick(LETTERS)}`;
const randomVin = () => `VF1E2E${Array.from({ length: 11 }, () => pick("0123456789")).join("")}`;

test.describe("sales", () => {
  test("Flow 1 — a VN sale with a trade-in, from lead to delivery, with its accounting", async ({ page }) => {
    test.setTimeout(180_000);
    page.on("dialog", (dialog) => dialog.accept());

    await login(page, "accountant@dms.test");
    const before = await stockAccounts(page);

    await login(page, "sales.manager.nantes@dms.test");
    // A new car in stock at Nantes, and its stock value (it leaves the books when invoiced).
    await page.goto("/sales/vn-stock?status=IN_STOCK");
    const stockRow = page.getByTestId("table-row").first();
    const stockVin = (await stockRow.locator("td").nth(1).innerText()).trim();
    const stockValue = cents(await stockRow.locator("td").nth(8).innerText());
    expect(stockValue).toBeGreaterThan(0);

    // A private customer walks in: lead, then quote.
    await page.goto("/customers?kind=INDIVIDUAL");
    const customerHref = await page.getByTestId("table-row").first().getByRole("link").first().getAttribute("href");
    const customerId = customerHref!.split("/").pop()!;
    await page.goto(`/sales/leads/new?customer=${customerId}&interest=VN`);
    await page.getByTestId("form-submit").click();
    await expect(page).toHaveURL(/\/sales\/leads\/[a-z0-9]+$/, { timeout: 15_000 });
    await page.getByRole("link", { name: "New quote" }).click();
    await expect(page).toHaveURL(/\/sales\/quotes\/new\?lead=/);

    const vehicleSelect = page.getByTestId("quote-vehicle");
    const value = await vehicleSelect.locator("option", { hasText: stockVin.slice(-8) }).getAttribute("value");
    await vehicleSelect.selectOption(value!);

    // The customer's old car, taken in part-payment.
    const tradeVin = randomVin();
    await page.getByTestId("tradein-toggle").check();
    await page.getByTestId("tradein-vin").fill(tradeVin);
    await page.getByTestId("tradein-registration").fill(randomPlate());
    await page.getByTestId("tradein-make").fill("Renault");
    await page.getByTestId("tradein-model").fill("Clio");
    await page.getByTestId("tradein-mileage").fill("72000");
    await page.getByTestId("tradein-market").fill("9000");
    await page.getByTestId("tradein-repair").fill("400");
    await page.getByTestId("tradein-offer").fill("8000");
    await expect(page.getByTestId("summary-total")).not.toHaveText("");
    await expect(page.getByTestId("approval-needed")).toHaveCount(0);

    await page.getByTestId("quote-send").click();
    await expect(page).toHaveURL(/\/sales\/quotes\/[a-z0-9]+$/, { timeout: 15_000 });
    await expect(page.locator("[data-status=SENT]").first()).toBeVisible();

    // The customer signs: the quote becomes an order and the trade-in a used car in intake.
    await page.getByRole("button", { name: "Customer signs the order" }).click();
    await expect(page).toHaveURL(/\/sales\/orders\/[a-z0-9]+$/, { timeout: 15_000 });
    const orderUrl = page.url();
    const orderNumber = (await page.getByRole("heading", { level: 1 }).innerText()).match(/[A-Z]{3}-BC-\d{4}-\d+/)![0];

    await page.goto(`/sales/vo-stock?q=${tradeVin}`);
    await expect(page.getByTestId("table-row")).toHaveCount(1);
    await expect(page.getByTestId("table-row")).toContainText("Intake");

    // Invoice, payment of the balance, delivery.
    await page.goto(orderUrl);
    await page.getByRole("button", { name: "Invoice", exact: true }).click();
    const invoiceLink = page.getByRole("link", { name: /[A-Z]{3}-FA-\d{4}-\d{6}/ });
    await expect(invoiceLink).toBeVisible({ timeout: 15_000 });
    const invoiceNumber = (await invoiceLink.innerText()).trim();

    await expect(page.getByTestId("payment-amount")).not.toHaveValue("");
    await page.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByTestId("order-due")).toHaveText("€0.00", { timeout: 15_000 });
    const receipts = (await page.getByRole("link", { name: /[A-Z]{3}-RC-\d{4}-\d{6}/ }).allInnerTexts()).map((r) => r.trim());
    expect(receipts.length).toBeGreaterThanOrEqual(2); // the trade-in and the customer's payment

    await page.getByTestId("delivery-registration").fill(randomPlate());
    await page.getByRole("button", { name: "Hand over the vehicle" }).click();
    await expect(page.getByTestId("order-steps").locator("[data-done=true]")).toHaveCount(4, { timeout: 15_000 });

    // The books: VN stock out at cost, the trade-in in VO stock at its offer, and the entries.
    await login(page, "accountant@dms.test");
    const after = await stockAccounts(page);
    expect(before.vn - after.vn).toBe(stockValue);
    expect(after.vo - before.vo).toBe(800_000);

    const entries = page.getByTestId("table-row");
    await page.goto(`/accounting/entries?q=${invoiceNumber}`);
    await expect(entries.filter({ hasText: `Invoice ${invoiceNumber}` })).toHaveCount(1);
    await expect(entries.filter({ hasText: "Cost of sale" })).toHaveCount(1);
    await page.goto(`/accounting/entries?q=${orderNumber}`);
    await expect(entries.filter({ hasText: "Trade-in" })).toHaveCount(2); // the purchase and its stock entry
    for (const receipt of receipts) {
      await page.goto(`/accounting/entries?q=${receipt}`);
      await expect(entries.filter({ hasText: `Receipt ${receipt}` })).toHaveCount(1);
    }
  });
});
