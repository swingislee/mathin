import { defineConfig, devices } from "@playwright/test";
import { resolveE2ETarget } from "./scripts/lib/r1-e2e-target-policy.mjs";

const target = resolveE2ETarget();
const manageWebServer = process.env.MATHIN_E2E_NO_WEBSERVER !== "1" && target.localNetwork && !target.releaseMode;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: target.baseURL,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: manageWebServer
    ? {
        command: "pnpm dev",
        url: `${target.baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,
  projects: [
    {
      name: "anonymous-chromium",
      testMatch: ["auth-boundaries.spec.ts", "lan-smoke.spec.ts", "notebook-public.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
      },
    },
    {
      name: "credentialed-chromium",
      testMatch: ["school-portals.spec.ts", "notebook-authenticated.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        trace: "off",
        screenshot: "off",
        video: "off",
      },
    },
    ...(target.releaseMode ? [] : [{
      name: "r1-live-local-chromium",
      testMatch: ["r1-live-golden-path.spec.ts", "teacher-microcourse.spec.ts", "organization-location-settings.spec.ts", "staff-self-role.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        trace: "off" as const,
        screenshot: "off" as const,
        video: "off" as const,
      },
    }, {
      name: "classroom-contract-local-chromium",
      testMatch: ["classroom-h5-input-contract.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        trace: "retain-on-failure" as const,
        screenshot: "only-on-failure" as const,
        video: "off" as const,
      },
    }]),
  ],
});
