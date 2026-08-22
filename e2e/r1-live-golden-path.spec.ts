import { expect, test } from "./support/credential-test";
import { FIXED_ACCOUNT_SKIP_REASON, loadFixedAccountForMode } from "./support/fixed-accounts";
import { loginWithFixedAccount } from "./support/login";
import {
  type R1LiveGoldenPathFixture,
  setupR1LiveGoldenPathFixture,
} from "./support/r1-live-golden-path-fixture";

const FIXTURE_FLAG_REASON = "set R1_DEV_TEST_FIXTURES=1 and use the local Golden Path runner";
let activeFixture: R1LiveGoldenPathFixture | null = null;

test.afterEach(async () => {
  if (!activeFixture) return;
  await activeFixture.cleanup();
  activeFixture = null;
});

test("principal builds an incomplete-course class and its teacher persists and rereads attendance", async ({ page }) => {
  test.setTimeout(120_000);
  const principal = loadFixedAccountForMode("principal");
  const teacher = loadFixedAccountForMode("teacher");
  test.skip(!principal || !teacher, FIXED_ACCOUNT_SKIP_REASON);
  test.skip(process.env.R1_DEV_TEST_FIXTURES !== "1", FIXTURE_FLAG_REASON);
  if (!principal || !teacher) return;

  const fixture = await setupR1LiveGoldenPathFixture({ principal, teacher });
  activeFixture = fixture;
  try {
    await loginWithFixedAccount(page, principal, "/zh/dashboard/classes/new");
    await page.getByRole("button", { name: "测试班", exact: true }).click();
    await page.getByRole("button", { name: "搜索并选择课程版本", exact: true }).click();
    await page.getByRole("combobox", { name: "搜索产品、版本、产品码或讲次", exact: true }).fill(fixture.courseTitle);
    const courseOption = page.getByRole("option").filter({ hasText: fixture.courseTitle });
    await expect(courseOption).toHaveCount(1);
    await courseOption.click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await page.getByLabel("班级名", { exact: true }).fill(fixture.className);
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(page.getByText("请选择主讲教师后再继续。", { exact: true })).toBeVisible();

    const staffSelectors = page.getByRole("combobox");
    await staffSelectors.nth(1).click();
    await page.getByRole("option", { name: fixture.teacherDisplayName, exact: true }).click();
    await staffSelectors.first().click();
    await page.getByRole("option", { name: fixture.teacherDisplayName, exact: true }).click();
    await expect(page.getByText("原学辅与新主讲为同一人，已改为暂不指定学辅。", { exact: true })).toBeVisible();
    await expect(staffSelectors.nth(1)).toContainText("暂不指定学辅");
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: fixture.termName, exact: false }).click();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][tomorrow.getDay()];
    await page.getByRole("button", { name: weekday, exact: true }).click();
    await expect(page.getByText(fixture.lectureName, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await expect(page.getByText("测试班可带未完成课件启用；请确认这是隔离测试用途。", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "创建后立即启用" }).check();
    await page.getByRole("button", { name: "创建班级", exact: true }).click();
    await page.waitForURL((url) => /^\/zh\/dashboard\/classes\/[0-9a-f-]{36}$/.test(url.pathname), {
      waitUntil: "domcontentloaded",
    });

    const classId = page.url().match(/\/dashboard\/classes\/([0-9a-f-]{36})$/)?.[1];
    if (!classId) throw new Error("Created classroom URL did not contain a UUID");
    await fixture.disableLessonConsumptionForTestClass(classId);
    await expect(page.getByText(fixture.className, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("进行中", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("课次（1）", { exact: true })).toBeVisible();

    const sessionLink = page.locator('a[href*="/dashboard/sessions/"]').filter({ hasText: fixture.lectureName }).first();
    await expect(sessionLink).toBeVisible();
    const sessionHref = await sessionLink.getAttribute("href");
    const sessionId = sessionHref?.match(/\/dashboard\/sessions\/([0-9a-f-]{36})/)?.[1];
    if (!sessionId) throw new Error("Created session link did not contain a UUID");

    await page.locator(`a[href*="/dashboard/classes/${classId}?tab=students"]`).first().click();
    await page.waitForURL((url) => url.pathname === `/zh/dashboard/classes/${classId}` && url.searchParams.get("tab") === "students");
    await page.getByRole("button", { name: "报名", exact: true }).click();
    const enrollDialog = page.getByRole("dialog");
    await enrollDialog.getByPlaceholder("搜索学生姓名").fill(fixture.studentName);
    await expect(enrollDialog.getByText(fixture.studentName, { exact: true })).toBeVisible();
    await enrollDialog.getByRole("button", { name: "报名", exact: true }).click();
    await expect(page.getByText("已报名。", { exact: true })).toBeVisible();
    await expect(enrollDialog).toBeHidden();
    await expect(page.getByText("花名册（1）", { exact: true })).toBeVisible();
    await expect(page.getByText(fixture.studentName, { exact: true })).toBeVisible();

    await page.context().clearCookies();
    await loginWithFixedAccount(page, teacher, `/zh/classroom/${classId}/session/${sessionId}/live`);
    await page.getByRole("button", { name: "点名", exact: true }).click();
    const attendanceDialog = page.getByRole("dialog");
    await expect(attendanceDialog.getByText(fixture.studentName, { exact: true })).toBeVisible();
    await attendanceDialog.getByRole("button", { name: "迟到", exact: true }).click();
    const attendanceNote = "R1-Live 本机持久化复核";
    await attendanceDialog.getByPlaceholder("备注").fill(attendanceNote);
    await attendanceDialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(attendanceDialog).toBeHidden();
    await expect(page.getByText("考勤已保存。", { exact: true })).toBeVisible();
    await fixture.assertAttendancePersisted(sessionId, "late", attendanceNote);

    await page.goto(`/zh/dashboard/sessions/${sessionId}?stage=post`);
    await page.getByRole("button", { name: "补登记出勤", exact: true }).click();
    const rereadDialog = page.getByRole("dialog");
    await expect(rereadDialog.getByText(fixture.studentName, { exact: true })).toBeVisible();
    await expect(rereadDialog.getByText("已登记", { exact: true })).toBeVisible();
    await expect(rereadDialog.getByRole("button", { name: "迟到", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(rereadDialog.getByPlaceholder("备注")).toHaveValue(attendanceNote);
  } finally {
    await fixture.cleanup();
    activeFixture = null;
  }
});
