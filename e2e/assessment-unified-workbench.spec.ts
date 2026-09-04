import { expect, test } from "@playwright/test";
import { FIXED_ACCOUNT_SKIP_REASON, loadFixedAccountForMode } from "./support/fixed-accounts";
import { loginWithFixedAccount } from "./support/login";

test("admin sees one 1:1 assessment workbench for teacher entry and support handoff", async ({ page }) => {
  const admin = loadFixedAccountForMode("admin");
  test.skip(!admin, FIXED_ACCOUNT_SKIP_REASON);
  if (!admin) return;

  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithFixedAccount(page, admin, "/zh/dashboard/assessments");

  await expect(page.getByRole("heading", { level: 1, name: "1 对 1 测评" })).toBeVisible();
  await expect(page.locator("[data-assessment-unified-workbench]")).toBeVisible();
  await expect(page.getByRole("tab", { name: /待测评/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /测评中/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /待向家长反馈/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /已归类/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /切换到/ })).toHaveCount(0);

  const currentRows = page.locator("[data-assessment-workbench-row]");
  await expect(currentRows.first()).toBeVisible();
  const currentDetail = page.locator("[data-assessment-workbench-detail]").first();
  if (!await currentDetail.isVisible()) await currentRows.first().click();
  await expect(currentDetail).toBeVisible();

  await page.getByRole("tab", { name: /待测评/ }).click();
  const reassignment = page.locator("[data-assessor-reassignment]");
  if (await reassignment.count()) await expect(reassignment.first()).toBeEnabled();

  await page.goto("/zh/dashboard/assessments/support-preview");
  await expect(page).toHaveURL(/\/zh\/dashboard\/assessments$/);

  await page.goto("/en/dashboard/assessments");
  await expect(page.getByRole("heading", { level: 1, name: "1:1 assessments" })).toBeVisible();
  await expect(page.locator("[data-assessment-unified-workbench]")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Awaiting assessment/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Awaiting family feedback/ })).toBeVisible();
});
