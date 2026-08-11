import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFixedAccountDocument } from "../e2e/support/fixed-accounts";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");
const suiteFiles = [
  "e2e/auth-boundaries.spec.ts",
  "e2e/school-portals.spec.ts",
  "e2e/notebook.spec.ts",
  "e2e/lan-smoke.spec.ts",
  "e2e/support/fixed-accounts.ts",
  "e2e/support/login.ts",
] as const;

describe("R1-14 formal Playwright baseline", () => {
  it("keeps deterministic single-worker browser and failure-artifact settings", () => {
    const config = read("playwright.config.ts");
    expect(config).toContain("workers: 1");
    expect(config).toContain('reuseExistingServer: !process.env.CI');
    expect(config).toContain('trace: "retain-on-failure"');
    expect(config).toContain('screenshot: "only-on-failure"');
    expect(config).toContain('video: "retain-on-failure"');
  });

  it("covers auth, three school environments, Notebook, denial, and LAN boundaries", () => {
    const suite = suiteFiles.map(read).join("\n");
    for (const route of [
      "/zh/login",
      "/zh/dashboard/learning/classes",
      "/zh/dashboard/children",
      "/zh/dashboard/classes",
      "/zh/dashboard/system-health",
      "/zh/notebook",
      "/zh/notebook/me",
    ]) {
      expect(suite).toContain(route);
    }
    expect(suite).toContain("MATHIN_E2E_LAN_BASE_URL");
  });

  it("never creates accounts and explicitly skips unavailable fixed credentials", () => {
    const suite = suiteFiles.map(read).join("\n");
    expect(suite).not.toMatch(/\/signup|signUp\s*\(|auth\.admin|createUser\s*\(/i);
    expect(read("e2e/school-portals.spec.ts")).toContain("test.skip(!");
    expect(read("e2e/notebook.spec.ts")).toContain("test.skip(!");
    expect(read("e2e/support/fixed-accounts.ts")).toContain(".claude");
  });

  it("parses only the canonical fixed roles and ignores similarly named fixture roles", () => {
    const document = parseFixedAccountDocument(`
**统一密码：\`not-a-real-secret\`**

| 角色 | 邮箱 | 备注 |
| --- | --- | --- |
| 管理员 admin | admin@example.invalid | canonical |
| 教师 staff/teacher | teacher@example.invalid | canonical |
| 学生 student | student@example.invalid | canonical |
| 学生2 student | second@example.invalid | ignored |
| 家长 parent | parent@example.invalid | canonical |
| 未绑定家长 parent | unbound@example.invalid | ignored |
`);

    expect(document).toEqual({
      password: "not-a-real-secret",
      emails: {
        admin: "admin@example.invalid",
        teacher: "teacher@example.invalid",
        student: "student@example.invalid",
        parent: "parent@example.invalid",
      },
    });
  });
});
