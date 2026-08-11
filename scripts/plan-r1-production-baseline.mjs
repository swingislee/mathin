#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { textFileSha256 } from "./lib/text-hash.mjs";

const MANIFEST_VERSION = "mathin-r1-production-baseline-v1";
const PLAN_VERSION = "mathin-r1-production-baseline-plan-v1";
const RESULT_VERSION = "mathin-r1-production-baseline-result-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const SHA256 = /^[0-9a-f]{64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORBIDDEN_KEY = /password|secret|token|credential|service.?role|connection.?string|endpoint|(^|_)url$/i;
const URL_OR_CONNECTION = /(?:https?|postgres(?:ql)?):\/\//i;

const SYSTEM_SPECS = new Map([
  ["e-series", { courseCount: 90, lectureCount: 1135, placeholder: /^example-e-\d{4}$/ }],
  ["aixuexi-gplus-autumn", { courseCount: 4, lectureCount: 52, placeholder: /^example-aixuexi-\d{2}$/ }],
]);

const EXPECTED_COUNTS = Object.freeze({
  courseCount: 94,
  lectureCount: 1187,
  nativeHeadCount: 1187,
  adaptedHeadCount: 1187,
  releaseCount: 2374,
  legacyCurrentReleaseCount: 1187,
  releaseNoGreaterThanOneCount: 0,
});

const ZERO_CHANGES = Object.freeze({ inserted: 0, updated: 0, deleted: 0, hashDifferences: 0 });

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
  const actual = Object.keys(value);
  const extras = actual.filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !actual.includes(key));
  if (extras.length) fail(`${label} has unsupported keys: ${extras.sort().join(", ")}`);
  if (missing.length) fail(`${label} is missing keys: ${missing.sort().join(", ")}`);
}

function assertString(value, label, minimum = 1) {
  assert(typeof value === "string" && value.length >= minimum, `${label} must be a string`);
  return value;
}

function assertSha256(value, label) {
  assert(SHA256.test(value ?? ""), `${label} must be a lowercase SHA-256`);
  return value;
}

function assertNonNegativeInteger(value, label) {
  assert(Number.isInteger(value) && value >= 0, `${label} must be a non-negative integer`);
  return value;
}

function assertExactObject(value, expected, label) {
  assertExactKeys(value, Object.keys(expected), label);
  for (const [key, expectedValue] of Object.entries(expected)) {
    assert(value[key] === expectedValue, `${label}.${key} must be ${expectedValue}`);
  }
}

function assertSortedUniqueStrings(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} must be a non-empty array`);
  assert(values.every((item) => typeof item === "string"), `${label} must contain strings`);
  const sorted = [...new Set(values)].sort();
  assert(sorted.length === values.length, `${label} must be unique`);
  assert(JSON.stringify(sorted) === JSON.stringify(values), `${label} must be sorted for a deterministic plan`);
  return sorted;
}

function scanForSensitiveMaterial(value, trail = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) fail(`${trail}.${key} must not describe credentials, connections, URLs, or endpoints`);
    if (typeof nested === "string") {
      if (URL_OR_CONNECTION.test(nested)) fail(`${trail}.${key} must not contain an endpoint or connection string`);
      if (EMAIL.test(nested)) fail(`${trail}.${key} must not contain email or other administrator PII`);
    }
    scanForSensitiveMaterial(nested, `${trail}.${key}`);
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

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

function resolveInputPath(root, manifestFile, declaredPath, label) {
  assertString(declaredPath, label, 3);
  assert(!URL_OR_CONNECTION.test(declaredPath), `${label} must be a local filesystem path`);
  if (path.isAbsolute(declaredPath)) return path.resolve(declaredPath);
  const repositoryRelative = path.resolve(root, declaredPath);
  if (fs.existsSync(repositoryRelative)) return repositoryRelative;
  return path.resolve(path.dirname(manifestFile), declaredPath);
}

function validateStorage(storage, label) {
  assertExactKeys(storage, ["bucket", "prefix", "objectsManifestSha256"], label);
  assert(/^[a-z0-9][a-z0-9._-]{2,62}$/.test(storage.bucket ?? ""), `${label}.bucket is invalid`);
  assert(
    typeof storage.prefix === "string"
      && /^[A-Za-z0-9._/-]+\/$/.test(storage.prefix)
      && !storage.prefix.startsWith("/")
      && !storage.prefix.includes("..")
      && !/[*?]/.test(storage.prefix),
    `${label}.prefix must be one explicit relative prefix ending in /`,
  );
  assertSha256(storage.objectsManifestSha256, `${label}.objectsManifestSha256`);
  return { ...storage };
}

function validateCourseSystems(manifest) {
  assert(Array.isArray(manifest.courseSystems) && manifest.courseSystems.length === 2, "courseSystems must contain exactly two systems");
  const seen = new Set();
  const globalIds = new Set();
  const normalized = [];

  for (const system of manifest.courseSystems) {
    assertExactKeys(system, ["key", "courseCount", "lectureIds", "lectureIdsSha256", "storage"], `courseSystems.${system?.key ?? "unknown"}`);
    const spec = SYSTEM_SPECS.get(system.key);
    assert(spec, `unsupported course system: ${system.key}`);
    assert(!seen.has(system.key), `duplicate course system: ${system.key}`);
    seen.add(system.key);
    assert(system.courseCount === spec.courseCount, `${system.key}.courseCount must be ${spec.courseCount}`);
    const lectureIds = assertSortedUniqueStrings(system.lectureIds, `${system.key}.lectureIds`);
    assert(lectureIds.length === spec.lectureCount, `${system.key}.lectureIds must contain exactly ${spec.lectureCount} IDs`);
    for (const lectureId of lectureIds) {
      assert(lectureId.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]+$/.test(lectureId), `${system.key} has an invalid lecture ID`);
      if (manifest.example) {
        assert(spec.placeholder.test(lectureId), `${system.key} example IDs must use the documented placeholder format`);
      } else {
        assert(UUID.test(lectureId), `${system.key} production-snapshot IDs must be UUIDs`);
      }
      assert(!globalIds.has(lectureId), `lecture ID appears in more than one course system: ${lectureId}`);
      globalIds.add(lectureId);
    }
    const lectureIdsSha256 = sha256Text(lectureIds.join("\n"));
    assertSha256(system.lectureIdsSha256, `${system.key}.lectureIdsSha256`);
    assert(lectureIdsSha256 === system.lectureIdsSha256, `${system.key}.lectureIdsSha256 does not match the explicit ID set`);
    normalized.push({
      key: system.key,
      courseCount: system.courseCount,
      lectureCount: lectureIds.length,
      lectureIds,
      lectureIdsSha256,
      storage: validateStorage(system.storage, `${system.key}.storage`),
    });
  }

  assert([...SYSTEM_SPECS.keys()].every((key) => seen.has(key)), "courseSystems is incomplete");
  normalized.sort((left, right) => left.key.localeCompare(right.key));
  return normalized;
}

export function loadProductionBaselineContext({
  root = process.cwd(),
  manifestPath = "docs/manifests/r1-production-baseline.example.json",
} = {}) {
  const repositoryRoot = path.resolve(root);
  const manifestFile = path.isAbsolute(manifestPath) ? path.resolve(manifestPath) : path.resolve(repositoryRoot, manifestPath);
  assert(fs.existsSync(manifestFile), `production baseline manifest not found: ${manifestPath}`);
  const manifest = readJson(manifestFile, "production baseline manifest");

  assertExactKeys(
    manifest,
    ["$schema", "schemaVersion", "example", "mode", "writesAllowed", "source", "target", "administrator", "courseSystems", "expected", "replay"],
    "production baseline manifest",
  );
  assert(manifest.schemaVersion === MANIFEST_VERSION, `schemaVersion must be ${MANIFEST_VERSION}`);
  assert(typeof manifest.example === "boolean", "example must be boolean");
  assert(manifest.mode === "plan-only", "mode must be plan-only");
  assert(manifest.writesAllowed === false, "writesAllowed must be false");
  scanForSensitiveMaterial(manifest);
  if (manifest.example) assert(!UUID_ANYWHERE.test(JSON.stringify(manifest)), "example manifest must not contain UUIDs");

  const schemaFile = path.join(repositoryRoot, "schemas", "r1-production-baseline-manifest.schema.json");
  const declaredSchema = path.isAbsolute(manifest.$schema ?? "")
    ? path.resolve(manifest.$schema)
    : path.resolve(path.dirname(manifestFile), manifest.$schema ?? "");
  assert(declaredSchema === schemaFile, "manifest $schema must reference schemas/r1-production-baseline-manifest.schema.json");

  assertExactKeys(manifest.source, ["environment", "projectFingerprint", "databaseFingerprint"], "source");
  assert(manifest.source.environment === "production-snapshot-source", "source.environment must be production-snapshot-source");
  assertSha256(manifest.source.projectFingerprint, "source.projectFingerprint");
  assertSha256(manifest.source.databaseFingerprint, "source.databaseFingerprint");

  assertExactKeys(manifest.target, ["environment", "projectFingerprint", "databaseFingerprint"], "target");
  assert(manifest.target.environment === "isolated-production-snapshot", "target.environment must be isolated-production-snapshot");
  assertSha256(manifest.target.projectFingerprint, "target.projectFingerprint");
  assertSha256(manifest.target.databaseFingerprint, "target.databaseFingerprint");
  assert(manifest.source.projectFingerprint !== manifest.target.projectFingerprint, "source and target project fingerprints must differ");
  assert(manifest.source.databaseFingerprint !== manifest.target.databaseFingerprint, "source and target database fingerprints must differ");

  assertExactKeys(manifest.administrator, ["manifestPath", "manifestSha256"], "administrator");
  assertSha256(manifest.administrator.manifestSha256, "administrator.manifestSha256");
  const adminFile = resolveInputPath(repositoryRoot, manifestFile, manifest.administrator.manifestPath, "administrator.manifestPath");
  assert(fs.existsSync(adminFile), "administrator manifest file does not exist");
  assert(textFileSha256(adminFile) === manifest.administrator.manifestSha256, "administrator manifest hash mismatch");

  const courseSystems = validateCourseSystems(manifest);
  assertExactObject(manifest.expected, EXPECTED_COUNTS, "expected");
  assertExactKeys(manifest.replay, ["required", ...Object.keys(ZERO_CHANGES)], "replay");
  assert(manifest.replay.required === true, "replay.required must be true");
  for (const [key, value] of Object.entries(ZERO_CHANGES)) assert(manifest.replay[key] === value, `replay.${key} must be ${value}`);

  const calculatedCourseCount = courseSystems.reduce((total, system) => total + system.courseCount, 0);
  const calculatedLectureCount = courseSystems.reduce((total, system) => total + system.lectureCount, 0);
  assert(calculatedCourseCount === EXPECTED_COUNTS.courseCount, "course system counts do not total 94");
  assert(calculatedLectureCount === EXPECTED_COUNTS.lectureCount, "explicit lecture IDs do not total 1187");

  return {
    root: repositoryRoot,
    manifest,
    manifestFile,
    manifestHash: textFileSha256(manifestFile),
    courseSystems,
    explicitLectureIdsSha256: sha256Text(courseSystems.flatMap((system) => system.lectureIds).sort().join("\n")),
  };
}

function validateResultTarget(context, target) {
  assertExactKeys(target, ["environment", "projectFingerprint", "databaseFingerprint"], "result.target");
  assert(target.environment === "isolated-production-snapshot", "result target must be isolated-production-snapshot");
  assert(target.projectFingerprint === context.manifest.target.projectFingerprint, "result target project fingerprint mismatch");
  assert(target.databaseFingerprint === context.manifest.target.databaseFingerprint, "result target database fingerprint mismatch");
}

function validateResultSystems(context, systems) {
  assert(Array.isArray(systems) && systems.length === context.courseSystems.length, "result.courseSystems is incomplete");
  const expected = new Map(context.courseSystems.map((system) => [system.key, system]));
  const seen = new Set();
  for (const system of systems) {
    assertExactKeys(system, ["key", "lectureIdsSha256", "storageObjectsManifestSha256"], `result.courseSystems.${system?.key ?? "unknown"}`);
    const source = expected.get(system.key);
    assert(source, `result has unsupported course system: ${system.key}`);
    assert(!seen.has(system.key), `result has duplicate course system: ${system.key}`);
    seen.add(system.key);
    assert(system.lectureIdsSha256 === source.lectureIdsSha256, `${system.key} result lecture ID hash mismatch`);
    assert(system.storageObjectsManifestSha256 === source.storage.objectsManifestSha256, `${system.key} result Storage manifest hash mismatch`);
  }
  assert(seen.size === expected.size, "result.courseSystems is incomplete");
}

/**
 * @param {any} context
 * @param {any} result
 * @param {any | null} [baseline]
 */
export function validateProductionBaselineResult(context, result, baseline = null) {
  assertExactKeys(result, ["schemaVersion", "stage", "manifestHash", "target", "stateHash", "courseSystems", "counts", "changes"], "result");
  assert(result.schemaVersion === RESULT_VERSION, `result.schemaVersion must be ${RESULT_VERSION}`);
  assert(["post_apply", "second_run"].includes(result.stage), "result.stage must be post_apply or second_run");
  assert(result.manifestHash === context.manifestHash, "result manifest hash mismatch");
  validateResultTarget(context, result.target);
  assertSha256(result.stateHash, "result.stateHash");
  validateResultSystems(context, result.courseSystems);
  assertExactObject(result.counts, EXPECTED_COUNTS, "result.counts");
  assertExactKeys(result.changes, Object.keys(ZERO_CHANGES), "result.changes");
  for (const key of Object.keys(ZERO_CHANGES)) assertNonNegativeInteger(result.changes[key], `result.changes.${key}`);
  assert(result.changes.hashDifferences === 0, "result.changes.hashDifferences must be 0");

  if (result.stage === "second_run") {
    assert(baseline, "a second_run result requires a post_apply baseline");
    const baselineSummary = validateProductionBaselineResult(context, baseline, null);
    assert(baseline.stage === "post_apply", "replay baseline must have stage post_apply");
    assert(result.stateHash === baseline.stateHash, "second_run state hash differs from the post_apply baseline");
    for (const [key, value] of Object.entries(ZERO_CHANGES)) {
      assert(result.changes[key] === value, `second_run changes.${key} must be ${value}`);
    }
    return { status: "passed", stage: result.stage, replayNoOp: true, stateHash: result.stateHash, baseline: baselineSummary.stage };
  }

  assert(!baseline, "a baseline is only accepted when validating second_run");
  return { status: "passed", stage: result.stage, replayNoOp: false, stateHash: result.stateHash };
}

/**
 * @param {any} context
 * @param {any | null} [resultSummary]
 */
export function buildProductionBaselinePlan(context, resultSummary = null) {
  const plan = {
    schemaVersion: PLAN_VERSION,
    manifestHash: context.manifestHash,
    mode: "plan-only",
    writesAllowed: false,
    source: {
      environment: context.manifest.source.environment,
      projectFingerprint: context.manifest.source.projectFingerprint,
      databaseFingerprint: context.manifest.source.databaseFingerprint,
    },
    target: {
      environment: "isolated-production-snapshot",
      projectFingerprint: context.manifest.target.projectFingerprint,
      databaseFingerprint: context.manifest.target.databaseFingerprint,
    },
    administrator: { manifestSha256: context.manifest.administrator.manifestSha256 },
    baseline: {
      courseSystems: context.courseSystems.map((system) => ({
        key: system.key,
        courseCount: system.courseCount,
        lectureCount: system.lectureCount,
        releaseCount: system.lectureCount * 2,
        lectureIdsSha256: system.lectureIdsSha256,
        storage: system.storage,
      })),
      explicitLectureIdsSha256: context.explicitLectureIdsSha256,
      expected: { ...EXPECTED_COUNTS },
    },
    phases: [
      { order: 1, action: "verify-isolated-target", writesAllowed: false },
      { order: 2, action: "verify-explicit-lecture-inventory", writesAllowed: false, expectedLectureCount: 1187 },
      { order: 3, action: "verify-storage-object-manifests", writesAllowed: false, expectedCourseSystemCount: 2 },
      { order: 4, action: "describe-account-and-operations-cleanup-boundary", writesAllowed: false },
      { order: 5, action: "describe-release-1-baseline", writesAllowed: false, expectedReleaseCount: 2374 },
      { order: 6, action: "require-second-run-no-op", writesAllowed: false, expectedChanges: { ...ZERO_CHANGES } },
    ],
    guards: {
      networkAllowed: false,
      databaseConnectionAllowed: false,
      sqlGenerationAllowed: false,
      productionWriteTargetAllowed: false,
      targetEnvironment: "isolated-production-snapshot",
      sourceTargetFingerprintMismatch: "stop",
      countMismatch: "stop",
      explicitIdMismatch: "stop",
      manifestHashMismatch: "stop",
      storageHashMismatch: "stop",
      replayDifference: "stop",
    },
    resultCheck: resultSummary ?? { status: "not_supplied", replayNoOp: false },
  };
  return { ...plan, planHash: sha256Text(canonicalJson(plan)) };
}

function parseCli(argv) {
  const options = {
    manifestPath: "docs/manifests/r1-production-baseline.example.json",
    resultPath: null,
    baselinePath: null,
  };
  let manifestSet = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--result" || argument === "--baseline") {
      const value = argv[index + 1];
      if (!value) fail(`${argument} requires a local JSON path`);
      if (argument === "--result") options.resultPath = value;
      else options.baselinePath = value;
      index += 1;
    } else if (argument.startsWith("-")) {
      fail(`unknown option: ${argument}`);
    } else if (!manifestSet) {
      options.manifestPath = argument;
      manifestSet = true;
    } else {
      fail(`unexpected argument: ${argument}`);
    }
  }
  if (options.baselinePath && !options.resultPath) fail("--baseline requires --result");
  return options;
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseCli(argv);
    const context = loadProductionBaselineContext({ manifestPath: options.manifestPath });
    let resultSummary = null;
    if (options.resultPath) {
      const result = readJson(path.resolve(options.resultPath), "production baseline result");
      const baseline = options.baselinePath ? readJson(path.resolve(options.baselinePath), "production baseline replay baseline") : null;
      resultSummary = validateProductionBaselineResult(context, result, baseline);
    }
    process.stdout.write(`${JSON.stringify(buildProductionBaselinePlan(context, resultSummary), null, 2)}\n`);
  } catch (error) {
    console.error(`Production baseline plan validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
