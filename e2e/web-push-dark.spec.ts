import { expect, test } from "./support/credential-test";
import { FIXED_ACCOUNT_SKIP_REASON, loadFixedAccountForMode } from "./support/fixed-accounts";
import { loginWithFixedAccount } from "./support/login";

test.describe("employee Web Push dark runtime", () => {
  test("staff sees the closed channel without a permission prompt or service-worker registration", async ({ page, request }) => {
    const principal = loadFixedAccountForMode("principal");
    test.skip(!principal, FIXED_ACCOUNT_SKIP_REASON);
    if (!principal) return;

    await page.addInitScript(() => {
      const originalRequestPermission = Notification.requestPermission.bind(Notification);
      let permissionRequestCount = 0;
      Notification.requestPermission = (deprecatedCallback?: NotificationPermissionCallback) => {
        permissionRequestCount += 1;
        return originalRequestPermission(deprecatedCallback);
      };
      Object.defineProperty(window, "__mathinNotificationPermissionRequestCount", {
        configurable: true,
        get: () => permissionRequestCount,
      });
    });
    await loginWithFixedAccount(page, principal, "/zh/dashboard/account-security");
    await expect(page.getByRole("heading", { name: "桌面提醒", exact: true })).toBeVisible();
    await expect(page.getByText("浏览器或 Windows 已关闭通知，请在系统设置中允许后再试。", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "在这台电脑开启", exact: true })).toBeDisabled();

    const browserState = await page.evaluate(async () => ({
      permission: Notification.permission,
      permissionRequestCount: (window as Window & { __mathinNotificationPermissionRequestCount?: number })
        .__mathinNotificationPermissionRequestCount ?? -1,
      registrationCount: (await navigator.serviceWorker.getRegistrations()).length,
    }));
    expect(browserState.permission).not.toBe("granted");
    expect(browserState.permissionRequestCount).toBe(0);
    expect(browserState.registrationCount).toBe(0);

    const workerResponse = await request.get("/notification-sw.js");
    expect(workerResponse.ok()).toBe(true);
    const workerSource = await workerResponse.text();
    expect(workerSource).toContain('self.addEventListener("push"');
    expect(workerSource).not.toContain('self.addEventListener("fetch"');

    await page.goto("/en/dashboard/account-security");
    await expect(page.getByRole("heading", { name: "Desktop notifications", exact: true })).toBeVisible();
    await expect(page.getByText("Notifications are blocked by the browser or Windows. Allow them in system settings and try again.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enable on this computer", exact: true })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => (
      window as Window & { __mathinNotificationPermissionRequestCount?: number }
    ).__mathinNotificationPermissionRequestCount ?? -1)).toBe(0);
  });

  test("administrator sees zeroed Web Push monitoring and the disabled integration", async ({ page }) => {
    const admin = loadFixedAccountForMode("admin");
    test.skip(!admin, FIXED_ACCOUNT_SKIP_REASON);
    if (!admin) return;

    await loginWithFixedAccount(page, admin, "/zh/dashboard/system-health");
    await expect(page.getByText("Web Push Worker 异常").locator("xpath=following-sibling::*[1]")).toHaveText("0");
    const webPush = page.getByRole("heading", { name: "桌面 Web Push", exact: true })
      .locator("xpath=ancestor::*[.//dt][1]");
    await expect(webPush.getByText("开关关闭", { exact: true })).toBeVisible();
    await expect(webPush.getByText("Rollout 员工", { exact: true })).toBeVisible();
    await expect(webPush.getByText("有效设备", { exact: true })).toBeVisible();
    await expect(webPush.getByText("排队投递", { exact: true })).toBeVisible();
    await expect(webPush.locator("dd")).toHaveText(["0", "0", "0", "0", "0", "0", "0", "0"]);

    const integration = page.locator("li").filter({ hasText: "桌面 Web Push" });
    await expect(integration.getByText("已关闭", { exact: true })).toBeVisible();
  });
});
