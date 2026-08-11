import { expect, test } from "./support/credential-test";
import { FIXED_ACCOUNT_SKIP_REASON, loadFixedAccountForMode } from "./support/fixed-accounts";
import { loginWithFixedAccount } from "./support/login";

test("fixed student account reaches the private Notebook workspace", async ({ page }) => {
  const student = loadFixedAccountForMode("student");
  test.skip(!student, FIXED_ACCOUNT_SKIP_REASON);
  if (!student) return;

  await loginWithFixedAccount(page, student, "/zh/notebook/me");
  await expect(page.locator("main[data-workspace]")).toBeVisible();
  await expect(page.locator("main[data-workspace] h1")).toBeVisible();
});
