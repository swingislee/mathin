import { test as base, expect } from "@playwright/test";

export const test = base;

test.beforeEach(({}, testInfo) => {
  const use = testInfo.project.use;
  for (const key of ["trace", "screenshot", "video"] as const) {
    if (use[key] !== "off") {
      throw new Error(`credentialed E2E refuses to run unless ${key}=off`);
    }
  }
});

export { expect };
