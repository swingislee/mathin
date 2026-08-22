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

  test("principal can choose immediate activation for a production free class", async ({ page }) => {
    const principal = loadFixedAccountForMode("principal");
    test.skip(!principal, FIXED_ACCOUNT_SKIP_REASON);
    if (!principal) return;

    await loginWithFixedAccount(page, principal, "/zh/dashboard/classes/new");
    await page.getByRole("button", { name: "自由建班", exact: true }).click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await page.getByLabel("班级名", { exact: true }).fill("R1-Live 门禁只读验证");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    const activateNow = page.getByRole("checkbox", { name: "创建后立即启用" });
    await expect(activateNow).toBeEnabled();
    await activateNow.check();
    await expect(activateNow).toBeChecked();
    await expect(
      page.getByText("将创建进行中的班级；准备度和时间冲突仍会保留为运营提醒。", { exact: true }),
    ).toBeVisible();
  });

  test("principal sees the bilingual academic-year plan without triggering promotion", async ({ page }) => {
    const principal = loadFixedAccountForMode("principal");
    test.skip(!principal, FIXED_ACCOUNT_SKIP_REASON);
    if (!principal) return;

    await loginWithFixedAccount(page, principal, "/zh/dashboard/schedule");
    await page.getByRole("button", { name: "学年与运营周期", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("2025–2026 学年", { exact: true })).toBeVisible();
    await expect(dialog.locator('input[value="2026-06-29"]')).toHaveCount(1);
    await expect(dialog.locator('input[type="date"]')).toHaveCount(8);
    await expect(dialog.getByRole("button", { name: "保存日期", exact: true })).toHaveCount(0);

    await dialog.getByRole("combobox", { name: "查看学年", exact: true }).click();
    await page.getByRole("option", { name: "2026–2027 学年 · 待启用", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "2026–2027 学年", exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "2025–2026 学年", exact: true })).toHaveCount(0);
    await expect(dialog.locator('input[type="date"]')).toHaveCount(9);

    await dialog.getByRole("button", { name: "创建学年", exact: true }).click();
    await expect(dialog.getByText("创建只会建立学年和四个日期待定的运营周期，不会改变学生年级。", { exact: true })).toBeVisible();

    const periodDateInputs = dialog.locator('input[type="date"]');
    await periodDateInputs.first().fill("2026-07-01");
    await expect(dialog.getByText("开始日期和结束日期需要同时填写；也可以同时留空。", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "保存日期", exact: true })).toHaveCount(1);
    await dialog.getByLabel("学年起始年份", { exact: true }).fill("2026");
    await expect(dialog.getByText("该学年已经存在，请直接编辑下方的运营周期。", { exact: true })).toBeVisible();

    await page.goto("/en/dashboard/schedule");
    await page.getByRole("button", { name: "Academic years and operating periods", exact: true }).click();
    const englishDialog = page.getByRole("dialog");
    await expect(englishDialog.getByRole("combobox", { name: "View academic year", exact: true })).toBeVisible();
    await englishDialog.getByRole("button", { name: "Create academic year", exact: true }).click();
    await expect(englishDialog.getByText("Creation only adds the year and four undated operating periods. It does not change any student grade.", { exact: true })).toBeVisible();
  });
});
