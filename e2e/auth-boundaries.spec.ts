import { expect, test } from "@playwright/test";

test.describe("authentication boundaries", () => {
  test("anonymous school portal requests preserve a safe return path", async ({ page }) => {
    await page.goto("/zh/dashboard");

    await expect(page).toHaveURL((url) =>
      url.pathname === "/zh/login" && url.searchParams.get("next") === "/zh/dashboard");
    await expect(page.locator("main form")).toBeVisible();
  });

  test("anonymous Notebook workspace requests preserve a safe return path", async ({ page }) => {
    await page.goto("/zh/notebook/me");

    await expect(page).toHaveURL((url) =>
      url.pathname === "/zh/login" && url.searchParams.get("next") === "/zh/notebook/me");
    await expect(page.locator("main form")).toBeVisible();
  });

  test("invalid credentials stay on the login boundary with an accessible error", async ({ page }) => {
    await page.goto("/zh/login");
    await page.locator("#email").fill("unknown-user@mathin.invalid");
    await page.locator("#password").fill("not-a-real-account-secret");
    await page.locator('form button[type="submit"]').click();

    await expect(page).toHaveURL((url) =>
      url.pathname === "/zh/login" && url.searchParams.get("error") === "credentials");
    await expect(page.locator('main form [role="alert"]')).toBeVisible();
  });
});
