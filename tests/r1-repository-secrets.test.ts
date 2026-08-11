import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  forbiddenTrackedPath,
  scanRepository,
  scanText,
} from "../scripts/check-repository-secrets.mjs";

function jwt(payload: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.${"a".repeat(32)}`;
}

describe("R1 repository secret scan", () => {
  it("accepts placeholders, local disposable credentials, public JWTs, and documentation URLs", () => {
    const text = [
      "SUPABASE_SECRET_KEY=replace-with-your-secret-key",
      "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      "EXAMPLE_URL=postgresql://user:password@docs.invalid/example",
      jwt({ role: "anon", ref: "public-example" }),
    ].join("\n");
    expect(scanText(".env.example", text)).toEqual([]);
  });

  it("detects high-confidence provider tokens without returning their values", () => {
    const secret = `${"gh"}p_${crypto.randomBytes(24).toString("hex")}`;
    const findings = scanText("fixture.txt", `TOKEN=${secret}`);
    expect(findings).toEqual([{ filePath: "fixture.txt", line: 1, rule: "github-token" }]);
    expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it("detects private keys, remote credential URLs, literal secret assignments, and service-role JWTs", () => {
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

  it("rejects tracked environment and private-key container filenames", () => {
    expect(forbiddenTrackedPath(".env.local")).toBe(true);
    expect(forbiddenTrackedPath("config/production.env")).toBe(true);
    expect(forbiddenTrackedPath("secrets/recovery.p12")).toBe(true);
    expect(forbiddenTrackedPath(".env.example")).toBe(false);
  });

  it("finds no high-confidence secret in the tracked repository", () => {
    expect(scanRepository(process.cwd()).findings).toEqual([]);
    expect(scanRepository(process.cwd(), [
      "scripts/check-repository-secrets.mjs",
      "tests/r1-repository-secrets.test.ts",
    ]).findings).toEqual([]);
  });
});
