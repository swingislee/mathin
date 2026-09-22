import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  forbiddenTrackedPath,
  placeholder,
  scanRepository,
  scanText,
} from "../scripts/check-repository-secrets.mjs";
import { pushedObjectIds, scanGitHistory } from "../scripts/check-repository-secret-history.mjs";
import { scanStagedSecrets } from "../scripts/check-staged-secrets.mjs";

function jwt(payload: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.${"a".repeat(32)}`;
}

function withTemporaryDirectory(callback: (directory: string) => void) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "mathin-secret-scan-"));
  try {
    callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("R1 repository secret scan", () => {
  it("accepts only full-value placeholders, local disposable credentials, and public JWTs", () => {
    for (const value of [
      "replace-with-your-secret-key",
      "<由受控密钥库注入>",
      "not-a-secret",
      "ci-placeholder-publishable-key",
    ]) {
      expect(placeholder(value)).toBe(true);
    }
    for (const value of [
      "prefix-replace-with-secret",
      "actual-example-token-material",
      "real-changeme-token-material",
      "production-placeholder-token-material",
      "${RUNTIME_SECRET}",
      "process.env.RUNTIME_SECRET",
    ]) {
      expect(placeholder(value)).toBe(false);
    }

    const text = [
      "SUPABASE_SECRET_KEY=replace-with-your-secret-key",
      "RUNTIME_SECRET=${RUNTIME_SECRET}",
      "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      "EXAMPLE_TEST_URL=postgresql://user:password@db.example.test/example",
      "EXAMPLE_URL=postgresql://user:password@docs.invalid/example",
      jwt({ role: "anon", ref: "public-example" }),
    ].join("\n");
    expect(scanText(".env.example", text)).toEqual([]);
  });

  it("does not let example, changeme, or placeholder substrings suppress literal assignments", () => {
    const text = [
      "SERVICE_TOKEN=actual-example-token-material",
      "DEPLOY_SECRET=real-changeme-token-material",
      "API_KEY=production-placeholder-token-material",
    ].join("\n");
    expect(scanText("fixture.env", text).map((finding) => finding.rule)).toEqual([
      "literal-secret-assignment",
      "literal-secret-assignment",
      "literal-secret-assignment",
    ]);
  });

  it("detects high-confidence provider tokens without returning their values", () => {
    const secret = `${"gh"}p_${crypto.randomBytes(24).toString("hex")}`;
    const findings = scanText("fixture.txt", `TOKEN=${secret}`);
    expect(findings.map((finding) => finding.rule)).toEqual(["github-token", "literal-secret-assignment"]);
    expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it("detects literal WeChat AppSecret values without printing them", () => {
    const secret = crypto.randomBytes(16).toString("hex");
    for (const name of ["appSecret", "app_secret", "WECHAT_APP_SECRET", "WX_APPSECRET"]) {
      const findings = scanText("project.json", JSON.stringify({ [name]: secret }));
      expect(findings.map((finding) => finding.rule)).toEqual(["wechat-app-secret"]);
      expect(JSON.stringify(findings)).not.toContain(secret);
    }
    expect(scanText("server.ts", "const appSecret = process.env.WECHAT_APP_SECRET;")).toEqual([]);
  });

  it("keeps WeChat application identifiers private in any file or prose", () => {
    const appid = "wx" + crypto.randomBytes(8).toString("hex");
    for (const filePath of ["project.json", "scripts/connect.mjs", "docs/incident.md"]) {
      const findings = scanText(filePath, `Application: ${appid}`);
      expect(findings.map((finding) => finding.rule)).toEqual(["wechat-app-id"]);
      expect(JSON.stringify(findings)).not.toContain(appid);
    }
    expect(scanText("project.json", JSON.stringify({ appid: "touristappid" }))).toEqual([]);
    expect(scanText("config.ts", "const appid = process.env.WECHAT_APP_ID;")).toEqual([]);
  });

  it("detects private keys, remote credential URLs, literal assignments, and service-role JWTs", () => {
    const serviceRole = jwt({ role: "service_role", ref: "private-project" });
    const text = [
      `-----BEGIN ${"PRIVATE"} KEY-----`,
      ["postgresql://app", "actual-password@db.example.com/mathin"].join(":"),
      ["MATHIN_ERROR_REPORT_TOKEN", "live-token-material-123456"].join("="),
      serviceRole,
    ].join("\n");
    expect(scanText("leak.txt", text).map((finding) => finding.rule)).toEqual([
      "private-key",
      "credential-url",
      "supabase-service-role-jwt",
      "literal-secret-assignment",
    ]);
  });

  it("detects embedded connection credentials and script assignments without printing values", () => {
    const secret = crypto.randomBytes(20).toString("hex");
    const cases = [
      [`https://person:${secret}@api.example.com/`, "credential-url"],
      [`https://api.example.com/?access_token=${secret}`, "credential-url-query"],
      [`Authorization: Bearer ${secret}`, "literal-bearer-credential"],
      [`const password = '${secret}';`, "literal-script-credential"],
      [`$apiKey = '${secret}'`, "literal-script-credential"],
      [JSON.stringify({ accessToken: secret }), "literal-script-credential"],
    ];
    for (const [text, rule] of cases) {
      const findings = scanText("scripts/connect.mjs", text);
      expect(findings.map((finding) => finding.rule)).toContain(rule);
      expect(JSON.stringify(findings)).not.toContain(secret);
    }
    expect(scanText("scripts/connect.mjs", "const password = process.env.PASSWORD; const token = 'replace-with-api-token';")).toEqual([]);
  });

  it("scans staged blobs even when the working copy has already removed a credential", () => {
    withTemporaryDirectory((directory) => {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: directory });
      git("init", "--quiet");
      const secret = `${"gh"}p_${crypto.randomBytes(24).toString("hex")}`;
      writeFileSync(path.join(directory, "connect.mjs"), `const token = '${secret}';\n`);
      git("add", "connect.mjs");
      writeFileSync(path.join(directory, "connect.mjs"), "const token = process.env.API_TOKEN;\n");
      const result = scanStagedSecrets(directory);
      expect(result.findings.map((finding) => finding.rule)).toContain("github-token");
      expect(JSON.stringify(result)).not.toContain(secret);
      git("add", "connect.mjs");
      expect(scanStagedSecrets(directory).findings).toEqual([]);
    });
  });

  it("blocks forced private files and real application IDs in staged public configuration", () => {
    withTemporaryDirectory((directory) => {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: directory });
      git("init", "--quiet");
      const app = path.join(directory, "apps", "parent-wechat");
      mkdirSync(app, { recursive: true });
      mkdirSync(path.join(directory, ".tmp"));
      writeFileSync(path.join(directory, ".gitignore"), ".tmp/\n**/project.private.config.json\n");
      const appid = "wx" + crypto.randomBytes(8).toString("hex");
      writeFileSync(path.join(app, "project.config.json"), JSON.stringify({ appid }));
      writeFileSync(path.join(app, "project.private.config.json"), JSON.stringify({ appid }));
      writeFileSync(path.join(directory, ".tmp", "connect.mjs"), "// private investigation\n");
      git("add", "-f", "apps/parent-wechat/project.config.json", "apps/parent-wechat/project.private.config.json", ".tmp/connect.mjs");
      const result = scanStagedSecrets(directory);
      expect(result.findings.filter((finding) => finding.rule === "forbidden-private-file")).toHaveLength(2);
      expect(result.findings.map((finding) => finding.rule)).toContain("wechat-appid-requires-private-config");
      expect(JSON.stringify(result)).not.toContain(appid);
    });
  });

  it("ASCII-scans binary files and redacts detected values", () => {
    withTemporaryDirectory((directory) => {
      const secret = `${"gh"}p_${crypto.randomBytes(24).toString("hex")}`;
      writeFileSync(path.join(directory, "fixture.bin"), Buffer.concat([
        Buffer.from([0, 1, 2]),
        Buffer.from(`TOKEN=${secret}`, "ascii"),
        Buffer.from([0, 255]),
      ]));
      const result = scanRepository(directory, ["fixture.bin"]);
      expect(result.binaryFileCount).toBe(1);
      expect(result.findings.map((finding) => finding.rule)).toContain("github-token");
      expect(JSON.stringify(result.findings)).not.toContain(secret);
    });
  });

  it("rejects tracked environment, private-key, archive, and credential-container paths", () => {
    expect(forbiddenTrackedPath(".env.local")).toBe(true);
    expect(forbiddenTrackedPath("config/production.env")).toBe(true);
    expect(forbiddenTrackedPath("secrets/recovery.p12")).toBe(true);
    expect(forbiddenTrackedPath("exports/credentials.zip")).toBe(true);
    expect(forbiddenTrackedPath("vault/team.kdbx")).toBe(true);
    expect(forbiddenTrackedPath(".env.example")).toBe(false);
    for (const name of [".tmp/connect.mjs", "apps/parent-wechat/project.private.config.json", "config.local.ts", "capture.har", "storage-state.json", "cookies.json"]) {
      expect(forbiddenTrackedPath(name)).toBe(true);
    }
  });

  it("finds a secret removed from HEAD by scanning reachable Git blobs without echoing it", () => {
    withTemporaryDirectory((directory) => {
      execFileSync("git", ["init", "--quiet"], { cwd: directory });
      execFileSync("git", ["config", "user.name", "Mathin Test"], { cwd: directory });
      execFileSync("git", ["config", "user.email", "test@mathin.invalid"], { cwd: directory });
      const secret = `${"gh"}p_${crypto.randomBytes(24).toString("hex")}`;
      writeFileSync(path.join(directory, "config.txt"), `TOKEN=${secret}\n`, "utf8");
      execFileSync("git", ["add", "config.txt"], { cwd: directory });
      execFileSync("git", ["commit", "--quiet", "-m", "fixture with removed value"], { cwd: directory });
      writeFileSync(path.join(directory, "config.txt"), "TOKEN=replace-with-runtime-token\n", "utf8");
      execFileSync("git", ["commit", "--quiet", "-am", "remove fixture value"], { cwd: directory });

      const result = scanGitHistory(directory);
      expect(result.findings.map((finding) => finding.rule)).toContain("github-token");
      expect(JSON.stringify(result.findings)).not.toContain(secret);
    });
  });

  it("rejects old AppID history even after the current file is replaced", () => {
    withTemporaryDirectory((directory) => {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: directory });
      git("init", "--quiet");
      git("config", "user.name", "Mathin Test");
      git("config", "user.email", "test@mathin.invalid");
      const appid = "wx" + crypto.randomBytes(8).toString("hex");
      writeFileSync(path.join(directory, "config.json"), JSON.stringify({ appid }));
      git("add", "config.json");
      git("commit", "--quiet", "-m", "historical application configuration");
      writeFileSync(path.join(directory, "config.json"), JSON.stringify({ appid: "touristappid" }));
      git("commit", "--quiet", "-am", "use private configuration");
      expect(scanRepository(directory).findings).toEqual([]);
      const result = scanGitHistory(directory);
      expect(result.findings.map((finding) => finding.rule)).toContain("wechat-app-id");
      expect(JSON.stringify(result)).not.toContain(appid);
    });
  });

  it("also checks commit and annotated tag messages without echoing their values", () => {
    withTemporaryDirectory((directory) => {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: directory });
      git("init", "--quiet");
      git("config", "user.name", "Mathin Test");
      git("config", "user.email", "test@mathin.invalid");
      const appid = "wx" + crypto.randomBytes(8).toString("hex");
      git("commit", "--quiet", "--allow-empty", "-m", `Application ${appid}`);
      git("tag", "-a", "fixture", "-m", `Application ${appid}`);
      const result = scanGitHistory(directory);
      expect(result.blobCount).toBe(0);
      expect(result.metadataCount).toBe(2);
      expect(result.findings.map((finding) => finding.rule)).toEqual(["wechat-app-id", "wechat-app-id"]);
      expect(JSON.stringify(result)).not.toContain(appid);
    });
  });

  it("keeps full Git history available to CI and runs both redacted scan modes", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("pnpm secrets:check");
    expect(workflow).toContain("pnpm secrets:history");
    expect(readFileSync(path.join(process.cwd(), ".githooks", "pre-push"), "utf8")).toContain("--pre-push");
  });

  it("checks an explicitly pushed old SHA even when no branch points to it", () => {
    withTemporaryDirectory((directory) => {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: directory });
      git("init", "--quiet");
      git("config", "user.name", "Mathin Test");
      git("config", "user.email", "test@mathin.invalid");
      const appid = "wx" + crypto.randomBytes(8).toString("hex");
      git("commit", "--quiet", "--allow-empty", "-m", `Application ${appid}`);
      const old = git("rev-parse", "HEAD").toString().trim();
      git("commit", "--quiet", "--allow-empty", "--amend", "-m", "clean replacement");
      expect(scanGitHistory(directory).findings).toEqual([]);
      const refs = pushedObjectIds(`${old} ${old} refs/heads/restored ${"0".repeat(40)}\n`);
      expect(refs).toEqual([old]);
      const result = scanGitHistory(directory, refs);
      expect(result.findings.map((finding) => finding.rule)).toContain("wechat-app-id");
      expect(JSON.stringify(result)).not.toContain(appid);
      expect(pushedObjectIds(`(delete) ${"0".repeat(40)} refs/heads/old ${old}\n`)).toEqual([]);
      expect(() => pushedObjectIds("malformed input")).toThrow("Invalid pre-push");
      expect(() => scanGitHistory(directory, ["--all"])).toThrow("full object IDs");
    });
  });

  it("finds no high-confidence secret in the tracked repository", () => {
    expect(scanRepository(process.cwd()).findings).toEqual([]);
    expect(scanRepository(process.cwd(), [
      "scripts/check-repository-secrets.mjs",
      "tests/r1-repository-secrets.test.ts",
    ]).findings).toEqual([]);
  });
});
