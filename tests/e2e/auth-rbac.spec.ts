import { expect, test, type Page } from "@playwright/test";
import { can, buildPermissionSet } from "../../src/lib/rbac";
import { DEFAULT_ROLE_MATRIX, flattenGrants, type RoleKey } from "../../src/modules/admin/domain/role-matrix";
import { NAV } from "../../src/components/shell/nav";

const PASSWORD = "demo1234"; // seed test credential (prisma/seed/index.ts)

const USERS: Record<RoleKey, string> = {
  ADMIN: "admin@dms.test",
  DEALER_PRINCIPAL: "dealer.principal@dms.test",
  SALES_MANAGER: "sales.manager.nantes@dms.test",
  SALESPERSON: "salesperson1.nantes@dms.test",
  SERVICE_MANAGER: "service.manager.rennes@dms.test",
  SERVICE_ADVISOR: "service.advisor.nantes@dms.test",
  TECHNICIAN: "technician1.angers@dms.test",
  PARTS_MANAGER: "parts.manager.nantes@dms.test",
  PARTS_ADVISOR: "parts.advisor.nantes@dms.test",
  ACCOUNTANT: "accountant@dms.test",
};

async function login(page: Page, email: string, password = PASSWORD, expectSuccess = true) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (expectSuccess) await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

function expectedMenu(role: RoleKey) {
  const perms = buildPermissionSet([{ siteId: null, permissions: flattenGrants(DEFAULT_ROLE_MATRIX[role]) }]);
  const all = NAV.flatMap((g) => g.items);
  return {
    visible: all.filter((i) => can(perms, i.resource, "view")).map((i) => i.href),
    hidden: all.filter((i) => !can(perms, i.resource, "view")).map((i) => i.href),
  };
}

test.describe("login and permission-filtered menus", () => {
  for (const [role, email] of Object.entries(USERS) as [RoleKey, string][]) {
    test(`${role} sees exactly the menus allowed by its permissions`, async ({ page }) => {
      await login(page, email);
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByTestId("business-date")).toBeVisible();
      const nav = page.getByRole("navigation", { name: "Main" });
      const { visible, hidden } = expectedMenu(role);
      for (const href of visible) await expect(nav.locator(`a[href="${href}"]`)).toHaveCount(1);
      for (const href of hidden) await expect(nav.locator(`a[href="${href}"]`)).toHaveCount(0);
    });
  }

  test("rejects a wrong password", async ({ page }) => {
    await login(page, USERS.ADMIN, "wrong-password", false);
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("redirects anonymous users to the login page", async ({ page }) => {
    await page.goto("/customers");
    await expect(page).toHaveURL(/\/login/);
  });

  test("blocks a technician from an admin screen opened by URL", async ({ page }) => {
    await login(page, USERS.TECHNICIAN);
    await page.goto("/admin/users");
    await expect(page.getByTestId("forbidden")).toBeVisible();
  });

  test("site-scoped users only see their own site", async ({ page }) => {
    await login(page, USERS.TECHNICIAN); // Angers technician
    const siteSelect = page.getByLabel("Site", { exact: true });
    await expect(siteSelect.locator("option")).toHaveCount(1);
    await expect(siteSelect).toContainText("ANG");
  });
});

test.describe("core workflows", () => {
  test("a salesperson creates a customer, which is numbered and audited", async ({ page }) => {
    await login(page, USERS.SALESPERSON);
    await page.goto("/customers/new");
    await page.getByLabel("First name").fill("Camille");
    await page.getByLabel("Last name").fill("Testeur");
    await page.getByLabel("Email", { exact: true }).fill("camille.testeur@example.test");
    await page.getByTestId("form-submit").click();
    await expect(page.getByRole("heading", { name: "Camille TESTEUR" })).toBeVisible();
    await expect(page.getByText(/C\d{6} · Customer account 411C\d{6}/)).toBeVisible();
    await expect(page.getByText("Customer created", { exact: true })).toBeVisible(); // timeline event
  });

  test("a VN in transit enters stock through its arrival in sales, never by hand", async ({ page }) => {
    await login(page, USERS.ADMIN);
    await page.goto("/vehicles?stockType=VN&status=IN_TRANSIT");
    await page.getByTestId("table-row").first().getByRole("link").first().click();
    await expect(page.locator("[data-status=IN_TRANSIT]").first()).toBeVisible();
    // The vehicle record has no manual status change (D-048): it sends the user to the sales flow.
    await expect(page.getByRole("button", { name: "Change status" })).toHaveCount(0);
    await page.getByRole("link", { name: "Open in sales" }).click();
    await expect(page).toHaveURL(/\/sales\/vn-stock\/[a-z0-9]+$/);
    await expect(page.getByTestId("receive-cost")).not.toHaveValue("");
    await page.getByRole("button", { name: "Receive in stock" }).click();
    await expect(page.locator("[data-status=IN_STOCK]").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Arrived from the manufacturer").first()).toBeVisible();
  });

  test("the demo role switcher changes the signed-in user", async ({ page }) => {
    await login(page, USERS.ADMIN);
    await page.getByTestId("role-switcher").click();
    await page.getByRole("menuitem", { name: /Accountant/ }).first().click();
    await expect(page.getByTestId("user-menu")).toContainText("Accountant");
    await expect(page.getByRole("navigation", { name: "Main" }).locator('a[href="/admin/users"]')).toHaveCount(0);
  });

  test("lists filter and export to CSV", async ({ page }) => {
    await login(page, USERS.ADMIN);
    await page.goto("/customers?kind=COMPANY");
    const total = await page.getByTestId("table-total").innerText();
    expect(Number(total.split(" ")[0])).toBeGreaterThan(30);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^customers-.*\.csv$/);
  });
});
