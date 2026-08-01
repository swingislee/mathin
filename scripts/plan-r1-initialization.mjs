#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { migrationsDigest } from "./lib/migrations-digest.mjs";
import { textFileSha256 } from "./lib/text-hash.mjs";

const MANIFEST_VERSION = "mathin-r1-initialization-v1";
const PLAN_VERSION = "mathin-r1-initialization-plan-v1";
const INVENTORY_VERSION = "mathin-r1-initialization-inventory-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const SHA256 = /^[0-9a-f]{64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORBIDDEN_KEY = /password|secret|token|recoverycode|service.?role/i;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function assertExactKeys(value, allowed, label) {
  assertObject(value, label);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail(`${label} has unsupported keys: ${extras.sort().join(", ")}`);
}

function assertString(value, label, minimum = 1) {
  assert(typeof value === "string" && value.length >= minimum, `${label} must be a string`);
  return value;
}

function assertDate(value, label) {
  assert(typeof value === "string" && !Number.isNaN(Date.parse(value)), `${label} must be an ISO date-time`);
}

function scanForCredentials(value, trail = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) fail(`${trail}.${key} must not store credentials`);
    scanForCredentials(nested, `${trail}.${key}`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function resolveRepoPath(root, relativePath, label) {
  assertString(relativePath, label);
  assert(!relativePath.includes("\\"), `${label} must use forward slashes`);
  assert(!path.isAbsolute(relativePath) && !/^[A-Za-z]:/.test(relativePath), `${label} must be repository-relative`);
  const resolved = path.resolve(root, relativePath);
  const prefix = `${path.resolve(root)}${path.sep}`.toLowerCase();
  assert(resolved.toLowerCase().startsWith(prefix), `${label} escapes the repository`);
  assert(fs.existsSync(resolved), `${label} does not exist: ${relativePath}`);
  return resolved;
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

function assertHash(actual, expected, label) {
  assert(SHA256.test(expected ?? ""), `${label} must be a SHA-256`);
  assert(actual === expected, `${label} mismatch: expected ${expected}, actual ${actual}`);
}

function assertSortedUniqueStrings(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} must be a non-empty array`);
  assert(values.every((item) => typeof item === "string" && item.length > 0), `${label} must contain strings`);
  const sorted = [...new Set(values)].sort();
  assert(sorted.length === values.length, `${label} must be unique`);
  assert(JSON.stringify(sorted) === JSON.stringify(values), `${label} must be sorted for reproducible plans`);
  return sorted;
}

function validateAdminManifest(adminManifest, manifest) {
  assertExactKeys(adminManifest, ["version", "environment", "projectId", "databaseId", "admin", "generatedAt", "approvedBy"], "administrator manifest");
  assert(adminManifest.version === 1, "administrator manifest version must be 1");
  assert(adminManifest.environment === "production", "administrator manifest environment must be production");
  assert(adminManifest.projectId === manifest.projectId, "administrator manifest projectId mismatch");
  assert(adminManifest.databaseId === manifest.databaseId, "administrator manifest databaseId mismatch");
  assertDate(adminManifest.generatedAt, "administrator manifest generatedAt");
  assert(Array.isArray(adminManifest.approvedBy) && new Set(adminManifest.approvedBy).size >= 2, "administrator manifest requires two approvers");
  const admin = adminManifest.admin;
  assertObject(admin, "administrator manifest admin");
  assert(UUID.test(admin.authUserId ?? "") && admin.authUserId === admin.profileId, "administrator auth/profile IDs must be one matching UUID");
  assert(EMAIL.test(admin.email ?? ""), "administrator email must be valid");
  assert(admin.role === "admin", "administrator role must be admin");
  assert(Array.isArray(admin.staffPermissions), "administrator staffPermissions must be an array");
  assert(admin.mfa?.required === true && Number.isInteger(admin.mfa?.verifiedFactorCount) && admin.mfa.verifiedFactorCount >= 1, "administrator MFA contract is incomplete");
  assertDate(admin.mfa?.verifiedAt, "administrator MFA verifiedAt");
  assert(admin.recovery?.primaryContact && admin.recovery?.secondaryContact && admin.recovery.primaryContact !== admin.recovery.secondaryContact, "administrator recovery contacts must be distinct");
  assert(admin.recovery?.offlineCredentialEnvelopeId, "administrator offline credential envelope is required");
  assertDate(admin.recovery?.lastTestedAt, "administrator recovery lastTestedAt");
  scanForCredentials(adminManifest, "administratorManifest");
}

export function loadInitializationContext({ root = process.cwd(), manifestPath = "docs/manifests/r1-initialization.example.json" } = {}) {
  const repositoryRoot = path.resolve(root);
  const manifestFile = path.isAbsolute(manifestPath) ? manifestPath : path.resolve(repositoryRoot, manifestPath);
  assert(fs.existsSync(manifestFile), `initialization manifest not found: ${manifestPath}`);
  const manifest = readJson(manifestFile, "initialization manifest");

  assertExactKeys(manifest, ["$schema", "schemaVersion", "environment", "mode", "projectId", "databaseId", "migration", "platform", "referenceData", "configuration", "administrator", "generatedAt", "approvedBy"], "initialization manifest");
  assert(manifest.schemaVersion === MANIFEST_VERSION, `schemaVersion must be ${MANIFEST_VERSION}`);
  assert(manifest.environment === "production", "environment must be production");
  assert(manifest.mode === "plan-only", "mode must be plan-only");
  assertString(manifest.projectId, "projectId", 3);
  assertString(manifest.databaseId, "databaseId", 3);
  assertDate(manifest.generatedAt, "generatedAt");
  assert(Array.isArray(manifest.approvedBy) && new Set(manifest.approvedBy).size >= 2, "approvedBy must contain two distinct approvers");
  scanForCredentials(manifest);
  assert(!UUID_ANYWHERE.test(JSON.stringify(manifest)), "initialization manifest must not contain UUIDs; use natural keys and database-generated IDs");

  const schemaFile = resolveRepoPath(repositoryRoot, "schemas/r1-initialization-manifest.schema.json", "manifest schema");
  const declaredSchema = path.resolve(path.dirname(manifestFile), manifest.$schema ?? "");
  assert(declaredSchema === schemaFile, "manifest $schema must reference schemas/r1-initialization-manifest.schema.json");

  assertExactKeys(manifest.migration, ["head", "digest", "fileCount"], "migration");
  const migrationFiles = fs.readdirSync(path.join(repositoryRoot, "supabase", "migrations")).filter((name) => name.endsWith(".sql")).sort();
  const actualHead = migrationFiles.at(-1)?.replace(/\.sql$/, "");
  const actualDigest = migrationsDigest(repositoryRoot);
  assert(manifest.migration.head === actualHead, `migration head mismatch: expected ${manifest.migration.head}, actual ${actualHead}`);
  assertHash(actualDigest, manifest.migration.digest, "migration digest");
  assert(manifest.migration.fileCount === migrationFiles.length, `migration fileCount mismatch: expected ${manifest.migration.fileCount}, actual ${migrationFiles.length}`);

  assertExactKeys(manifest.platform, ["source", "sourceSha256", "scope"], "platform");
  assert(manifest.platform.scope === "ci-verification-only", "platform bootstrap must remain CI verification only");
  const platformFile = resolveRepoPath(repositoryRoot, manifest.platform.source, "platform.source");
  assertHash(textFileSha256(platformFile), manifest.platform.sourceSha256, "platform source hash");

  assertExactKeys(manifest.referenceData, ["kind", "source", "sourceSha256", "familySlug", "naturalKey", "expectedCourseCount", "expectedLectureCount", "naturalKeysSha256"], "referenceData");
  assert(manifest.referenceData.kind === "course_catalog", "referenceData.kind must be course_catalog");
  assert(manifest.referenceData.naturalKey === "productCode", "course catalog natural key must be productCode");
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.referenceData.familySlug ?? ""), "referenceData.familySlug must be a slug");
  const referenceFile = resolveRepoPath(repositoryRoot, manifest.referenceData.source, "referenceData.source");
  assertHash(textFileSha256(referenceFile), manifest.referenceData.sourceSha256, "reference data source hash");
  const teachingPlans = readJson(referenceFile, "reference data source");
  assert(Array.isArray(teachingPlans), "reference data source must contain an array");
  assert(!UUID_ANYWHERE.test(JSON.stringify(teachingPlans)), "reference data source must not contain copied UUIDs");
  const courseKeys = teachingPlans.map((plan, index) => assertString(plan?.productCode, `reference course ${index + 1} productCode`)).sort();
  assert(new Set(courseKeys).size === courseKeys.length, "reference course productCode values must be unique");
  const lectureCount = teachingPlans.reduce((total, plan) => total + (Array.isArray(plan.lectures) ? plan.lectures.length : 0), 0);
  assert(manifest.referenceData.expectedCourseCount === teachingPlans.length, `course count mismatch: expected ${manifest.referenceData.expectedCourseCount}, actual ${teachingPlans.length}`);
  assert(manifest.referenceData.expectedLectureCount === lectureCount, `lecture count mismatch: expected ${manifest.referenceData.expectedLectureCount}, actual ${lectureCount}`);
  assertHash(sha256Text(courseKeys.join("\n")), manifest.referenceData.naturalKeysSha256, "course natural key set hash");

  assert(Array.isArray(manifest.configuration) && manifest.configuration.length === 2, "configuration must contain organization_rules and feature_flags");
  const configuration = new Map();
  for (const entry of manifest.configuration) {
    assertExactKeys(entry, ["kind", "source", "sourceSha256", "naturalKey", "expectedKeys"], `configuration.${entry?.kind ?? "unknown"}`);
    assert(["organization_rules", "feature_flags"].includes(entry.kind), `unsupported configuration kind: ${entry.kind}`);
    assert(!configuration.has(entry.kind), `duplicate configuration kind: ${entry.kind}`);
    const expectedNaturalKey = entry.kind === "organization_rules" ? "domain" : "flagKey";
    assert(entry.naturalKey === expectedNaturalKey, `${entry.kind} naturalKey must be ${expectedNaturalKey}`);
    const keys = assertSortedUniqueStrings(entry.expectedKeys, `${entry.kind}.expectedKeys`);
    const sourceFile = resolveRepoPath(repositoryRoot, entry.source, `${entry.kind}.source`);
    assertHash(textFileSha256(sourceFile), entry.sourceSha256, `${entry.kind} source hash`);
    const sourceText = fs.readFileSync(sourceFile, "utf8");
    for (const key of keys) assert(sourceText.includes(`'${key}'`), `${entry.kind} source does not declare ${key}`);
    configuration.set(entry.kind, { ...entry, expectedKeys: keys });
  }
  assert(configuration.has("organization_rules") && configuration.has("feature_flags"), "configuration kinds are incomplete");

  assertExactKeys(manifest.administrator, ["manifestPath", "manifestSha256"], "administrator");
  const adminFile = resolveRepoPath(repositoryRoot, manifest.administrator.manifestPath, "administrator.manifestPath");
  assertHash(textFileSha256(adminFile), manifest.administrator.manifestSha256, "administrator manifest hash");
  const adminManifest = readJson(adminFile, "administrator manifest");
  validateAdminManifest(adminManifest, manifest);

  return {
    root: repositoryRoot,
    manifest,
    manifestFile,
    manifestHash: textFileSha256(manifestFile),
    migrationFiles,
    courseKeys,
    lectureCount,
    configuration,
  };
}

function expectedResourceSpecs(context) {
  return new Map([
    ["course_catalog", context.courseKeys],
    ["organization_rules", context.configuration.get("organization_rules").expectedKeys],
    ["feature_flags", context.configuration.get("feature_flags").expectedKeys],
  ]);
}

/**
 * @param {any} context
 * @param {any} inventory
 * @param {any} [baseline]
 */
export function validateInitializationInventory(context, inventory, baseline = null) {
  assertExactKeys(inventory, ["schemaVersion", "stage", "manifestHash", "migration", "resources"], "inventory");
  assert(inventory.schemaVersion === INVENTORY_VERSION, `inventory schemaVersion must be ${INVENTORY_VERSION}`);
  assert(["preflight", "post_apply"].includes(inventory.stage), "inventory stage must be preflight or post_apply");
  assert(inventory.manifestHash === context.manifestHash, "inventory manifest hash mismatch");
  assertExactKeys(inventory.migration, ["head", "digest"], "inventory.migration");
  assert(inventory.migration.head === context.manifest.migration.head, "inventory migration head mismatch");
  assert(inventory.migration.digest === context.manifest.migration.digest, "inventory migration digest mismatch");
  assert(Array.isArray(inventory.resources), "inventory.resources must be an array");

  const specs = expectedResourceSpecs(context);
  const seenKinds = new Set();
  const globalIds = new Set();
  const normalized = {};
  for (const resource of inventory.resources) {
    assertExactKeys(resource, ["kind", "reportedCount", "items"], `inventory resource ${resource?.kind ?? "unknown"}`);
    assert(specs.has(resource.kind), `unsupported inventory resource: ${resource.kind}`);
    assert(!seenKinds.has(resource.kind), `duplicate inventory resource: ${resource.kind}`);
    seenKinds.add(resource.kind);
    assert(Array.isArray(resource.items), `${resource.kind}.items must be an array`);
    assert(resource.reportedCount === resource.items.length, `${resource.kind} reported count differs from item count`);
    const desiredKeys = specs.get(resource.kind);
    if (inventory.stage === "preflight") {
      assert(resource.reportedCount === 0, `${resource.kind} preflight count must be 0 for a clean target`);
      normalized[resource.kind] = [];
      continue;
    }
    assert(resource.reportedCount === desiredKeys.length, `${resource.kind} count mismatch: expected ${desiredKeys.length}, actual ${resource.reportedCount}`);
    const items = resource.items.map((item) => {
      assertExactKeys(item, ["naturalKey", "id"], `${resource.kind} item`);
      assert(typeof item.naturalKey === "string", `${resource.kind} naturalKey must be a string`);
      assert(UUID.test(item.id ?? ""), `${resource.kind} ID must be a UUID`);
      assert(!globalIds.has(item.id), `duplicate inventory ID: ${item.id}`);
      globalIds.add(item.id);
      return { naturalKey: item.naturalKey, id: item.id };
    }).sort((left, right) => left.naturalKey.localeCompare(right.naturalKey));
    assert(new Set(items.map((item) => item.naturalKey)).size === items.length, `${resource.kind} natural keys must be unique`);
    assert(JSON.stringify(items.map((item) => item.naturalKey)) === JSON.stringify(desiredKeys), `${resource.kind} natural key set mismatch`);
    normalized[resource.kind] = items;
  }
  assert(seenKinds.size === specs.size && [...specs.keys()].every((kind) => seenKinds.has(kind)), "inventory resources are incomplete");

  if (baseline) {
    assert(inventory.stage === "post_apply", "baseline comparison requires a post_apply inventory");
    const baselineResult = validateInitializationInventory(context, baseline, null);
    assert(baseline.stage === "post_apply", "baseline inventory must be post_apply");
    assert(canonicalJson(baselineResult.resources) === canonicalJson(normalized), "inventory ID mapping differs from the replay baseline");
  }

  return {
    status: "passed",
    stage: inventory.stage,
    resources: normalized,
    counts: Object.fromEntries(Object.entries(normalized).map(([kind, items]) => [kind, items.length])),
    baselineMatched: Boolean(baseline),
  };
}

export function buildInitializationPlan(context, inventorySummary = null) {
  const rules = context.configuration.get("organization_rules");
  const flags = context.configuration.get("feature_flags");
  const plan = {
    schemaVersion: PLAN_VERSION,
    manifestHash: context.manifestHash,
    environment: context.manifest.environment,
    projectId: context.manifest.projectId,
    databaseId: context.manifest.databaseId,
    migration: {
      head: context.manifest.migration.head,
      digest: context.manifest.migration.digest,
      fileCount: context.manifest.migration.fileCount,
    },
    phases: [
      {
        order: 1,
        kind: "platform_contract",
        operation: "verify-only",
        source: context.manifest.platform.source,
        sourceSha256: context.manifest.platform.sourceSha256,
        restriction: "ci-only-never-production",
      },
      {
        order: 2,
        kind: "migrations",
        operation: "replay-to-clean-target",
        naturalKey: "migration filename",
        expectedCount: context.manifest.migration.fileCount,
      },
      {
        order: 3,
        kind: "course_catalog",
        operation: "upsert-by-natural-key",
        naturalKey: context.manifest.referenceData.naturalKey,
        familySlug: context.manifest.referenceData.familySlug,
        source: context.manifest.referenceData.source,
        sourceSha256: context.manifest.referenceData.sourceSha256,
        expectedCount: context.courseKeys.length,
        expectedChildCount: context.lectureCount,
        naturalKeysSha256: context.manifest.referenceData.naturalKeysSha256,
      },
      {
        order: 4,
        kind: "organization_rules",
        operation: "versioned-insert",
        naturalKey: rules.naturalKey,
        source: rules.source,
        sourceSha256: rules.sourceSha256,
        expectedCount: rules.expectedKeys.length,
      },
      {
        order: 5,
        kind: "feature_flags",
        operation: "versioned-insert-fail-closed",
        naturalKey: flags.naturalKey,
        source: flags.source,
        sourceSha256: flags.sourceSha256,
        expectedCount: flags.expectedKeys.length,
      },
      {
        order: 6,
        kind: "production_administrator",
        operation: "verify-separate-manifest",
        manifestPath: context.manifest.administrator.manifestPath,
        manifestSha256: context.manifest.administrator.manifestSha256,
        command: `pnpm r1:admin-manifest:check ${context.manifest.administrator.manifestPath}`,
      },
    ],
    guards: {
      writesAllowed: false,
      idStrategy: "database-generated",
      manifestUuidAllowed: false,
      hashMismatch: "stop",
      countMismatch: "stop",
      naturalKeyMismatch: "stop",
      replayIdMismatch: "stop",
      productionExecutionStage: "R1-15/R1-18-with-human-approval",
    },
    inventoryCheck: inventorySummary ? {
      status: inventorySummary.status,
      stage: inventorySummary.stage,
      counts: inventorySummary.counts,
      baselineMatched: inventorySummary.baselineMatched,
    } : { status: "not_supplied" },
  };
  return { ...plan, planHash: sha256Text(canonicalJson(plan)) };
}

function parseCli(argv) {
  const options = { manifestPath: "docs/manifests/r1-initialization.example.json", inventoryPath: null, baselinePath: null };
  let manifestSet = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--inventory" || arg === "--baseline") {
      const value = argv[index + 1];
      if (!value) fail(`${arg} requires a path`);
      if (arg === "--inventory") options.inventoryPath = value;
      else options.baselinePath = value;
      index += 1;
    } else if (arg.startsWith("-")) {
      fail(`unknown option: ${arg}`);
    } else if (!manifestSet) {
      options.manifestPath = arg;
      manifestSet = true;
    } else {
      fail(`unexpected argument: ${arg}`);
    }
  }
  if (options.baselinePath && !options.inventoryPath) fail("--baseline requires --inventory");
  return options;
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseCli(argv);
    const context = loadInitializationContext({ manifestPath: options.manifestPath });
    let inventorySummary = null;
    if (options.inventoryPath) {
      const inventory = readJson(path.resolve(options.inventoryPath), "inventory");
      const baseline = options.baselinePath ? readJson(path.resolve(options.baselinePath), "baseline inventory") : null;
      inventorySummary = validateInitializationInventory(context, inventory, baseline);
    }
    process.stdout.write(`${JSON.stringify(buildInitializationPlan(context, inventorySummary), null, 2)}\n`);
  } catch (error) {
    console.error(`Initialization plan validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();