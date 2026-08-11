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
});
