import { expect, test } from "@playwright/test";

test("LAN browser reaches the anonymous protected-route boundary", async ({ page }) => {
  const lanBaseURL = process.env.MATHIN_E2E_LAN_BASE_URL?.replace(/\/$/, "");
  test.skip(!lanBaseURL, "MATHIN_E2E_LAN_BASE_URL is unset; LAN secure-context verification is explicit opt-in");
  if (!lanBaseURL) return;

  const health = await page.request.get(`${lanBaseURL}/api/health`);
  expect(health.ok()).toBe(true);

  await page.goto(`${lanBaseURL}/zh/notebook/me`);
  await expect(page).toHaveURL((url) =>
    url.origin === lanBaseURL &&
    url.pathname === "/zh/login" &&
    url.searchParams.get("next") === "/zh/notebook/me");
});
