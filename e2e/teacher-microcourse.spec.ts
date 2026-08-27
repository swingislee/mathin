import { expect, test } from "./support/credential-test";
import { FIXED_ACCOUNT_SKIP_REASON, loadFixedAccountForMode } from "./support/fixed-accounts";
import { loginWithFixedAccount } from "./support/login";
import {
  setupTeacherMicrocourseFixture,
  type TeacherMicrocourseFixture,
} from "./support/teacher-microcourse-fixture";

const FIXTURE_FLAG_REASON = "set R1_DEV_TEST_FIXTURES=1 and use the local teacher microcourse runner";
const UNIQUE_SIX_BY_SIX = [
  1, 2, 3, 4, 5, 6,
  4, 5, 6, 1, 2, 3,
  2, 3, 4, 5, 6, 1,
  5, 6, 1, 2, 3, 4,
  3, 4, 5, 6, 1, 2,
  6, 1, 2, 3, 4, 0,
];

let activeFixture: TeacherMicrocourseFixture | null = null;

test.afterEach(async () => {
  if (!activeFixture) return;
  await activeFixture.cleanup();
  activeFixture = null;
});

test("teacher authors, teaches, resubmits, publishes, and the catalog creates one session", async ({ page }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  const admin = loadFixedAccountForMode("admin");
  const principal = loadFixedAccountForMode("principal");
  const research = loadFixedAccountForMode("research");
  const teacher = loadFixedAccountForMode("teacher");
  test.skip(!admin || !principal || !research || !teacher, FIXED_ACCOUNT_SKIP_REASON);
  test.skip(process.env.R1_DEV_TEST_FIXTURES !== "1", FIXTURE_FLAG_REASON);
  if (!admin || !principal || !research || !teacher) return;

  const fixture = await setupTeacherMicrocourseFixture({ adminAccount: admin, principal, teacher });
  activeFixture = fixture;
  try {
    const editorPath = `/zh/dashboard/sessions/${fixture.sourceSessionId}/microcourse` as const;
    await loginWithFixedAccount(page, teacher, editorPath);
    await expect(page.getByText("把这节自由课孵化成微课", { exact: true })).toBeVisible();
    await page.getByLabel("微课标题", { exact: true }).fill(fixture.microcourseTitle);
    await page.getByLabel("简介", { exact: true }).fill("固定来源页、数独、图文叠加和离线 H5 的校内审核旅程。");
    await page.getByRole("button", { name: "创建微课草稿", exact: true }).click();
    await expect(page.getByText("微课编辑", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "从课程插入整讲", exact: true }).click();
    const sourceDialog = page.getByRole("dialog");
    await sourceDialog.getByRole("button", { name: "搜索并选择课程版本", exact: true }).click();
    await page.getByPlaceholder("搜索课程、讲次、发布老师、主题或关键词").fill(fixture.sourceCourseTitle);
    const sourceCourse = page.getByRole("option").filter({ hasText: fixture.sourceCourseTitle });
    await expect(sourceCourse).toBeVisible();
    await sourceCourse.click();
    const sourceOption = sourceDialog.getByRole("button", { name: `选择课次 ${fixture.sourceLectureTitle}`, exact: true });
    await expect(sourceOption).toBeVisible();
    await expect(sourceOption).toContainText("本讲共 2 页");
    await sourceOption.click();
    await expect(sourceOption).toHaveAttribute("aria-pressed", "true");
    await sourceDialog.getByRole("button", { name: "插入本讲 2 页", exact: true }).click();
    await expect(sourceDialog).toBeHidden();
    await expect(page.getByText(fixture.nativePageTitle, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(fixture.aixuexiPageTitle, { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "空白/图文", exact: true }).click();
    await expect(page.getByText("新页面", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "文字", exact: true }).click();
    const overlayText = "教师自建图文叠加层：\n3 × 4 = 12";
    await page.getByTestId("microcourse-overlay-text").fill(overlayText);
    await expect(page.getByTestId("microcourse-autosave-status")).toHaveText("等待自动保存");

    await page.getByRole("button", { name: "游戏", exact: true }).click();
    const gameDialog = page.getByRole("dialog");
    await expect(gameDialog.getByRole("heading", { name: "新建游戏页", exact: true })).toBeVisible();
    await gameDialog.getByRole("button", { name: "数独", exact: true }).click();
    await gameDialog.getByRole("button", { name: "创建", exact: true }).click();
    await expect(gameDialog).toBeHidden();
    await page.getByRole("radio", { name: "六宫", exact: true }).click();
    await expect(page.getByTestId("sudoku-authoring-grid")).toHaveAttribute("data-sudoku-variant", "classic-6x6");
    for (let index = 0; index < UNIQUE_SIX_BY_SIX.length; index += 1) {
      const digit = UNIQUE_SIX_BY_SIX[index];
      if (digit !== 0) await page.getByLabel(`数独第 ${index + 1} 格`, { exact: true }).fill(String(digit));
    }
    await expect(page.getByText("唯一解校验通过，可以提交审核。", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "H5", exact: true }).click();
    const h5Dialog = page.getByRole("dialog");
    await expect(h5Dialog.getByRole("heading", { name: "新建单文件 H5", exact: true })).toBeVisible();
    await h5Dialog.getByRole("button", { name: "创建", exact: true }).click();
    await expect(h5Dialog).toBeHidden();
    const previewFrame = page.locator('iframe[title="H5 实时预览"]');
    await expect(previewFrame).toBeVisible();
    await expect(previewFrame).toHaveAttribute("sandbox", "allow-scripts");
    const h5Html = "<!doctype html><html><body><h1>H5 自动保存</h1></body></html>";
    const htmlEditor = page.getByLabel("HTML", { exact: true });
    await expect(htmlEditor).toBeEnabled();
    await htmlEditor.fill(h5Html);
    await expect(page.getByTestId("microcourse-autosave-status")).toHaveText("等待自动保存");
    await expect(page.getByTestId("microcourse-autosave-status")).toHaveText("已自动保存", { timeout: 30_000 });

    await page.getByRole("button", { name: /新页面.*图文\/组合页/ }).click();
    await expect(page.getByTestId("microcourse-overlay-text")).toHaveValue(overlayText);
    await page.getByRole("button", { name: /数独.*游戏页/ }).click();
    await expect(page.getByTestId("sudoku-authoring-grid")).toHaveAttribute("data-sudoku-variant", "classic-6x6");
    await expect(page.getByLabel("数独第 1 格", { exact: true })).toHaveValue("1");

    await page.getByRole("button", { name: "冻结并上课", exact: true }).click();
    await page.waitForURL((url) => url.pathname === `/zh/classroom/${fixture.sourceClassroomId}/session/${fixture.sourceSessionId}/live`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator('[data-microcourse-mode="composition"]').first()).toBeVisible();

    await page.goto(editorPath);
    await expect(page.getByRole("button", { name: "进入课堂", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "编辑微课信息", exact: true }).click();
    await page.getByLabel("提交/审核说明", { exact: true }).fill("首轮提交：请检查来源快照和课堂交互。");
    await page.getByRole("button", { name: "提交审核", exact: true }).click();
    await expect(page.getByText("已冻结当前内容并提交教研审核。", { exact: true })).toBeVisible();

    await page.context().clearCookies();
    await loginWithFixedAccount(page, research, "/zh/dashboard/courseware/review");
    await page.goto("/zh/dashboard/courseware/review?tab=microcourses");
    await expect(page.getByText(fixture.microcourseTitle, { exact: true }).first()).toBeVisible();
    await page.getByRole("link", { name: "打开审核", exact: true }).first().click();
    await expect(page.getByText(fixture.microcourseTitle, { exact: true })).toBeVisible();
    await page.getByLabel("提交/审核说明", { exact: true }).fill("请补充重提说明后再次提交。");
    await page.getByRole("button", { name: "退回修改", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/zh/dashboard/courseware/review" && url.searchParams.get("tab") === "microcourses");

    await page.context().clearCookies();
    await loginWithFixedAccount(page, teacher, editorPath);
    await expect(page.getByText("待修改", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "编辑微课信息", exact: true }).click();
    await page.getByLabel("提交/审核说明", { exact: true }).fill("已根据首轮意见复核并重提。");
    await page.getByRole("button", { name: "提交审核", exact: true }).click();
    await expect(page.getByText("已冻结当前内容并提交教研审核。", { exact: true })).toBeVisible();

    await page.context().clearCookies();
    await loginWithFixedAccount(page, research, "/en/dashboard/courseware/review");
    await page.goto("/en/dashboard/courseware/review?tab=microcourses");
    await expect(page.getByText(fixture.microcourseTitle, { exact: true }).first()).toBeVisible();
    await page.getByRole("link", { name: "Open review", exact: true }).first().click();
    for (let round = 0; round < 3; round += 1) {
      const publish = page.getByRole("button", { name: "Approve and publish", exact: true });
      await expect(publish).toBeEnabled();
      const reviewUrl = page.url();
      await publish.click({ noWaitAfter: true });
      await page.waitForURL((url) => url.href !== reviewUrl);
      if (new URL(page.url()).pathname === "/en/dashboard/courseware/review") break;
    }
    await page.waitForURL((url) => url.pathname === "/en/dashboard/courseware/review" && url.searchParams.get("tab") === "microcourses");

    await page.context().clearCookies();
    await loginWithFixedAccount(page, principal, "/zh/dashboard/classes/new");
    await page.getByRole("button", { name: "正式班", exact: true }).click();
    await page.getByRole("button", { name: "搜索并选择课程版本", exact: true }).click();
    await page.getByRole("combobox", { name: "搜索课程、讲次、发布老师、主题或关键词", exact: true }).fill(fixture.microcourseTitle);
    const courseOption = page.getByRole("option").filter({ hasText: fixture.microcourseTitle });
    await expect(courseOption).toHaveCount(1);
    await expect(courseOption).toContainText("教师微课");
    await courseOption.click();
    await expect(page.getByText("已准备", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await expect(page.getByRole("heading", { name: "班级信息", exact: true })).toBeVisible();
    await page.getByLabel("班级名", { exact: true }).fill(fixture.catalogClassName);
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    const staffSelectors = page.getByRole("combobox");
    await staffSelectors.first().click();
    await page.getByRole("option", { name: fixture.teacherDisplayName, exact: true }).click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: fixture.termName.replace(" 学年", ""), exact: false }).click();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][tomorrow.getDay()];
    await page.getByRole("button", { name: weekday, exact: true }).click();
    await expect(page.getByText(fixture.microcourseTitle, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("button", { name: "创建班级", exact: true }).click();
    await page.waitForURL((url) => /^\/zh\/dashboard\/classes\/[0-9a-f-]{36}$/.test(url.pathname), {
      waitUntil: "domcontentloaded",
    });
    const catalogClassroomId = page.url().match(/\/dashboard\/classes\/([0-9a-f-]{36})$/)?.[1];
    if (!catalogClassroomId) throw new Error("Catalog-created classroom URL did not contain a UUID");
    fixture.registerCatalogClassroom(catalogClassroomId);
    await expect(page.getByText("课次（1）", { exact: true })).toBeVisible();
    await fixture.assertPublishedCatalogClass();

    await page.context().clearCookies();
    await loginWithFixedAccount(page, teacher, `/en/dashboard/sessions/${fixture.sourceSessionId}/microcourse`);
    await expect(page.getByText("Microcourse editor", { exact: true })).toBeVisible();
    await expect(page.getByText("Published", { exact: true })).toBeVisible();
  } finally {
    await fixture.cleanup();
    activeFixture = null;
  }
});
