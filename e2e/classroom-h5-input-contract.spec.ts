import { expect, test } from "@playwright/test";
import {
  FIXED_ACCOUNT_SKIP_REASON,
  loadFixedAccountForMode,
} from "./support/fixed-accounts";
import { loginWithFixedAccount } from "./support/login";

const CLASSROOM_PATH = "/zh/classroom/03c61c75-b2ee-4e2a-907d-50df45052790/session/d4377e50-271a-42b9-9e86-b8aaa9cae67e/live";

test("one H5 capability contract covers mixed Mofaxiao and embedded Aixuexi pages", async ({ page }) => {
  const teacher = loadFixedAccountForMode("teacher");
  test.skip(!teacher, FIXED_ACCOUNT_SKIP_REASON);
  if (!teacher) return;

  await loginWithFixedAccount(page, teacher, CLASSROOM_PATH);
  await page.goto(`${CLASSROOM_PATH}?mode=rehearsal&acceptance=m3b`);

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
    return {
      height: rect.height,
      width: rect.width,
      svgCount: element.querySelectorAll("svg").length,
    };
  });
  expect(smartToggleShape).toEqual({ height: 44, width: 112, svgCount: 0 });
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
});
