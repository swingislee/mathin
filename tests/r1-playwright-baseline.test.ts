import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadFixedAccountForMode,
  parseFixedAccountDocument,
} from "../e2e/support/fixed-accounts";
import { resolveE2ETarget, resolveLanTarget } from "../scripts/lib/r1-e2e-target-policy.mjs";
import { validateReleaseStats } from "../scripts/run-r1-playwright-release.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");
const suiteFiles = [
  "e2e/auth-boundaries.spec.ts",
  "e2e/school-portals.spec.ts",
  "e2e/notebook-public.spec.ts",
  "e2e/notebook-authenticated.spec.ts",
  "e2e/lan-smoke.spec.ts",
  "e2e/support/credential-test.ts",
  "e2e/support/fixed-accounts.ts",
  "e2e/support/login.ts",
] as const;
const environment = (values: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: "test",
  ...values,
});
const remoteAttestation: NodeJS.ProcessEnv = environment({
  MATHIN_E2E_BASE_URL: "https://rc.mathin.invalid",
  MATHIN_E2E_ALLOWED_ORIGIN: "https://rc.mathin.invalid",
  MATHIN_E2E_TARGET_FINGERPRINT: "a".repeat(64),
  MATHIN_E2E_FIXED_ACCOUNT_ENVIRONMENT: "release-candidate",
});

describe("R1-14 formal Playwright baseline", () => {
  it("keeps deterministic execution and permanently disables credentialed artifacts", () => {
    const config = read("playwright.config.ts");
    const credentialTest = read("e2e/support/credential-test.ts");
    expect(config).toContain("workers: 1");
    expect(config).toContain("credentialed-chromium");
    expect(config).toContain('trace: "off"');
    expect(config).toContain('screenshot: "off"');
    expect(config).toContain('video: "off"');
    expect(config).toContain("anonymous-chromium");
    expect(config).toContain('trace: "retain-on-failure"');
    expect(credentialTest).toContain('use[key] !== "off"');
    expect(read("e2e/school-portals.spec.ts")).toContain('from "./support/credential-test"');
    expect(read("e2e/notebook-authenticated.spec.ts")).toContain('from "./support/credential-test"');
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
    expect(suite).toContain("resolveLanTarget");
  });

  it("accepts loopback/RFC1918 defaults but rejects unattested or production remote targets", () => {
    expect(resolveE2ETarget(environment()).baseURL).toBe("http://127.0.0.1:3130");
    expect(resolveE2ETarget(environment({ MATHIN_E2E_BASE_URL: "http://192.168.5.213:3130" })).localNetwork).toBe(true);
    expect(() => resolveE2ETarget(environment({ MATHIN_E2E_BASE_URL: "https://rc.mathin.invalid" }))).toThrow(/ALLOWED_ORIGIN/);
    expect(() => resolveE2ETarget({
      ...remoteAttestation,
      MATHIN_E2E_ALLOWED_ORIGIN: "https://another.mathin.invalid",
    })).toThrow(/exactly equal/);
    expect(() => resolveE2ETarget({
      ...remoteAttestation,
      MATHIN_E2E_TARGET_FINGERPRINT: "A".repeat(64),
    })).toThrow(/lowercase 64-hex/);
    expect(() => resolveE2ETarget({
      ...remoteAttestation,
      MATHIN_E2E_FIXED_ACCOUNT_ENVIRONMENT: "production",
    })).toThrow(/non-production/);
    expect(() => resolveE2ETarget({
      ...remoteAttestation,
      MATHIN_E2E_BASE_URL: "https://mathin.club",
      MATHIN_E2E_ALLOWED_ORIGIN: "https://mathin.club",
    })).toThrow(/production hostname/);
    expect(() => resolveE2ETarget({
      ...remoteAttestation,
      MATHIN_E2E_BASE_URL: "https://mathin.club.",
      MATHIN_E2E_ALLOWED_ORIGIN: "https://mathin.club.",
    })).toThrow(/production hostname/);
    expect(resolveE2ETarget(remoteAttestation)).toMatchObject({
      baseURL: "https://rc.mathin.invalid",
      localNetwork: false,
    });
  });

  it("makes release target selection explicit and fails closed on missing LAN or account inputs", () => {
    const releaseEnvironment: NodeJS.ProcessEnv = {
      ...remoteAttestation,
      MATHIN_E2E_MODE: "release",
      MATHIN_E2E_NO_WEBSERVER: "1",
      MATHIN_E2E_LAN_BASE_URL: "http://192.168.5.213:3130",
    };
    expect(resolveE2ETarget(releaseEnvironment).releaseMode).toBe(true);
    expect(resolveLanTarget(releaseEnvironment)).toBe("http://192.168.5.213:3130");
    expect(() => resolveE2ETarget({ ...releaseEnvironment, MATHIN_E2E_NO_WEBSERVER: "0" })).toThrow(/NO_WEBSERVER/);
    expect(() => resolveLanTarget({ ...releaseEnvironment, MATHIN_E2E_LAN_BASE_URL: "" })).toThrow(/requires/);

    const missingAccountsRoot = path.join(root, ".missing-fixed-account-fixture");
    expect(loadFixedAccountForMode("teacher", { environment: environment(), cwd: missingAccountsRoot })).toBeNull();
    expect(() => loadFixedAccountForMode("teacher", {
      environment: environment({ MATHIN_E2E_MODE: "release" }),
      cwd: missingAccountsRoot,
    })).toThrow(/requires the fixed teacher account/);
  });

  it("requires the exact release inventory with no skipped or non-expected tests", () => {
    expect(validateReleaseStats({ expected: 9, skipped: 0, unexpected: 0, flaky: 0 }).passed).toBe(true);
    expect(validateReleaseStats({ expected: 8, skipped: 1, unexpected: 0, flaky: 0 }).passed).toBe(false);
    expect(validateReleaseStats({ expected: 8, skipped: 0, unexpected: 1, flaky: 0 }).passed).toBe(false);
    expect(read("docs/runbooks/r1-playwright-release.md")).toContain("不构成 R1-14 发布证据");
  });

  it("never creates accounts and only local diagnostic mode may skip missing fixed credentials", () => {
    const suite = suiteFiles.map(read).join("\n");
    expect(suite).not.toMatch(/\/signup|signUp\s*\(|auth\.admin|createUser\s*\(/i);
    expect(read("e2e/school-portals.spec.ts")).toContain("test.skip(!");
    expect(read("e2e/notebook-authenticated.spec.ts")).toContain("test.skip(!");
    expect(read("e2e/support/fixed-accounts.ts")).toContain("release mode requires");
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
