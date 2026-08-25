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
  await page.locator("#identifier").fill(account.email);
  await page.locator("#password").fill(account.password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === destination, { waitUntil: "domcontentloaded" });
  await expect(page.locator('main form [role="alert"]')).toHaveCount(0);
}
