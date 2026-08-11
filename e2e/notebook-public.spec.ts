import { expect, test } from "@playwright/test";

test("public Notebook remains available without a session", async ({ page }) => {
  await page.goto("/zh/notebook");

  await expect(page).toHaveURL((url) => url.pathname === "/zh/notebook");
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator('a[href="/zh/notebook/me"]')).toBeVisible();
});
