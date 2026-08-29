import { expect, test } from "@playwright/test";
import {
  FIXED_ACCOUNT_SKIP_REASON,
  loadFixedAccountForMode,
} from "./support/fixed-accounts";
import { setupClassroomContractFixture } from "./support/classroom-contract-fixture";
import { loginWithFixedAccount } from "./support/login";

const FIXTURE_FLAG_REASON = "set R1_DEV_TEST_FIXTURES=1 and use the local classroom contract runner";

test("one H5 capability contract covers mixed Mofaxiao and embedded Aixuexi pages", async ({ page }) => {
  const admin = loadFixedAccountForMode("admin");
  const teacher = loadFixedAccountForMode("teacher");
  test.skip(!admin || !teacher, FIXED_ACCOUNT_SKIP_REASON);
  test.skip(process.env.R1_DEV_TEST_FIXTURES !== "1", FIXTURE_FLAG_REASON);
  if (!admin || !teacher) return;

  const fixture = await setupClassroomContractFixture({ adminAccount: admin, teacher });
  try {
    await loginWithFixedAccount(page, teacher, fixture.classroomPath);

    // The ordinary formal route must expose the current Stage B layout. Rehearsal
    // fixtures remain useful for H5 simulation, but may not be the only path that
    // proves the development classroom baseline.
    await page.getByRole("button", { name: "开始上课", exact: true }).click();
    await expect(page.locator('[data-classroom-control-surface="flat-rail"]')).toBeVisible();
    await expect(page.locator("[data-classroom-course-info]")).toBeVisible();
    await expect(page.getByRole("switch", { name: "关闭 Smart", exact: true }))
      .toHaveAttribute("data-classroom-smart-input", "on");

    await page.goto(`${fixture.classroomPath}?mode=rehearsal&acceptance=m3b`);

    const dock = page.locator("[data-development-acceptance-dock]");
    const stage = page.locator("[data-classroom-stage]");
    const mainInput = stage.locator('[data-render-profile="classroom"]');
    await expect(dock).toBeVisible();
    await expect(page.getByText("H5 bridge v1 已就绪", { exact: true })).toBeVisible();
    await expect(stage).toHaveAttribute("data-classroom-renderer", "document:h5");

    const smartToggle = page.getByRole("switch", { name: "关闭 Smart", exact: true });
    await expect(smartToggle).toHaveAttribute("data-classroom-smart-input", "on");
    await expect(smartToggle).toHaveText("Smart");
    const smartToggleShape = await smartToggle.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return {
        borderRadius: styles.borderRadius,
        borderWidth: styles.borderTopWidth,
        height: rect.height,
        width: rect.width,
        svgCount: element.querySelectorAll("svg").length,
      };
    });
    expect(smartToggleShape).toEqual({
      borderRadius: "0px",
      borderWidth: "0px",
      height: 44,
      width: 112,
      svgCount: 1,
    });
    await smartToggle.click();
    await expect(mainInput).toHaveAttribute("data-input-mode", "ink-lock");
    await page.getByRole("switch", { name: "开启 Smart", exact: true }).click();
    await expect(mainInput).toHaveAttribute("data-input-mode", "smart");

    const dockToggle = dock.getByRole("button").first();
    await dockToggle.click();
    await page.getByText("魔法校混合页：页面点击 + H5", { exact: true }).click();
    await expect(page.getByText("页面内点击已触发", { exact: true })).toBeVisible();
    const mofaxiaoFrame = page.frameLocator('iframe[title="M3b H5 Pointer Bridge"]');
    await mofaxiaoFrame.getByRole("button", { name: /轻点计数/ }).click();
    await expect(mofaxiaoFrame.locator("#count")).toHaveText("1");

    await dockToggle.click();
    await page.getByRole("button", { name: "爱学习嵌入页", exact: true }).click();
    await expect(stage).toHaveAttribute("data-classroom-renderer", "document:aixuexi:h5");
    await expect(page.getByText("H5 bridge v1 已就绪", { exact: true })).toBeVisible();
    const aixuexiFrame = page.frameLocator('iframe[title="爱学习嵌入互动"]');
    await dockToggle.click();
    await aixuexiFrame.getByRole("button", { name: /轻点计数/ }).click();
    await expect(aixuexiFrame.locator("#count")).toHaveText("1");

    await dockToggle.click();
    await page.getByRole("button", { name: "未登记回退", exact: true }).click();
    await expect(stage).toHaveAttribute("data-classroom-renderer", "unsupported");
    await expect(page.getByText("H5 provider 不兼容", { exact: true })).toBeVisible();
    await dockToggle.click();
    await expect(page.getByRole("switch", { name: "当前页面不支持 Smart", exact: true })).toBeDisabled();
    await expect(mainInput).toHaveAttribute("data-input-mode", "ink-lock");
    await page.getByRole("button", { name: "选择", exact: true }).click();
    await expect(mainInput).toHaveAttribute("data-input-mode", "interaction-lock");
    await aixuexiFrame.getByRole("button", { name: /轻点计数/ }).click();
    await expect(aixuexiFrame.locator("#count")).toHaveText("1");
    await page.getByRole("button", { name: "主色", exact: true }).click();
    await expect(mainInput).toHaveAttribute("data-input-mode", "ink-lock");
  } finally {
    await fixture.cleanup();
  }
});

test("authored Sudoku fill and teaching highlights synchronize to the classroom display", async ({ page, context }) => {
  const admin = loadFixedAccountForMode("admin");
  const teacher = loadFixedAccountForMode("teacher");
  test.skip(!admin || !teacher, FIXED_ACCOUNT_SKIP_REASON);
  test.skip(process.env.R1_DEV_TEST_FIXTURES !== "1", FIXTURE_FLAG_REASON);
  if (!admin || !teacher) return;

  const fixture = await setupClassroomContractFixture({ adminAccount: admin, teacher });
  const fixtureQuery = "acceptance=interaction-sync";
  try {
    await loginWithFixedAccount(page, teacher, fixture.classroomPath);
    await page.goto(`${fixture.classroomPath}?${fixtureQuery}`);
    await page.getByRole("button", { name: "开始上课", exact: true }).click();

    const controllerStage = page.locator('[data-classroom-sync-protocol="game-mirror-v1"]');
    await expect(controllerStage).toHaveAttribute("data-classroom-sync-status", "synchronized");

    const display = await context.newPage();
    await display.goto(`${fixture.classroomPath}?role=display&${fixtureQuery}`);
    const displayStage = display.locator('[data-classroom-sync-protocol="game-mirror-v1"]');
    await expect(displayStage).toHaveAttribute("data-classroom-sync-status", "synchronized");

    await page.getByRole("button", { name: "选择数字 1", exact: true }).click();
    await page.locator('[data-coordinate="A1"]').click();
    await expect(display.locator('[data-coordinate="A1"]')).toHaveAttribute("data-digit", "1");

    await page.getByRole("button", { name: "突出行", exact: true }).click();
    await page.locator('[data-coordinate="B1"]').click();
    await expect(display.locator('[data-coordinate="B1"]'))
      .toHaveAttribute("data-teaching-highlight", "true");
    await expect(display.locator('[data-coordinate="B4"]'))
      .toHaveAttribute("data-teaching-highlight", "true");
    await display.close();
  } finally {
    await fixture.cleanup();
  }
});
