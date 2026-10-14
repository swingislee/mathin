import { expect, type Page } from "@playwright/test";
import type { FixedAccount } from "./fixed-accounts";

export async function loginWithFixedAccount(
  page: Page,
  account: FixedAccount,
  destination: `/${"zh" | "en"}/${string}`,
): Promise<void> {
  const locale = destination.split("/")[1];
  if (locale !== "zh" && locale !== "en") throw new Error("E2E destination must include a supported locale");

  await page.goto(`/${locale}/login?next=${encodeURIComponent(destination)}`);
  // 账号密码登录把邮箱拆成用户名与域名两栏；面板收起时先展开。
  const localPart = page.locator('input[name="emailLocalPart"]');
  if (!(await localPart.isVisible())) await page.locator("main details summary").first().click();
  const [user, domain] = account.email.split("@");
  await localPart.fill(user);
  await page.locator('input[name="emailDomain"]').fill(domain);
  const password = page.locator('main input[name="password"]');
  await password.fill(account.password);
  await password.press("Enter");
  await page.waitForURL((url) => url.pathname === destination, { waitUntil: "domcontentloaded" });
  await expect(page.locator('main form [role="alert"]')).toHaveCount(0);
}
