import { expect, test, type Locator, type Page } from "@playwright/test";

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

const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];
const LETTERS = "ABCDEFGHJKLMNPQRTVXYZ";
const randomPlate = () => `${pick(LETTERS)}${pick(LETTERS)}-${100 + Math.floor(Math.random() * 900)}-${pick(LETTERS)}${pick(LETTERS)}`;
const randomVin = () => `VF3E2E${Array.from({ length: 11 }, () => pick("0123456789")).join("")}`;

const OPEN_RO = /Checked in|In progress|Quality check|Ready|Invoiced/;

/** A customer's car of one of the group's makes, not already in the workshop: its id. */
async function customerCar(page: Page, make: string, skip: string[] = []) {
  await page.goto(`/vehicles?status=CUSTOMER&q=${make}`);
  const hrefs = await page.getByTestId("table-row").locator("a[href^='/vehicles/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  for (const href of [...new Set(hrefs)]) {
    const id = href.split("/").pop()!;
    if (skip.includes(id)) continue;
    await page.goto(href);
    const history = page.getByTestId("service-history");
    if ((await history.count()) && OPEN_RO.test(await history.innerText())) continue;
    return id;
  }
  throw new Error(`No ${make} available for the workshop`);
}

/** Submit the SpecForm inside a container. */
const submit = (scope: Locator) => scope.getByTestId("form-submit").click();

/** The job's line with that data-line ("labour" | "part"): amount and cost cells. */
async function lineFigures(page: Page, job: number, kind: "labour" | "part") {
  const row = page.getByTestId(`job-${job}-lines`).locator(`tr[data-line="${kind}"]`).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const cells = row.locator("td");
  return { amount: cents(await cells.nth(5).innerText()), cost: cents(await cells.nth(6).innerText()) };
}

async function addLabour(page: Page, job: number) {
  const form = page.getByTestId(`job-${job}-add-labour`);
  const select = form.locator('select[name="operationCode"]');
  await select.selectOption({ index: 1 });
  await submit(form);
  return lineFigures(page, job, "labour");
}

async function finishAndCheck(page: Page, jobs: number) {
  for (let n = 1; n <= jobs; n++) {
    await page.getByTestId(`job-${n}`).locator("..").locator("..").getByRole("button", { name: "Job done" }).click();
    await expect(page.getByTestId(`job-${n}`)).toContainText("Done", { timeout: 15_000 });
  }
  await expect(page.getByTestId("qc-form")).toBeVisible({ timeout: 15_000 });
  await submit(page.getByTestId("qc-form"));
  await expect(page.getByTestId("invoice-form")).toBeVisible({ timeout: 15_000 });
}

/** The entry of an invoice: its lines as { account, department, party, debit, credit }. */
async function invoiceEntryLines(page: Page, invoiceUrl: string) {
  await page.goto(invoiceUrl);
  await page.getByRole("link", { name: /^[A-Z]{2}-\d{4}-\d{6}$/ }).first().click();
  const table = page.getByTestId("entry-lines");
  await expect(table).toBeVisible();
  const rows = await table.locator("tbody tr").all();
  const lines = [];
  for (const row of rows) {
    const c = row.locator("td");
    if ((await c.count()) < 7) continue;
    lines.push({
      account: (await c.nth(1).innerText()).trim().split(/\s/)[0],
      department: (await c.nth(3).innerText()).trim(),
      party: (await c.nth(4).innerText()).trim(),
      debit: cents(await c.nth(5).innerText()),
      credit: cents(await c.nth(6).innerText()),
    });
  }
  return lines;
}

test.describe("workshop", () => {
  test("Flow 3 — appointment → check-in → labour + parts → invoice → payment, stock at PMP and revenue by department", async ({ page }) => {
    test.setTimeout(240_000);
    page.on("dialog", (dialog) => dialog.accept());

    await login(page, "accountant@dms.test");
    const before = await balances(page, ["706100", "707300", "373000"]);

    await login(page, "service.advisor.nantes@dms.test");
    // A filter on the Nantes shelf, and its weighted average cost.
    await page.goto("/parts/stock?family=FILTERS&sort=qtyOnHand&dir=desc");
    const first = page.getByTestId("table-row").first();
    const partNumber = (await first.locator("td").first().innerText()).trim();
    await first.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/parts\/stock\/[a-z0-9]+$/);
    const itemUrl = page.url();
    const startOnHand = qty(await page.getByTestId("stock-on-hand").innerText());
    const startValue = cents(await page.getByTestId("stock-value").innerText());
    const pmp = cents(await page.getByTestId("stock-pmp").innerText());
    expect(startOnHand).toBeGreaterThan(0);

    // The customer phones: an appointment today.
    const vehicleId = await customerCar(page, "Peugeot");
    const concern = `E2E service ${Date.now()}`;
    await page.goto(`/workshop/planner/new?vehicle=${vehicleId}`);
    await page.getByTestId("appt-time").fill("16:30");
    await page.getByTestId("appt-concern").fill(concern);
    await page.getByTestId("form-submit").click();
    await expect(page).toHaveURL(/\/workshop\/planner\?/, { timeout: 15_000 });

    // The car arrives: check-in from the planner (mileage, fuel, damage, signature).
    const card = page.getByTestId("appointment").filter({ hasText: concern });
    await card.getByRole("link", { name: "Check in" }).click();
    await expect(page).toHaveURL(/\/workshop\/repair-orders\/new\?appointment=/);
    const mileage = Number(await page.getByTestId("checkin-mileage").inputValue()) + 1200;
    await page.getByTestId("checkin-mileage").fill(String(mileage));
    await page.getByTestId("checkin-damages").fill("FRONT: scratch on bumper");
    const pad = page.getByTestId("signature-pad");
    const box = (await pad.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 40);
    await page.mouse.move(box.x + 200, box.y + 25);
    await page.mouse.up();
    await page.getByTestId("form-submit").click();
    await expect(page).toHaveURL(/\/workshop\/repair-orders\/[a-z0-9]+$/, { timeout: 15_000 });
    const roUrl = page.url();
    await expect(page.getByText("Checked in").first()).toBeVisible();
    await expect(page.getByText("FRONT: scratch on bumper")).toBeVisible();

    // Labour from the catalogue and the filter from stock.
    const labour = await addLabour(page, 1);
    expect(labour.amount).toBeGreaterThan(0);
    const partForm = page.getByTestId("job-1-add-part");
    await partForm.locator('input[name="partNumber"]').fill(partNumber);
    await partForm.locator('input[name="qty"]').fill("1");
    await submit(partForm);
    const part = await lineFigures(page, 1, "part");
    expect(part.amount).toBeGreaterThan(0);
    expect(Math.abs(part.cost - pmp)).toBeLessThanOrEqual(1);

    // The part left the shelf at PMP.
    await page.goto(itemUrl);
    expect(qty(await page.getByTestId("stock-on-hand").innerText())).toBe(startOnHand - 1);
    expect(startValue - cents(await page.getByTestId("stock-value").innerText())).toBe(part.cost);

    // The workshop manager finishes, checks and invoices on account; the customer then pays by card.
    await login(page, "service.manager.nantes@dms.test");
    await page.goto(roUrl);
    await finishAndCheck(page, 1);
    await page.getByTestId("ro-pay").selectOption("ACCOUNT");
    await submit(page.getByTestId("invoice-form"));
    await expect(page.getByText("Invoiced").first()).toBeVisible({ timeout: 15_000 });
    const invoiceLink = page.getByTestId("ro-invoice");
    await expect(invoiceLink).toHaveCount(1);
    const invoiceHref = (await invoiceLink.getAttribute("href"))!;
    await expect(page.getByTestId("payment-form")).toBeVisible();
    await submit(page.getByTestId("payment-form"));
    await expect(page.getByTestId("payment-form")).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole("button", { name: "Hand over car" }).click();
    await expect(page.getByText("Closed").first()).toBeVisible({ timeout: 15_000 });

    // The invoice is settled, labour on the workshop and the filter on the parts department.
    await login(page, "accountant@dms.test");
    await page.goto(invoiceHref);
    await expect(page.getByTestId("invoice-due")).toHaveText("€0.00");
    const lines = await invoiceEntryLines(page, invoiceHref);
    const labourLine = lines.find((l) => l.account === "706100");
    const partsLine = lines.find((l) => l.account === "707300");
    expect(labourLine).toMatchObject({ department: "Workshop", credit: labour.amount });
    expect(partsLine).toMatchObject({ department: "Parts", credit: part.amount });

    const after = await balances(page, ["706100", "707300", "373000"]);
    expect(before["706100"] - after["706100"]).toBe(labour.amount);
    expect(before["707300"] - after["707300"]).toBe(part.amount);
    expect(before["373000"] - after["373000"]).toBe(part.cost);
  });

  test("Flow 4 — a warranty job is invoiced to the manufacturer with a claim, apart from the customer's job", async ({ page }) => {
    test.setTimeout(240_000);
    page.on("dialog", (dialog) => dialog.accept());

    await login(page, "service.manager.nantes@dms.test");
    const vehicleId = await customerCar(page, "Renault");

    // Walk-in check-in: the customer's job comes from the concern.
    await page.goto(`/workshop/repair-orders/new?vehicle=${vehicleId}`);
    await page.getByTestId("checkin-concern").fill("Service and noisy window regulator");
    await page.getByTestId("form-submit").click();
    await expect(page).toHaveURL(/\/workshop\/repair-orders\/[a-z0-9]+$/, { timeout: 15_000 });
    const customerLabour = await addLabour(page, 1);

    // A second job under the manufacturer's warranty.
    const addJob = page.getByTestId("add-job");
    await addJob.locator('input[name="description"]').fill("Window regulator under warranty");
    await addJob.locator('select[name="payer"]').selectOption("WARRANTY");
    await submit(addJob);
    await expect(page.getByTestId("job-2")).toContainText("Warranty", { timeout: 15_000 });
    const warrantyLabour = await addLabour(page, 2);
    const warrantyTotal = cents(await page.getByTestId("job-2-total").innerText());
    expect(warrantyTotal).toBe(warrantyLabour.amount);

    await finishAndCheck(page, 2);
    await page.getByTestId("ro-pay").selectOption("CARD");
    await submit(page.getByTestId("invoice-form"));
    await expect(page.getByTestId("ro-invoice")).toHaveCount(2, { timeout: 15_000 });

    // The claim, submitted for the warranty job's amount.
    const documents = page.getByTestId("ro-documents");
    const claimNumber = (await documents.getByRole("link", { name: /-GA-\d{4}-\d+/ }).first().innerText()).trim();
    await expect(documents).toContainText("Submitted");

    // One invoice per payer: the customer's is paid, the manufacturer's is a receivable.
    const hrefs = await page.getByTestId("ro-invoice").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    let oemInvoice: string | null = null;
    let oemName = "";
    for (const href of hrefs) {
      await page.goto(href);
      const due = cents(await page.getByTestId("invoice-due").innerText());
      if (due > 0) {
        oemInvoice = href;
        oemName = (await page.locator('main a[href^="/customers/"]').first().innerText()).trim();
      } else {
        expect(due).toBe(0);
      }
    }
    expect(oemInvoice).not.toBeNull();
    expect(oemName).not.toBe("");

    // The warranty desk sees the claim, waiting for the manufacturer.
    await page.goto(`/workshop/warranty?q=${claimNumber}`);
    const claimRows = page.locator("main tbody tr");
    await expect(claimRows).toHaveCount(1);
    await expect(claimRows).toContainText("Submitted");
    const claimed = cents(await claimRows.locator("td").nth(6).innerText());
    expect(claimed).toBe(Math.round((warrantyTotal * 12000) / 10000)); // the invoice incl. VAT

    await login(page, "accountant@dms.test");
    const lines = await invoiceEntryLines(page, oemInvoice!);
    const receivable = lines.find((l) => l.account.startsWith("411"));
    expect(receivable?.party).toContain(oemName);
    expect(receivable!.debit).toBe(claimed);
    const revenue = lines.filter((l) => l.credit > 0 && l.account.startsWith("7"));
    expect(revenue.reduce((s, l) => s + l.credit, 0)).toBe(warrantyTotal);
    expect(revenue.every((l) => l.account === "706300")).toBe(true);

    expect(customerLabour.amount).toBeGreaterThan(0);
  });

  test("Flow 2 — a used car bought, prepared by the workshop at cost, sold under the margin regime", async ({ page }) => {
    test.setTimeout(300_000);
    page.on("dialog", (dialog) => dialog.accept());

    await login(page, "accountant@dms.test");
    const before = await balances(page, ["372000", "604000"]);

    // Bought from a private seller, for resale under VAT on margin.
    await login(page, "sales.manager.nantes@dms.test");
    const vin = randomVin();
    const plate = randomPlate();
    await page.goto("/sales/vo-stock/purchase");
    const seller = page.locator('select[name="customerId"]');
    await seller.selectOption({ index: 1 });
    await page.getByTestId("vo-price").fill("9000");
    await page.locator('input[name="listPriceCents"]').fill("13900");
    await page.getByTestId("vo-vin").fill(vin);
    await page.locator('input[name="vehicle.registration"]').fill(plate);
    await page.getByTestId("vo-make").fill("Renault");
    await page.getByTestId("vo-model").fill("Clio");
    await page.getByTestId("vo-mileage").fill("65000");
    await page.getByTestId("form-submit").click();
    await expect(page).toHaveURL(/\/sales\/vo-stock\/(?!purchase)[a-z0-9]+$/, { timeout: 15_000 });
    const voUrl = page.url();
    const vehicleId = voUrl.split("/").pop()!;
    await expect(page.getByText("VAT on margin").first()).toBeVisible();

    // The workshop prepares it on an internal repair order.
    await login(page, "service.manager.nantes@dms.test");
    await page.goto(`/workshop/repair-orders/new?vehicle=${vehicleId}&kind=INTERNAL`);
    await page.getByTestId("form-submit").click();
    await expect(page).toHaveURL(/\/workshop\/repair-orders\/[a-z0-9]+$/, { timeout: 15_000 });
    await expect(page.getByText("Internal").first()).toBeVisible();
    await addLabour(page, 1);
    await finishAndCheck(page, 1);
    const roTotal = cents(await page.getByTestId("ro-total").innerText());
    expect(roTotal).toBeGreaterThan(0);
    await submit(page.getByTestId("invoice-form"));
    await expect(page.getByText("Invoiced").first()).toBeVisible({ timeout: 15_000 });

    // The work is capitalised in the car's stock value.
    await login(page, "sales.manager.nantes@dms.test");
    await page.goto(voUrl);
    const figure = async (label: string) => cents(await page.locator("dl div").filter({ hasText: label }).locator("dd").innerText());
    expect(await figure("Costs capitalised")).toBe(roTotal);
    const stockValue = await figure("Stock value");
    expect(stockValue).toBe(900_000 + roTotal);

    await login(page, "accountant@dms.test");
    const prepared = await balances(page, ["372000", "604000"]);
    expect(prepared["372000"] - before["372000"]).toBe(900_000 + roTotal);

    // On sale, then sold to a private customer.
    await login(page, "sales.manager.nantes@dms.test");
    await page.goto(voUrl);
    await page.getByTestId("vo-list-price").fill("13900");
    await page.getByRole("button", { name: "Put on sale" }).click();
    await expect(page.getByText("For sale").first()).toBeVisible({ timeout: 15_000 });

    await page.goto("/customers?kind=INDIVIDUAL");
    const customerHref = await page.getByTestId("table-row").nth(1).getByRole("link").first().getAttribute("href");
    await page.goto(`/sales/leads/new?customer=${customerHref!.split("/").pop()}&interest=VO`);
    await page.getByTestId("form-submit").click();
    await expect(page).toHaveURL(/\/sales\/leads\/[a-z0-9]+$/, { timeout: 15_000 });
    await page.getByRole("link", { name: "New quote" }).click();
    const vehicleSelect = page.getByTestId("quote-vehicle");
    const option = await vehicleSelect.locator("option", { hasText: plate }).getAttribute("value");
    await vehicleSelect.selectOption(option!);
    await expect(page.getByTestId("quote-summary")).toBeVisible();
    await page.getByTestId("quote-send").click();
    await expect(page).toHaveURL(/\/sales\/quotes\/[a-z0-9]+$/, { timeout: 15_000 });
    await page.getByRole("button", { name: "Customer signs the order" }).click();
    await expect(page).toHaveURL(/\/sales\/orders\/[a-z0-9]+$/, { timeout: 15_000 });
    await page.getByRole("button", { name: "Invoice", exact: true }).click();
    const invoiceLink = page.getByRole("link", { name: /[A-Z]{3}-FA-\d{4}-\d{6}/ });
    await expect(invoiceLink).toBeVisible({ timeout: 15_000 });
    const invoiceHref = (await invoiceLink.getAttribute("href"))!;

    // VAT on the margin only: (13,900 − 9,000) × 20/120; the workshop's work is not deducted.
    await login(page, "accountant@dms.test");
    const lines = await invoiceEntryLines(page, invoiceHref);
    const marginVat = lines.filter((l) => l.account === "445715").reduce((s, l) => s + l.credit, 0);
    expect(Math.abs(marginVat - Math.round((490_000 * 2000) / 12000))).toBeLessThanOrEqual(1);

    // The car left VO stock at its full cost (purchase + preparation).
    const sold = await balances(page, ["372000"]);
    expect(prepared["372000"] - sold["372000"]).toBe(stockValue);
  });
});
