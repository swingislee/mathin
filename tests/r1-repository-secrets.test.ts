import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  forbiddenTrackedPath,
  placeholder,
  scanRepository,
  scanText,
} from "../scripts/check-repository-secrets.mjs";
import { scanGitHistory } from "../scripts/check-repository-secret-history.mjs";

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

  it("keeps full Git history available to CI and runs both redacted scan modes", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("pnpm secrets:check");
    expect(workflow).toContain("pnpm secrets:history");
  });

  it("finds no high-confidence secret in the tracked repository", () => {
    expect(scanRepository(process.cwd()).findings).toEqual([]);
    expect(scanRepository(process.cwd(), [
      "scripts/check-repository-secrets.mjs",
      "tests/r1-repository-secrets.test.ts",
    ]).findings).toEqual([]);
  });
});
