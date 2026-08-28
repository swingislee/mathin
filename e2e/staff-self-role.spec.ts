import { expect, test } from "./support/credential-test";
import { FIXED_ACCOUNT_SKIP_REASON, loadFixedAccountForMode } from "./support/fixed-accounts";
import { loginWithFixedAccount } from "./support/login";

test("administrator can open their own staff-role editor in Chinese and English", async ({ page }) => {
  const admin = loadFixedAccountForMode("admin");
  test.skip(!admin, FIXED_ACCOUNT_SKIP_REASON);
  if (!admin) return;

  await loginWithFixedAccount(page, admin, "/zh/dashboard/staff");
  const zhSelfRow = page.locator("tbody tr").first();
  await expect(zhSelfRow.getByText("本人", { exact: true })).toBeVisible();
  await expect(zhSelfRow.getByRole("button", { name: "停用", exact: true })).toHaveCount(0);
  await zhSelfRow.getByRole("button", { name: "管理岗位", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: /^管理岗位：/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/en/dashboard/staff");
  const enSelfRow = page.locator("tbody tr").first();
  await expect(enSelfRow.getByText("You", { exact: true })).toBeVisible();
  await expect(enSelfRow.getByRole("button", { name: "Deactivate", exact: true })).toHaveCount(0);
  await enSelfRow.getByRole("button", { name: "Manage roles", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: /^Manage roles:/ })).toBeVisible();
});
