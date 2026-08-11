import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProductionDeploymentPlan,
  loadProductionDeploymentContext,
} from "../scripts/plan-r1-production-deployment.mjs";
import { textFileSha256 } from "../scripts/lib/text-hash.mjs";

const root = process.cwd();
const manifestPath = "docs/manifests/r1-production-deployment.example.json";
const schemaPath = path.join(root, "schemas", "r1-production-deployment-manifest.schema.json");
const source = () => JSON.parse(fs.readFileSync(path.join(root, manifestPath), "utf8"));

function actualize(value: ReturnType<typeof source>) {
  value.example = false;
  let index = 0;
  for (const environment of [value.current, value.target, value.recovery]) {
    for (const key of ["hostFingerprint", "supabaseProjectFingerprint", "databaseFingerprint", "storageFingerprint"]) {
      if (key in environment) environment[key] = crypto.createHash("sha256").update(`r1-16-${index++}`).digest("hex");
    }
  }
  value.current.appDomain = "dev.example.com";
  value.current.supabaseDomain = "supabase-dev.example.com";
  value.target.appDomain = "app.example.com";
  value.target.supabaseDomain = "supabase.example.com";
  return value;
}

function writeManifest(temp: string, name: string, value: Record<string, unknown>) {
  value.$schema = schemaPath;
  const file = path.join(temp, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}

describe("R1-16 independent production deployment preflight", () => {
  it("builds a deterministic plan that stays non-executing and reports pending evidence", () => {
    const first = buildProductionDeploymentPlan(loadProductionDeploymentContext({ root, manifestPath }));
    const second = buildProductionDeploymentPlan(loadProductionDeploymentContext({ root, manifestPath }));

    expect(first).toEqual(second);
    expect(first.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toMatchObject({
      mode: "plan-only",
      writesAllowed: false,
      networkAllowed: false,
      executionByPlannerAllowed: false,
      readyForAuthorizedExecution: false,
      stageClosureAllowed: false,
      guards: {
        sshAllowed: false,
        backupExecutionAllowed: false,
        restoreExecutionAllowed: false,
        rollbackExecutionAllowed: false,
      },
    });
    expect(first.blockers).toContain("example-manifest");
    expect(first.blockers).toContain("evidence:databaseRecoveryDrill");
    expect(first.contracts.recoveryObjectives).toEqual({
      database: { rpoMinutes: 15, rtoMinutes: 240 },
      storage: { rpoMinutes: 1440, rtoMinutes: 480 },
      applicationRollbackMinutes: 30,
    });
    expect(JSON.stringify(first)).not.toContain("secrets/production");
  });

  it("rejects writable/networked plans and shared production or restore targets", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-deploy-"));
    try {
      const writable = source();
      writable.writesAllowed = true;
      expect(() => loadProductionDeploymentContext({ root, manifestPath: writeManifest(temp, "writable.json", writable) })).toThrow(/writesAllowed must be false/);

      const networked = source();
      networked.networkAllowed = true;
      expect(() => loadProductionDeploymentContext({ root, manifestPath: writeManifest(temp, "networked.json", networked) })).toThrow(/networkAllowed must be false/);

      const sharedTarget = source();
      sharedTarget.target.databaseFingerprint = sharedTarget.current.databaseFingerprint;
      expect(() => loadProductionDeploymentContext({ root, manifestPath: writeManifest(temp, "shared-target.json", sharedTarget) })).toThrow(/current and target databaseFingerprint must differ/);

      const sharedRestore = source();
      sharedRestore.recovery.supabaseProjectFingerprint = sharedRestore.target.supabaseProjectFingerprint;
      expect(() => loadProductionDeploymentContext({ root, manifestPath: writeManifest(temp, "shared-restore.json", sharedRestore) })).toThrow(/recovery.supabaseProjectFingerprint must differ/);

      const crossedDomain = source();
      crossedDomain.target.appDomain = crossedDomain.current.supabaseDomain;
      expect(() => loadProductionDeploymentContext({ root, manifestPath: writeManifest(temp, "cross-domain.json", crossedDomain) })).toThrow(/domains must all differ/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("accepts only controlled secret/config references and rejects secret-shaped material", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-deploy-"));
    try {
      const badReference = source();
      badReference.configuration.bindings.find((item: { name: string }) => item.name === "SUPABASE_SECRET_KEY").reference = "production/supabase/secret-key";
      expect(() => loadProductionDeploymentContext({ root, manifestPath: writeManifest(temp, "bad-reference.json", badReference) })).toThrow(/controlled secrets\//);

      const connection = source();
      connection.configuration.runtimeEnvironmentFile = "postgresql://user:password@example.invalid/db";
      expect(() => loadProductionDeploymentContext({ root, manifestPath: writeManifest(temp, "connection.json", connection) })).toThrow(/must not contain credentials/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("pins every implementation artifact by normalized text hash", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-deploy-"));
    try {
      const drift = source();
      drift.artifacts[0].sha256 = "0".repeat(64);
      expect(() => loadProductionDeploymentContext({ root, manifestPath: writeManifest(temp, "drift.json", drift) })).toThrow(/artifact hash mismatch/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("rejects copied example identities and generic or duplicate passed evidence", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-deploy-"));
    try {
      const copiedExample = source();
      copiedExample.example = false;
      expect(() => loadProductionDeploymentContext({ root, manifestPath: writeManifest(temp, "copied-example.json", copiedExample) })).toThrow(/placeholder fingerprint/);

      const runbookEvidence = actualize(source());
      runbookEvidence.evidence.r1_14 = {
        status: "passed",
        artifactPath: "docs/runbooks/r1-production-deployment-preflight.md",
        artifactSha256: textFileSha256(path.join(root, "docs/runbooks/r1-production-deployment-preflight.md")),
      };
      expect(() => loadProductionDeploymentContext({ root, manifestPath: writeManifest(temp, "runbook-evidence.json", runbookEvidence) })).toThrow(/must be under docs\/evidence\/r1\/artifacts\/r1-16/);

      const duplicate = actualize(source());
      for (const key of ["r1_14", "r1_15"]) duplicate.evidence[key] = {
        status: "passed",
        artifactPath: "docs/evidence/r1/artifacts/r1-16/reused.txt",
        artifactSha256: "d".repeat(64),
      };
      expect(() => loadProductionDeploymentContext({ root, manifestPath: writeManifest(temp, "duplicate-evidence.json", duplicate) })).toThrow(/distinct paths/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("only reports readiness after all distinct evidence statuses are passed, while staying non-executing", () => {
    const context = loadProductionDeploymentContext({ root, manifestPath });
    context.manifest.example = false;
    const evidence = context.evidence as Record<string, string>;
    for (const key of Object.keys(evidence)) evidence[key] = "passed";
    const plan = buildProductionDeploymentPlan(context);
    expect(plan.blockers).toEqual([]);
    expect(plan.readyForAuthorizedExecution).toBe(true);
    expect(plan.executionByPlannerAllowed).toBe(false);
    expect(plan.stageClosureAllowed).toBe(false);
  });

  it("ships a strict schema and a planner without network or child-process imports", () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const planner = fs.readFileSync(path.join(root, "scripts", "plan-r1-production-deployment.mjs"), "utf8");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.mode.const).toBe("plan-only");
    expect(schema.properties.writesAllowed.const).toBe(false);
    expect(schema.properties.networkAllowed.const).toBe(false);
    expect(schema.properties.recovery.properties.supabaseProjectFingerprint.$ref).toBe("#/$defs/sha256");
    expect(planner).not.toMatch(/from ["']node:(?:http|https|net|tls|child_process)["']/);
    expect(planner).not.toContain("fetch(");
    expect(planner).not.toContain("DATABASE_URL");
    expect(planner).not.toContain("SUPABASE_DB_");
  });
});
