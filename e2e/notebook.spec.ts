import { expect, test } from "@playwright/test";
import { FIXED_ACCOUNT_SKIP_REASON, loadFixedAccount } from "./support/fixed-accounts";
import { loginWithFixedAccount } from "./support/login";

test.describe("Notebook publication and workspace", () => {
  test("public Notebook remains available without a session", async ({ page }) => {
    await page.goto("/zh/notebook");

    await expect(page).toHaveURL((url) => url.pathname === "/zh/notebook");
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator('a[href="/zh/notebook/me"]')).toBeVisible();
  });

  test("fixed student account reaches the private Notebook workspace", async ({ page }) => {
    const student = loadFixedAccount("student");
    test.skip(!student, FIXED_ACCOUNT_SKIP_REASON);
    if (!student) return;

    await loginWithFixedAccount(page, student, "/zh/notebook/me");
    await expect(page.locator("main[data-workspace]")).toBeVisible();
    await expect(page.locator("main[data-workspace] h1")).toBeVisible();
  });
});
