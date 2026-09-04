import { expect, test, type Page } from "@playwright/test";
import { loadFixedAccountForMode, FIXED_ACCOUNT_SKIP_REASON } from "./support/fixed-accounts";
import { loginWithFixedAccount } from "./support/login";

const ZH_PRIMARY_SECTIONS = ["本期业务事实", "当前未完成记录", "学辅完整周期", "老师参与与报名", "班级容量事实"];

async function expectNoPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function expectPrimarySectionsInViewport(page: Page) {
  for (const sectionName of ZH_PRIMARY_SECTIONS) {
    await expect(page.getByRole("heading", { name: sectionName, exact: true })).toBeInViewport();
  }
}

test("staff homepage prioritizes per-person business and class capacity across screen sizes", async ({ page }) => {
  const admin = loadFixedAccountForMode("admin");
  test.skip(!admin, FIXED_ACCOUNT_SKIP_REASON);
  if (!admin) return;

  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithFixedAccount(page, admin, "/zh/dashboard");
  await expect(page.getByRole("heading", { name: "业务数据总览", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "统计周期" }).getByRole("link", { name: "按周" }))
    .toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "趋势数据项" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "按老师", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "按年级", exact: true })).toBeVisible();
  await expectPrimarySectionsInViewport(page);
  await expectNoPageOverflow(page);

  await page.getByRole("navigation", { name: "统计周期" }).getByRole("link", { name: "按月" }).click();
  await expect(page).toHaveURL(/\/zh\/dashboard\?period=month$/);
  await expect(page.getByRole("navigation", { name: "统计周期" }).getByRole("link", { name: "按月" }))
    .toHaveAttribute("aria-current", "page");

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectPrimarySectionsInViewport(page);
  await expectNoPageOverflow(page);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "业务数据总览", exact: true })).toBeVisible();
  await expectNoPageOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectNoPageOverflow(page);
  await expect(page.getByRole("heading", { name: "本期业务事实", exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "学辅完整周期", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "学辅完整周期", exact: true })).toBeInViewport();
  await page.getByRole("heading", { name: "老师参与与报名", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "老师参与与报名", exact: true })).toBeInViewport();
  await page.getByRole("heading", { name: "班级容量事实", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "班级容量事实", exact: true })).toBeInViewport();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/en/dashboard?period=month");
  await expect(page.getByRole("heading", { name: "Business data overview", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learning-support full cycle", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Teacher participation and enrollment", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Class capacity facts", exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
});
