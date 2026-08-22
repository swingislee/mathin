import { expect, test } from "./support/credential-test";
import { FIXED_ACCOUNT_SKIP_REASON, loadFixedAccountForMode } from "./support/fixed-accounts";
import { loginWithFixedAccount } from "./support/login";

test.describe("fixed-account school portals", () => {
  test("student reaches learning classes and is rejected by a staff-only route", async ({ page }) => {
    const student = loadFixedAccountForMode("student");
    test.skip(!student, FIXED_ACCOUNT_SKIP_REASON);
    if (!student) return;

    await loginWithFixedAccount(page, student, "/zh/dashboard/learning/classes");
    await expect(page.locator("[data-dashboard-canvas]")).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();

    await page.goto("/zh/dashboard/system-health");
    await expect(page).toHaveURL((url) => url.pathname === "/zh/dashboard");
    await expect(page.locator("[data-dashboard-canvas]")).toBeVisible();
  });

  test("parent reaches the bound children portal", async ({ page }) => {
    const parent = loadFixedAccountForMode("parent");
    test.skip(!parent, FIXED_ACCOUNT_SKIP_REASON);
    if (!parent) return;

    await loginWithFixedAccount(page, parent, "/zh/dashboard/children");
    await expect(page.locator("[data-dashboard-canvas]")).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();
  });

  test("teacher reaches the staff classroom portal", async ({ page }) => {
    const teacher = loadFixedAccountForMode("teacher");
    test.skip(!teacher, FIXED_ACCOUNT_SKIP_REASON);
    if (!teacher) return;

    await loginWithFixedAccount(page, teacher, "/zh/dashboard/classes");
    await expect(page.locator("[data-dashboard-canvas]")).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();
  });

  test("principal can choose immediate activation for a production free class", async ({ page }) => {
    const principal = loadFixedAccountForMode("principal");
    test.skip(!principal, FIXED_ACCOUNT_SKIP_REASON);
    if (!principal) return;

    await loginWithFixedAccount(page, principal, "/zh/dashboard/classes/new");
    await page.getByRole("button", { name: "自由建班", exact: true }).click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await page.getByLabel("班级名", { exact: true }).fill("R1-Live 门禁只读验证");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    const activateNow = page.getByRole("checkbox", { name: "创建后立即启用" });
    await expect(activateNow).toBeEnabled();
    await activateNow.check();
    await expect(activateNow).toBeChecked();
    await expect(
      page.getByText("将创建进行中的班级；准备度和时间冲突仍会保留为运营提醒。", { exact: true }),
    ).toBeVisible();
  });
});
