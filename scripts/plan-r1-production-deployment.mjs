#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { textFileSha256 } from "./lib/text-hash.mjs";

const MANIFEST_VERSION = "mathin-r1-production-deployment-v1";
const PLAN_VERSION = "mathin-r1-production-deployment-plan-v1";
const SHA256 = /^[0-9a-f]{64}$/;
const PLACEHOLDER_SHA256 = /^([0-9a-f])\1{63}$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const REFERENCE = /^[a-z0-9][a-z0-9._/-]+$/;
const FORBIDDEN_MATERIAL = /(?:postgres(?:ql)?:\/\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|bearer\s+[a-z0-9._~+/-]+=*)/i;

const ROOT_KEYS = ["$schema", "schemaVersion", "example", "mode", "writesAllowed", "networkAllowed", "current", "target", "configuration", "monitoring", "backup", "recovery", "rollback", "artifacts", "evidence"];
const ENV_KEYS = ["environment", "hostFingerprint", "supabaseProjectFingerprint", "databaseFingerprint", "storageFingerprint", "appDomain", "supabaseDomain"];
const FINGERPRINT_KEYS = ["hostFingerprint", "supabaseProjectFingerprint", "databaseFingerprint", "storageFingerprint"];
const ARTIFACT_KEYS = ["app-health-route", "backup-script", "backup-timer", "deploy-script", "disk-monitor-script", "linux-service-unit", "operations-runbook", "rollback-controller"];
const EVIDENCE_KEYS = ["r1_14", "r1_15", "environmentIsolation", "repositorySecretScan", "monitoringProbes", "databaseRecoveryDrill", "storageRecoveryDrill", "applicationRollbackDrill", "nonExecutorReview"];
const EVIDENCE_PREFIX = "docs/evidence/r1/artifacts/r1-16/";
const BINDINGS = new Map([
  ["ALERT_WEBHOOK_URL", ["infrastructure", "server-only", "secret-reference"]],
  ["BACKUP_ROOT", ["infrastructure", "server-only", "config-reference"]],
  ["MATHIN_ERROR_REPORT_TOKEN", ["application", "server-only", "secret-reference"]],
  ["MATHIN_ERROR_REPORT_URL", ["application", "server-only", "config-reference"]],
  ["MATHIN_RELEASE", ["application", "server-only", "release-metadata"]],
  ["NEXT_PUBLIC_SITE_URL", ["application", "public", "target-app-origin"]],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ["application", "public", "secret-reference"]],
  ["NEXT_PUBLIC_SUPABASE_URL", ["application", "public", "target-supabase-origin"]],
  ["R1_JOB_WORKER_ID", ["application", "server-only", "instance-identity"]],
  ["SUPABASE_SECRET_KEY", ["application", "server-only", "secret-reference"]],
]);

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function object(value, label) { assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`); }
function exactKeys(value, expected, label) {
  object(value, label);
  const actual = Object.keys(value);
  const extras = actual.filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !actual.includes(key));
  assert(extras.length === 0, `${label} has unsupported keys: ${extras.sort().join(", ")}`);
  assert(missing.length === 0, `${label} is missing keys: ${missing.sort().join(", ")}`);
}
function sha(value, label) { assert(SHA256.test(value ?? ""), `${label} must be a lowercase SHA-256`); }
function bool(value, expected, label) { assert(value === expected, `${label} must be ${expected}`); }
function integerAtMost(value, maximum, label, minimum = 1) { assert(Number.isInteger(value) && value >= minimum && value <= maximum, `${label} must be ${minimum}..${maximum}`); }
function sortedUnique(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const keys = values.map((value) => value.key ?? value.name);
  assert(new Set(keys).size === keys.length, `${label} keys must be unique`);
  assert(JSON.stringify(keys) === JSON.stringify([...keys].sort()), `${label} must be sorted`);
}
function safeRepoPath(root, value, label) {
  assert(typeof value === "string" && value.length >= 3 && !path.isAbsolute(value) && !value.includes("..") && !/[*?]/.test(value), `${label} must be a safe repository-relative path`);
  const resolved = path.resolve(root, value);
  assert(resolved.startsWith(`${root}${path.sep}`), `${label} escapes the repository`);
  return resolved;
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function sha256Text(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`); }
}

function validateEnvironment(value, label, environment) {
  exactKeys(value, ENV_KEYS, label);
  assert(value.environment === environment, `${label}.environment must be ${environment}`);
  for (const key of FINGERPRINT_KEYS) sha(value[key], `${label}.${key}`);
  assert(DOMAIN.test(value.appDomain ?? ""), `${label}.appDomain must be a DNS name`);
  assert(DOMAIN.test(value.supabaseDomain ?? ""), `${label}.supabaseDomain must be a DNS name`);
  assert(value.appDomain !== value.supabaseDomain, `${label} app and Supabase domains must differ`);
}

function validateConfiguration(value) {
  const keys = ["runtimeEnvironmentFile", "ownerOnly", "environmentFileExcludedFromRelease", "repositorySecretScanRequired", "buildTimePublicConfigPinned", "bindings"];
  exactKeys(value, keys, "configuration");
  assert(/^\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/.test(value.runtimeEnvironmentFile ?? ""), "configuration.runtimeEnvironmentFile must be an absolute non-traversing path");
  for (const key of keys.slice(1, 5)) bool(value[key], true, `configuration.${key}`);
  assert(value.bindings.length === BINDINGS.size, `configuration.bindings must contain exactly ${BINDINGS.size} entries`);
  sortedUnique(value.bindings, "configuration.bindings");
  for (const binding of value.bindings) {
    exactKeys(binding, ["name", "scope", "exposure", "source", "reference"], `configuration.bindings.${binding?.name ?? "unknown"}`);
    const expected = BINDINGS.get(binding.name);
    assert(expected, `unsupported configuration binding: ${binding.name}`);
    assert(binding.scope === expected[0] && binding.exposure === expected[1] && binding.source === expected[2], `${binding.name} scope/exposure/source contract mismatch`);
    const needsReference = ["secret-reference", "config-reference"].includes(binding.source);
    if (needsReference) {
      const prefix = binding.source === "secret-reference" ? "secrets/" : "config/";
      assert(typeof binding.reference === "string" && REFERENCE.test(binding.reference) && binding.reference.startsWith(prefix) && !binding.reference.includes("..") && !/[=:@]/.test(binding.reference), `${binding.name} must use a controlled ${prefix} reference name`);
    }
    else assert(binding.reference === null, `${binding.name}.reference must be null for ${binding.source}`);
  }
}

function validateMonitoring(value) {
  const keys = ["alertRouteReference", "checkIntervalSeconds", "consecutiveFailures", "appHealthPath", "supabaseHealthPath", "databaseRecoveryPointMaxAgeMinutes", "storageRecoveryPointMaxAgeMinutes", "diskWarningPercent", "diskCriticalPercent", "certificateMinimumRemainingDays", "jobDeadLetterAlertRequired", "controlledFailureTestRequired"];
  exactKeys(value, keys, "monitoring");
  assert(REFERENCE.test(value.alertRouteReference ?? ""), "monitoring.alertRouteReference must be opaque");
  integerAtMost(value.checkIntervalSeconds, 300, "monitoring.checkIntervalSeconds", 30);
  integerAtMost(value.consecutiveFailures, 3, "monitoring.consecutiveFailures");
  assert(value.appHealthPath === "/api/health", "monitoring.appHealthPath must be /api/health");
  assert(value.supabaseHealthPath === "/auth/v1/", "monitoring.supabaseHealthPath must be /auth/v1/");
  integerAtMost(value.databaseRecoveryPointMaxAgeMinutes, 15, "monitoring.databaseRecoveryPointMaxAgeMinutes");
  integerAtMost(value.storageRecoveryPointMaxAgeMinutes, 1440, "monitoring.storageRecoveryPointMaxAgeMinutes");
  assert(value.diskWarningPercent === 75 && value.diskCriticalPercent === 85, "monitoring disk thresholds must be 75/85");
  assert(Number.isInteger(value.certificateMinimumRemainingDays) && value.certificateMinimumRemainingDays >= 14, "monitoring.certificateMinimumRemainingDays must be at least 14");
  bool(value.jobDeadLetterAlertRequired, true, "monitoring.jobDeadLetterAlertRequired");
  bool(value.controlledFailureTestRequired, true, "monitoring.controlledFailureTestRequired");
}

function validateBackup(value) {
  exactKeys(value, ["retentionDays", "database", "storage"], "backup");
  assert(Number.isInteger(value.retentionDays) && value.retentionDays >= 30, "backup.retentionDays must be at least 30");
  exactKeys(value.database, ["rpoMinutes", "rtoMinutes", "continuousProtectionRequired", "offHost", "encryptedAtRest", "immutableOrVersioned", "integrityCheckRequired"], "backup.database");
  integerAtMost(value.database.rpoMinutes, 15, "backup.database.rpoMinutes");
  integerAtMost(value.database.rtoMinutes, 240, "backup.database.rtoMinutes");
  for (const key of ["continuousProtectionRequired", "offHost", "encryptedAtRest", "immutableOrVersioned", "integrityCheckRequired"]) bool(value.database[key], true, `backup.database.${key}`);
  exactKeys(value.storage, ["rpoMinutes", "rtoMinutes", "offHost", "encryptedAtRest", "immutableOrVersioned", "objectManifestHashRequired"], "backup.storage");
  integerAtMost(value.storage.rpoMinutes, 1440, "backup.storage.rpoMinutes");
  integerAtMost(value.storage.rtoMinutes, 480, "backup.storage.rtoMinutes");
  for (const key of ["offHost", "encryptedAtRest", "immutableOrVersioned", "objectManifestHashRequired"]) bool(value.storage[key], true, `backup.storage.${key}`);
}

function validateRecovery(value, current, target) {
  const keys = ["environment", "hostFingerprint", "supabaseProjectFingerprint", "databaseFingerprint", "storageFingerprint", "productionEndpointAllowed", "executionByPlannerAllowed", "postRestoreSmokeRequired", "nonExecutorReviewerRequired"];
  exactKeys(value, keys, "recovery");
  assert(value.environment === "isolated-restore-drill", "recovery.environment must be isolated-restore-drill");
  for (const key of ["hostFingerprint", "supabaseProjectFingerprint", "databaseFingerprint", "storageFingerprint"]) {
    sha(value[key], `recovery.${key}`);
    assert(value[key] !== current[key] && value[key] !== target[key], `recovery.${key} must differ from current and target`);
  }
  bool(value.productionEndpointAllowed, false, "recovery.productionEndpointAllowed");
  bool(value.executionByPlannerAllowed, false, "recovery.executionByPlannerAllowed");
  bool(value.postRestoreSmokeRequired, true, "recovery.postRestoreSmokeRequired");
  bool(value.nonExecutorReviewerRequired, true, "recovery.nonExecutorReviewerRequired");
}

function validateRollback(value) {
  const keys = ["applicationMaxMinutes", "previousReleaseRequired", "atomicSwitchRequired", "healthPath", "databaseStrategy", "automaticProductionDatabaseRestoreAllowed", "humanConfirmationRequired"];
  exactKeys(value, keys, "rollback");
  integerAtMost(value.applicationMaxMinutes, 30, "rollback.applicationMaxMinutes");
  bool(value.previousReleaseRequired, true, "rollback.previousReleaseRequired");
  bool(value.atomicSwitchRequired, true, "rollback.atomicSwitchRequired");
  assert(value.healthPath === "/api/health", "rollback.healthPath must be /api/health");
  assert(value.databaseStrategy === "backward-compatible-and-forward-fix", "rollback.databaseStrategy must be backward-compatible-and-forward-fix");
  bool(value.automaticProductionDatabaseRestoreAllowed, false, "rollback.automaticProductionDatabaseRestoreAllowed");
  bool(value.humanConfirmationRequired, true, "rollback.humanConfirmationRequired");
}

function validateArtifacts(root, values) {
  assert(values.length === ARTIFACT_KEYS.length, `artifacts must contain exactly ${ARTIFACT_KEYS.length} entries`);
  sortedUnique(values, "artifacts");
  assert(JSON.stringify(values.map((item) => item.key)) === JSON.stringify(ARTIFACT_KEYS), "artifacts must contain the fixed R1-16 implementation set");
  return values.map((item) => {
    exactKeys(item, ["key", "path", "sha256"], `artifacts.${item?.key ?? "unknown"}`);
    sha(item.sha256, `artifacts.${item.key}.sha256`);
    const file = safeRepoPath(root, item.path, `artifacts.${item.key}.path`);
    assert(fs.existsSync(file), `artifact does not exist: ${item.path}`);
    assert(textFileSha256(file) === item.sha256, `artifact hash mismatch: ${item.path}`);
    return { ...item };
  });
}

function validateEvidence(root, example, value) {
  exactKeys(value, EVIDENCE_KEYS, "evidence");
  const statuses = {};
  const passedArtifacts = [];
  for (const key of EVIDENCE_KEYS) {
    const item = value[key];
    exactKeys(item, ["status", "artifactPath", "artifactSha256"], `evidence.${key}`);
    assert(["pending", "passed"].includes(item.status), `evidence.${key}.status must be pending or passed`);
    if (item.status === "pending") {
      assert(item.artifactPath === null && item.artifactSha256 === null, `pending evidence.${key} must not claim an artifact`);
    } else {
      assert(!example, `example manifest cannot mark evidence.${key} passed`);
      sha(item.artifactSha256, `evidence.${key}.artifactSha256`);
      assert(typeof item.artifactPath === "string" && item.artifactPath.replaceAll("\\", "/").startsWith(EVIDENCE_PREFIX), `passed evidence.${key} must be under ${EVIDENCE_PREFIX}`);
      passedArtifacts.push({ key, path: item.artifactPath.replaceAll("\\", "/"), sha256: item.artifactSha256 });
    }
    statuses[key] = item.status;
  }
  const uniquePaths = new Set(passedArtifacts.map((item) => item.path));
  assert(uniquePaths.size === passedArtifacts.length, "passed evidence artifacts must use distinct paths for each gate");
  for (const item of passedArtifacts) {
    const file = safeRepoPath(root, item.path, `evidence.${item.key}.artifactPath`);
    assert(fs.existsSync(file), `evidence artifact does not exist: ${item.path}`);
    assert(textFileSha256(file) === item.sha256, `evidence artifact hash mismatch: ${item.path}`);
  }
  return statuses;
}

export function loadProductionDeploymentContext({ root = process.cwd(), manifestPath = "docs/manifests/r1-production-deployment.example.json" } = {}) {
  const repositoryRoot = path.resolve(root);
  const manifestFile = path.isAbsolute(manifestPath) ? path.resolve(manifestPath) : path.resolve(repositoryRoot, manifestPath);
  assert(fs.existsSync(manifestFile), `production deployment manifest not found: ${manifestPath}`);
  const manifest = readJson(manifestFile, "production deployment manifest");
  exactKeys(manifest, ROOT_KEYS, "production deployment manifest");
  assert(manifest.schemaVersion === MANIFEST_VERSION, `schemaVersion must be ${MANIFEST_VERSION}`);
  assert(typeof manifest.example === "boolean", "example must be boolean");
  assert(manifest.mode === "plan-only", "mode must be plan-only");
  bool(manifest.writesAllowed, false, "writesAllowed");
  bool(manifest.networkAllowed, false, "networkAllowed");
  assert(!FORBIDDEN_MATERIAL.test(JSON.stringify(manifest)), "manifest must not contain credentials, connection strings, bearer tokens, or private keys");

  const schemaFile = path.join(repositoryRoot, "schemas", "r1-production-deployment-manifest.schema.json");
  const declaredSchema = path.resolve(path.dirname(manifestFile), manifest.$schema ?? "");
  assert(declaredSchema === schemaFile, "manifest $schema must reference schemas/r1-production-deployment-manifest.schema.json");

  validateEnvironment(manifest.current, "current", "shared-development-baseline");
  validateEnvironment(manifest.target, "target", "independent-production-candidate");
  for (const key of FINGERPRINT_KEYS) assert(manifest.current[key] !== manifest.target[key], `current and target ${key} must differ`);
  const environmentDomains = [manifest.current.appDomain, manifest.current.supabaseDomain, manifest.target.appDomain, manifest.target.supabaseDomain];
  assert(new Set(environmentDomains).size === environmentDomains.length, "current and target app/Supabase domains must all differ");

  validateConfiguration(manifest.configuration);
  validateMonitoring(manifest.monitoring);
  validateBackup(manifest.backup);
  validateRecovery(manifest.recovery, manifest.current, manifest.target);
  if (!manifest.example) {
    for (const [label, value] of [
      ...FINGERPRINT_KEYS.flatMap((key) => [[`current.${key}`, manifest.current[key]], [`target.${key}`, manifest.target[key]]]),
      ...["hostFingerprint", "supabaseProjectFingerprint", "databaseFingerprint", "storageFingerprint"].map((key) => [`recovery.${key}`, manifest.recovery[key]]),
    ]) assert(!PLACEHOLDER_SHA256.test(value), `${label} must not use an example placeholder fingerprint`);
    for (const [label, value] of [["current.appDomain", manifest.current.appDomain], ["current.supabaseDomain", manifest.current.supabaseDomain], ["target.appDomain", manifest.target.appDomain], ["target.supabaseDomain", manifest.target.supabaseDomain]]) {
      assert(!value.endsWith(".invalid"), `${label} must not use an .invalid example domain`);
    }
  }
  validateRollback(manifest.rollback);
  const artifacts = validateArtifacts(repositoryRoot, manifest.artifacts);
  const evidence = validateEvidence(repositoryRoot, manifest.example, manifest.evidence);

  return { root: repositoryRoot, manifest, manifestFile, manifestHash: textFileSha256(manifestFile), artifacts, evidence };
}

export function buildProductionDeploymentPlan(context) {
  const pending = EVIDENCE_KEYS.filter((key) => context.evidence[key] !== "passed");
  const blockers = [...(context.manifest.example ? ["example-manifest"] : []), ...pending.map((key) => `evidence:${key}`)];
  const plan = {
    schemaVersion: PLAN_VERSION,
    manifestHash: context.manifestHash,
    mode: "plan-only",
    writesAllowed: false,
    networkAllowed: false,
    executionByPlannerAllowed: false,
    target: {
      environment: context.manifest.target.environment,
      hostFingerprint: context.manifest.target.hostFingerprint,
      supabaseProjectFingerprint: context.manifest.target.supabaseProjectFingerprint,
      databaseFingerprint: context.manifest.target.databaseFingerprint,
      storageFingerprint: context.manifest.target.storageFingerprint,
      appDomain: context.manifest.target.appDomain,
      supabaseDomain: context.manifest.target.supabaseDomain,
    },
    contracts: {
      configurationBindings: context.manifest.configuration.bindings.map(({ name, scope, exposure, source }) => ({ name, scope, exposure, source })),
      monitoring: { ...context.manifest.monitoring },
      recoveryObjectives: {
        database: { rpoMinutes: context.manifest.backup.database.rpoMinutes, rtoMinutes: context.manifest.backup.database.rtoMinutes },
        storage: { rpoMinutes: context.manifest.backup.storage.rpoMinutes, rtoMinutes: context.manifest.backup.storage.rtoMinutes },
        applicationRollbackMinutes: context.manifest.rollback.applicationMaxMinutes,
      },
      artifacts: context.artifacts,
    },
    gates: EVIDENCE_KEYS.map((key) => ({ id: key, status: context.evidence[key] })),
    blockers,
    readyForAuthorizedExecution: blockers.length === 0,
    stageClosureAllowed: false,
    guards: {
      productionWriteAllowed: false,
      networkAccessAllowed: false,
      sshAllowed: false,
      backupExecutionAllowed: false,
      restoreExecutionAllowed: false,
      rollbackExecutionAllowed: false,
      sourceTargetFingerprintMismatch: "required",
      recoveryTargetIsolation: "required",
      secretValuesInManifest: "reject",
    },
  };
  return { ...plan, planHash: sha256Text(canonicalJson(plan)) };
}

export function main(argv = process.argv.slice(2)) {
  try {
    assert(argv.length <= 1, "usage: plan-r1-production-deployment.mjs [manifest.json]");
    const context = loadProductionDeploymentContext({ manifestPath: argv[0] ?? undefined });
    process.stdout.write(`${JSON.stringify(buildProductionDeploymentPlan(context), null, 2)}\n`);
  } catch (error) {
    console.error(`Production deployment preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
