#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeNewlines, textFileSha256 } from "./lib/text-hash.mjs";

const MANIFEST_VERSION = "mathin-r1-courseware-source-manifest-v1";
const PLAN_VERSION = "mathin-r1-courseware-source-plan-v1";
const RELEASE_NOTE = "production-v1.0-baseline";
const TRACKS = ["native-16x9", "adapted-4x3"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACEHOLDER_ID = /^example-[a-z0-9][a-z0-9._:-]{2,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const FORBIDDEN_KEY = /password|secret|token|credential|service.?role|connection.?string|endpoint|(^|_)url$/i;
const URL_OR_CONNECTION = /(?:https?|postgres(?:ql)?):\/\//i;
const ASSET_KINDS = new Set(["image", "video", "audio", "svg", "h5"]);

const AIXUEXI_PRODUCTS = new Map([
  ["AXX26G-SJ-03-AUT", 3],
  ["AXX26G-SJ-04-AUT", 4],
  ["AXX26G-SJ-05-AUT", 5],
  ["AXX26G-SJ-06-AUT", 6],
]);
const AIXUEXI_LECTURE_NOS = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14];

const SYSTEM_SPECS = new Map([
  ["aixuexi-gplus-autumn", {
    courseCount: 4,
    lectureCount: 52,
    releaseCount: 104,
    versions: { default: { courseCount: 4, lectureCount: 52 } },
  }],
  ["e-series", {
    courseCount: 90,
    lectureCount: 1135,
    releaseCount: 2270,
    versions: {
      "2025": { courseCount: 54, lectureCount: 651 },
      "2026": { courseCount: 36, lectureCount: 484 },
    },
  }],
]);

const EXPECTED = Object.freeze({
  courseCount: 94,
  lectureCount: 1187,
  nativeTrackCount: 1187,
  adaptedTrackCount: 1187,
  releaseCount: 2374,
  missingBindingCount: 0,
  missingResourceCount: 0,
  storageHashMismatchCount: 0,
});

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function exactKeys(value, allowed, label) {
  assertObject(value, label);
  const actual = Object.keys(value);
  const extras = actual.filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !actual.includes(key));
  assert(extras.length === 0, `${label} has unsupported keys: ${extras.sort().join(", ")}`);
  assert(missing.length === 0, `${label} is missing keys: ${missing.sort().join(", ")}`);
}

function string(value, label, minimum = 1, maximum = 500) {
  assert(typeof value === "string" && value.length >= minimum && value.length <= maximum, `${label} must be a ${minimum}-${maximum} character string`);
  return value;
}

function integer(value, label, minimum = 0) {
  assert(Number.isSafeInteger(value) && value >= minimum, `${label} must be an integer >= ${minimum}`);
  return value;
}

function sha256(value, label) {
  assert(SHA256.test(value ?? ""), `${label} must be a lowercase SHA-256`);
  return value;
}

function stableId(value, label, example) {
  string(value, label, 3, 128);
  const valid = example ? PLACEHOLDER_ID.test(value) : UUID.test(value);
  assert(valid, `${label} must be ${example ? "an example-* placeholder" : "a UUID"}`);
  return value;
}

function scanForSensitiveMaterial(value, trail = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    assert(!FORBIDDEN_KEY.test(key), `${trail}.${key} must not describe credentials, connections, URLs, or endpoints`);
    if (typeof nested === "string") {
      assert(!URL_OR_CONNECTION.test(nested), `${trail}.${key} must not contain an endpoint or connection string`);
    }
    scanForSensitiveMaterial(nested, `${trail}.${key}`);
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalSha256(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

function resolveInputPath(root, manifestFile, declaredPath, label) {
  string(declaredPath, label, 3, 500);
  assert(!URL_OR_CONNECTION.test(declaredPath), `${label} must be a local filesystem path`);
  if (path.isAbsolute(declaredPath)) return path.resolve(declaredPath);
  const repositoryRelative = path.resolve(root, declaredPath);
  if (fs.existsSync(repositoryRelative)) return repositoryRelative;
  return path.resolve(path.dirname(manifestFile), declaredPath);
}

function normalizedResource(binding) {
  return {
    objectSha256: binding.objectSha256,
    kind: binding.kind,
    mime: binding.mime,
    byteCount: binding.byteCount,
    storageBucket: binding.storageBucket,
    storagePath: binding.storagePath,
    h5ManifestSha256: binding.h5ManifestSha256,
  };
}

export function deriveTrackDigests(pages) {
  const pageSet = pages.map((page) => ({
    pageNo: page.pageNo,
    pageDocId: page.pageDocId,
    sourceRevisionId: page.sourceRevisionId,
    docSha256: page.docSha256,
    documentBindingKeysSha256: page.documentBindingKeysSha256,
  }));
  const bindingSet = pages.flatMap((page) => page.bindings.map((binding) => ({
    pageNo: page.pageNo,
    pageDocId: page.pageDocId,
    bindingKey: binding.bindingKey,
    assetRevisionId: binding.assetRevisionId,
    objectSha256: binding.objectSha256,
  })));
  const resourceMap = new Map();
  for (const page of pages) {
    for (const binding of page.bindings) {
      const resource = normalizedResource(binding);
      const key = `${resource.storageBucket}\0${resource.storagePath}`;
      const existing = resourceMap.get(key);
      assert(!existing || canonicalJson(existing) === canonicalJson(resource), `resource identity drift at ${resource.storageBucket}/${resource.storagePath}`);
      resourceMap.set(key, resource);
    }
  }
  const resourceSet = [...resourceMap.values()].sort((left, right) => (
    `${left.storageBucket}\0${left.storagePath}`.localeCompare(`${right.storageBucket}\0${right.storagePath}`)
  ));
  const snapshot = pages.map((page) => ({
    pageDocId: page.pageDocId,
    revisionId: page.sourceRevisionId,
    bindings: page.bindings.map((binding) => ({
      bindingKey: binding.bindingKey,
      assetRevisionId: binding.assetRevisionId,
    })),
  }));
  return {
    pageSetSha256: canonicalSha256(pageSet),
    bindingSetSha256: canonicalSha256(bindingSet),
    resourceSetSha256: canonicalSha256(resourceSet),
    snapshotSha256: canonicalSha256(snapshot),
    resources: resourceSet,
  };
}

function validateBinding(binding, label, example, courseSystem, track) {
  exactKeys(binding, [
    "bindingKey", "assetRevisionId", "objectSha256", "kind", "role", "variant", "mime", "byteCount",
    "storageBucket", "storagePath", "h5ManifestSha256", "adaptationStatus",
  ], label);
  sha256(binding.bindingKey, `${label}.bindingKey`);
  stableId(binding.assetRevisionId, `${label}.assetRevisionId`, example);
  sha256(binding.objectSha256, `${label}.objectSha256`);
  assert(ASSET_KINDS.has(binding.kind), `${label}.kind is unsupported`);
  assert(/^[a-z][a-z0-9_-]{0,49}$/.test(binding.role ?? ""), `${label}.role is invalid`);
  assert(/^[a-z][a-z0-9._-]{0,79}$/.test(binding.variant ?? ""), `${label}.variant is invalid`);
  string(binding.mime, `${label}.mime`, 3, 160);
  integer(binding.byteCount, `${label}.byteCount`, 1);
  assert(["approved", "not-required"].includes(binding.adaptationStatus), `${label}.adaptationStatus is invalid`);

  if (binding.kind === "h5") {
    assert(binding.storageBucket === "cw-h5", `${label}.storageBucket must be cw-h5 for H5`);
    assert(binding.storagePath === `packages/${binding.objectSha256}`, `${label}.storagePath must be the content-addressed H5 package path`);
    assert(binding.mime === "application/x-mathin-h5-package", `${label}.mime must be the Mathin H5 package MIME`);
    sha256(binding.h5ManifestSha256, `${label}.h5ManifestSha256`);
  } else {
    assert(binding.storageBucket === "cw-objects", `${label}.storageBucket must be cw-objects for CAS objects`);
    assert(binding.storagePath === `sha256/${binding.objectSha256.slice(0, 2)}/${binding.objectSha256}`, `${label}.storagePath must be content addressed by objectSha256`);
    assert(binding.h5ManifestSha256 === null, `${label}.h5ManifestSha256 must be null outside H5`);
  }

  const requiresApproval = courseSystem === "e-series"
    && track === "adapted-4x3"
    && binding.role === "background"
    && binding.variant === "mathin-4x3";
  assert(
    binding.adaptationStatus === (requiresApproval ? "approved" : "not-required"),
    `${label}.adaptationStatus does not match the P6 adaptation gate`,
  );
  return binding;
}

function compareTuple(left, right) {
  return left.localeCompare(right);
}

function validatePage(page, label, example, courseSystem, track, globalState) {
  exactKeys(page, ["pageNo", "pageDocId", "sourceRevisionId", "docSha256", "documentBindingKeysSha256", "bindings"], label);
  integer(page.pageNo, `${label}.pageNo`, 1);
  stableId(page.pageDocId, `${label}.pageDocId`, example);
  stableId(page.sourceRevisionId, `${label}.sourceRevisionId`, example);
  sha256(page.docSha256, `${label}.docSha256`);
  sha256(page.documentBindingKeysSha256, `${label}.documentBindingKeysSha256`);
  assert(Array.isArray(page.bindings), `${label}.bindings must be an array`);

  const bindingOrder = [];
  const bindingKeys = new Set();
  for (let index = 0; index < page.bindings.length; index += 1) {
    const binding = validateBinding(page.bindings[index], `${label}.bindings[${index}]`, example, courseSystem, track);
    assert(!bindingKeys.has(binding.bindingKey), `${label} has a duplicate bindingKey`);
    bindingKeys.add(binding.bindingKey);
    bindingOrder.push(`${binding.bindingKey}\0${binding.assetRevisionId}`);
    const resource = normalizedResource(binding);
    const resourceKey = `${resource.storageBucket}\0${resource.storagePath}`;
    const priorResource = globalState.resources.get(resourceKey);
    assert(!priorResource || canonicalJson(priorResource) === canonicalJson(resource), `resource metadata drift at ${resource.storageBucket}/${resource.storagePath}`);
    globalState.resources.set(resourceKey, resource);
    const priorAssetRevision = globalState.assetRevisions.get(binding.assetRevisionId);
    assert(!priorAssetRevision || canonicalJson(priorAssetRevision) === canonicalJson(resource), `asset revision points to different resources: ${binding.assetRevisionId}`);
    globalState.assetRevisions.set(binding.assetRevisionId, resource);
  }
  assert(JSON.stringify(bindingOrder) === JSON.stringify([...bindingOrder].sort(compareTuple)), `${label}.bindings must be sorted by bindingKey and assetRevisionId`);
  assert(page.documentBindingKeysSha256 === canonicalSha256([...bindingKeys].sort()), `${label}.documentBindingKeysSha256 does not match the resolved binding keys`);

  const priorRevisionPage = globalState.revisionPages.get(page.sourceRevisionId);
  assert(!priorRevisionPage || priorRevisionPage === page.pageDocId, `source revision appears under different pages: ${page.sourceRevisionId}`);
  globalState.revisionPages.set(page.sourceRevisionId, page.pageDocId);
  return page;
}

function expectedReadiness(courseSystem, track) {
  if (courseSystem === "e-series") return track === "native-16x9" ? "native-source-verified" : "approved-adaptation";
  return track === "native-16x9" ? "verified-16x9-projection" : "verified-4x3-source-master";
}

function validateTrack(track, label, example, courseSystem, globalState) {
  exactKeys(track, ["track", "readiness", "pages", "pageSetSha256", "bindingSetSha256", "resourceSetSha256", "release"], label);
  assert(TRACKS.includes(track.track), `${label}.track is invalid`);
  assert(track.readiness === expectedReadiness(courseSystem, track.track), `${label}.readiness does not match ${courseSystem}/${track.track}`);
  assert(Array.isArray(track.pages) && track.pages.length > 0, `${label}.pages must be non-empty`);
  const pageOrder = [];
  const pageIds = new Set();
  for (let index = 0; index < track.pages.length; index += 1) {
    const page = validatePage(track.pages[index], `${label}.pages[${index}]`, example, courseSystem, track.track, globalState);
    assert(!pageIds.has(page.pageDocId), `${label} has a duplicate pageDocId`);
    pageIds.add(page.pageDocId);
    pageOrder.push(`${String(page.pageNo).padStart(8, "0")}\0${page.pageDocId}`);
  }
  assert(JSON.stringify(pageOrder) === JSON.stringify([...pageOrder].sort(compareTuple)), `${label}.pages must be sorted by pageNo and pageDocId`);

  for (const key of ["pageSetSha256", "bindingSetSha256", "resourceSetSha256"]) sha256(track[key], `${label}.${key}`);
  exactKeys(track.release, ["releaseNo", "note", "snapshotSha256"], `${label}.release`);
  assert(track.release.releaseNo === 1, `${label}.release.releaseNo must be 1`);
  assert(track.release.note === RELEASE_NOTE, `${label}.release.note must be ${RELEASE_NOTE}`);
  sha256(track.release.snapshotSha256, `${label}.release.snapshotSha256`);

  const derived = deriveTrackDigests(track.pages);
  for (const key of ["pageSetSha256", "bindingSetSha256", "resourceSetSha256"]) {
    assert(track[key] === derived[key], `${label}.${key} does not match the explicit page/binding/resource set`);
  }
  assert(track.release.snapshotSha256 === derived.snapshotSha256, `${label}.release.snapshotSha256 does not match the deterministic release snapshot`);
  return { ...track, resourceCount: derived.resources.length };
}

function validateCourse(entry, label, courseSystem) {
  exactKeys(entry.course, ["catalogVersion", "productCode", "grade"], `${label}.course`);
  const version = string(entry.course.catalogVersion, `${label}.course.catalogVersion`, 1, 40);
  const productCode = string(entry.course.productCode, `${label}.course.productCode`, 3, 160);
  integer(entry.course.grade, `${label}.course.grade`, 1);
  const spec = SYSTEM_SPECS.get(courseSystem);
  assert(Object.hasOwn(spec.versions, version), `${label}.course.catalogVersion is outside the production baseline`);
  if (courseSystem === "aixuexi-gplus-autumn") {
    assert(AIXUEXI_PRODUCTS.get(productCode) === entry.course.grade, `${label}.course must be one of the four fixed AIXUEXI G+ autumn products`);
  }
  return `${version}\0${productCode}`;
}

function validateLectureEntry(entry, label, example, expectedSystem, globalState) {
  exactKeys(entry, ["courseSystem", "course", "lecture", "source", "tracks"], label);
  assert(entry.courseSystem === expectedSystem, `${label}.courseSystem must be ${expectedSystem}`);
  const courseKey = validateCourse(entry, label, expectedSystem);
  exactKeys(entry.lecture, ["id", "no"], `${label}.lecture`);
  stableId(entry.lecture.id, `${label}.lecture.id`, example);
  integer(entry.lecture.no, `${label}.lecture.no`, 1);
  assert(!globalState.lectureIds.has(entry.lecture.id), `duplicate lecture ID: ${entry.lecture.id}`);
  globalState.lectureIds.add(entry.lecture.id);

  exactKeys(entry.source, ["packageManifestSha256", "lectureVerificationSha256", "offlineStatus"], `${label}.source`);
  sha256(entry.source.packageManifestSha256, `${label}.source.packageManifestSha256`);
  sha256(entry.source.lectureVerificationSha256, `${label}.source.lectureVerificationSha256`);
  assert(entry.source.offlineStatus === "complete", `${label}.source.offlineStatus must be complete`);

  assert(Array.isArray(entry.tracks) && entry.tracks.length === 2, `${label}.tracks must contain exactly two tracks`);
  assert(JSON.stringify(entry.tracks.map((track) => track.track)) === JSON.stringify(TRACKS), `${label}.tracks must be ordered native-16x9 then adapted-4x3`);
  const tracks = entry.tracks.map((track, index) => validateTrack(track, `${label}.tracks[${index}]`, example, expectedSystem, globalState));
  const nativePages = tracks[0].pages.map((page) => [page.pageNo, page.pageDocId]);
  const adaptedPages = tracks[1].pages.map((page) => [page.pageNo, page.pageDocId]);
  assert(canonicalJson(nativePages) === canonicalJson(adaptedPages), `${label} track page identities must match`);
  for (const [, pageDocId] of nativePages) {
    const owner = globalState.pageOwners.get(pageDocId);
    assert(!owner || owner === entry.lecture.id, `pageDocId appears in more than one lecture: ${pageDocId}`);
    globalState.pageOwners.set(pageDocId, entry.lecture.id);
  }

  if (expectedSystem === "aixuexi-gplus-autumn") {
    assert(AIXUEXI_LECTURE_NOS.includes(entry.lecture.no), `${label}.lecture.no must preserve the explicit 7/15 source gaps`);
  }
  return { ...entry, courseKey, tracks };
}

function parseNdjson(file, label) {
  const text = normalizeNewlines(fs.readFileSync(file, "utf8"));
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  assert(lines.length > 0, `${label} must not be empty`);
  return lines.map((line, index) => {
    assert(line.trim() === line && line.length > 0, `${label} line ${index + 1} must be one compact JSON object`);
    assert(Buffer.byteLength(line, "utf8") <= 4 * 1024 * 1024, `${label} line ${index + 1} exceeds 4 MiB`);
    try {
      return JSON.parse(line);
    } catch (error) {
      fail(`${label} line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
}

function summarizeVersions(entries) {
  const versions = new Map();
  for (const entry of entries) {
    const version = entry.course.catalogVersion;
    const summary = versions.get(version) ?? { courses: new Set(), lectureCount: 0 };
    summary.courses.add(entry.courseKey);
    summary.lectureCount += 1;
    versions.set(version, summary);
  }
  return versions;
}

function validateSystemCardinality(courseSystem, entries, example) {
  const spec = SYSTEM_SPECS.get(courseSystem);
  const courseKeys = new Set(entries.map((entry) => entry.courseKey));
  if (!example) {
    assert(courseKeys.size === spec.courseCount, `${courseSystem} must contain exactly ${spec.courseCount} courses`);
    assert(entries.length === spec.lectureCount, `${courseSystem} must contain exactly ${spec.lectureCount} lectures`);
    const versions = summarizeVersions(entries);
    for (const [version, expected] of Object.entries(spec.versions)) {
      const actual = versions.get(version);
      assert(actual?.courses.size === expected.courseCount, `${courseSystem}/${version} must contain ${expected.courseCount} courses`);
      assert(actual?.lectureCount === expected.lectureCount, `${courseSystem}/${version} must contain ${expected.lectureCount} lectures`);
    }
  }

  if (courseSystem === "aixuexi-gplus-autumn" && !example) {
    for (const [productCode, grade] of AIXUEXI_PRODUCTS) {
      const rows = entries.filter((entry) => entry.course.productCode === productCode);
      assert(rows.length === 13, `${productCode} must contain 13 lectures`);
      assert(rows.every((entry) => entry.course.grade === grade), `${productCode} grade mismatch`);
      assert(canonicalJson(rows.map((entry) => entry.lecture.no)) === canonicalJson(AIXUEXI_LECTURE_NOS), `${productCode} must preserve source gaps 7 and 15`);
    }
  }
  return { courseCount: courseKeys.size, lectureCount: entries.length, releaseCount: entries.length * 2 };
}

function collectResources(entries) {
  const resources = new Map();
  for (const entry of entries) {
    for (const track of entry.tracks) {
      for (const page of track.pages) {
        for (const binding of page.bindings) {
          const resource = normalizedResource(binding);
          resources.set(`${resource.storageBucket}\0${resource.storagePath}`, resource);
        }
      }
    }
  }
  return resources;
}

export function deriveStorageScope(entries, bucket) {
  const resources = [...collectResources(entries).values()]
    .filter((resource) => resource.storageBucket === bucket)
    .sort((left, right) => left.storagePath.localeCompare(right.storagePath));
  return { scopeResourceCount: resources.length, scopeResourceSetSha256: canonicalSha256(resources) };
}

function validateStorageAudits(manifest, entries) {
  assert(Array.isArray(manifest.storageAudits) && manifest.storageAudits.length === 2, "storageAudits must contain cw-h5 and cw-objects");
  assert(canonicalJson(manifest.storageAudits.map((audit) => audit.bucket)) === canonicalJson(["cw-h5", "cw-objects"]), "storageAudits must be ordered cw-h5 then cw-objects");
  const normalized = [];
  for (const audit of manifest.storageAudits) {
    const label = `storageAudits.${audit?.bucket ?? "unknown"}`;
    exactKeys(audit, ["bucket", "prefix", "status", "scopeResourceCount", "scopeResourceSetSha256", "objectsManifestSha256", "missingObjectCount", "hashMismatchCount"], label);
    assert(["cw-h5", "cw-objects"].includes(audit.bucket), `${label}.bucket is unsupported`);
    assert(audit.prefix === (audit.bucket === "cw-h5" ? "packages/" : "sha256/"), `${label}.prefix is invalid`);
    assert(["pending", "passed"].includes(audit.status), `${label}.status is invalid`);
    integer(audit.scopeResourceCount, `${label}.scopeResourceCount`);
    sha256(audit.scopeResourceSetSha256, `${label}.scopeResourceSetSha256`);
    sha256(audit.objectsManifestSha256, `${label}.objectsManifestSha256`);
    integer(audit.missingObjectCount, `${label}.missingObjectCount`);
    integer(audit.hashMismatchCount, `${label}.hashMismatchCount`);
    const derived = deriveStorageScope(entries, audit.bucket);
    assert(audit.scopeResourceCount === derived.scopeResourceCount, `${label}.scopeResourceCount does not match explicit resources`);
    assert(audit.scopeResourceSetSha256 === derived.scopeResourceSetSha256, `${label}.scopeResourceSetSha256 does not match explicit resources`);
    if (!manifest.example) {
      assert(audit.status === "passed", `${label}.status must be passed`);
      assert(audit.missingObjectCount === 0, `${label}.missingObjectCount must be 0`);
      assert(audit.hashMismatchCount === 0, `${label}.hashMismatchCount must be 0`);
      assert(!/^([0-9a-f])\1{63}$/.test(audit.objectsManifestSha256), `${label}.objectsManifestSha256 must not be a placeholder`);
    }
    normalized.push({ ...audit });
  }
  return normalized;
}

function validateExpected(expected) {
  exactKeys(expected, Object.keys(EXPECTED), "expected");
  for (const [key, value] of Object.entries(EXPECTED)) assert(expected[key] === value, `expected.${key} must be ${value}`);
}

export function loadCoursewareSourceContext({
  root = process.cwd(),
  manifestPath = "docs/manifests/r1-courseware-source.example.json",
} = {}) {
  const repositoryRoot = path.resolve(root);
  const manifestFile = path.isAbsolute(manifestPath) ? path.resolve(manifestPath) : path.resolve(repositoryRoot, manifestPath);
  assert(fs.existsSync(manifestFile), `courseware source manifest not found: ${manifestPath}`);
  const manifest = readJson(manifestFile, "courseware source manifest");
  exactKeys(manifest, ["$schema", "schemaVersion", "example", "mode", "writesAllowed", "networkAllowed", "databaseConnectionAllowed", "capturedFrom", "inventories", "storageAudits", "expected"], "courseware source manifest");
  assert(manifest.schemaVersion === MANIFEST_VERSION, `schemaVersion must be ${MANIFEST_VERSION}`);
  assert(typeof manifest.example === "boolean", "example must be boolean");
  assert(manifest.mode === "plan-only", "mode must be plan-only");
  assert(manifest.writesAllowed === false, "writesAllowed must be false");
  assert(manifest.networkAllowed === false, "networkAllowed must be false");
  assert(manifest.databaseConnectionAllowed === false, "databaseConnectionAllowed must be false");
  scanForSensitiveMaterial(manifest);

  const schemaFile = path.join(repositoryRoot, "schemas", "r1-courseware-source-manifest.schema.json");
  const declaredSchema = path.isAbsolute(manifest.$schema ?? "")
    ? path.resolve(manifest.$schema)
    : path.resolve(path.dirname(manifestFile), manifest.$schema ?? "");
  assert(declaredSchema === schemaFile, "manifest $schema must reference schemas/r1-courseware-source-manifest.schema.json");

  exactKeys(manifest.capturedFrom, ["environment", "readOnly", "databaseFingerprint", "migrationHead", "exportedAt"], "capturedFrom");
  assert(manifest.capturedFrom.environment === "offline-read-only-export", "capturedFrom.environment must be offline-read-only-export");
  assert(manifest.capturedFrom.readOnly === true, "capturedFrom.readOnly must be true");
  sha256(manifest.capturedFrom.databaseFingerprint, "capturedFrom.databaseFingerprint");
  assert(/^\d{14}_[a-z0-9_]+$/.test(manifest.capturedFrom.migrationHead ?? ""), "capturedFrom.migrationHead is invalid");
  assert(ISO_DATE_TIME.test(manifest.capturedFrom.exportedAt ?? ""), "capturedFrom.exportedAt must be an ISO UTC date-time");
  if (!manifest.example) assert(!/^([0-9a-f])\1{63}$/.test(manifest.capturedFrom.databaseFingerprint), "capturedFrom.databaseFingerprint must not be a placeholder");

  assert(Array.isArray(manifest.inventories) && manifest.inventories.length === 2, "inventories must contain exactly two systems");
  assert(canonicalJson(manifest.inventories.map((item) => item.courseSystem)) === canonicalJson([...SYSTEM_SPECS.keys()]), "inventories must be ordered aixuexi-gplus-autumn then e-series");
  const globalState = {
    lectureIds: new Set(),
    pageOwners: new Map(),
    revisionPages: new Map(),
    assetRevisions: new Map(),
    resources: new Map(),
  };
  const systems = [];
  const allEntries = [];
  for (const inventory of manifest.inventories) {
    const label = `inventories.${inventory?.courseSystem ?? "unknown"}`;
    exactKeys(inventory, ["courseSystem", "path", "sha256"], label);
    assert(SYSTEM_SPECS.has(inventory.courseSystem), `${label}.courseSystem is unsupported`);
    sha256(inventory.sha256, `${label}.sha256`);
    const inventoryFile = resolveInputPath(repositoryRoot, manifestFile, inventory.path, `${label}.path`);
    assert(fs.existsSync(inventoryFile), `${label}.path does not exist`);
    assert(textFileSha256(inventoryFile) === inventory.sha256, `${label}.sha256 does not match the LF-normalized inventory file`);
    const rawEntries = parseNdjson(inventoryFile, label);
    const order = [];
    const entries = rawEntries.map((entry, index) => {
      const normalized = validateLectureEntry(entry, `${label}[${index}]`, manifest.example, inventory.courseSystem, globalState);
      order.push(`${normalized.courseKey}\0${String(normalized.lecture.no).padStart(8, "0")}\0${normalized.lecture.id}`);
      return normalized;
    });
    assert(canonicalJson(order) === canonicalJson([...order].sort(compareTuple)), `${label} entries must be sorted by catalogVersion, productCode, lectureNo, and lectureId`);
    const counts = validateSystemCardinality(inventory.courseSystem, entries, manifest.example);
    systems.push({
      key: inventory.courseSystem,
      inventorySha256: inventory.sha256,
      courseCount: counts.courseCount,
      lectureCount: counts.lectureCount,
      nativeTrackCount: entries.length,
      adaptedTrackCount: entries.length,
      releaseCount: counts.releaseCount,
      entrySetSha256: canonicalSha256(entries.map((entry) => ({
        courseKey: entry.courseKey,
        lectureId: entry.lecture.id,
        lectureNo: entry.lecture.no,
        nativeSnapshotSha256: entry.tracks[0].release.snapshotSha256,
        adaptedSnapshotSha256: entry.tracks[1].release.snapshotSha256,
      }))),
    });
    allEntries.push(...entries);
  }

  validateExpected(manifest.expected);
  const storageAudits = validateStorageAudits(manifest, allEntries);
  const actual = {
    courseCount: systems.reduce((sum, system) => sum + system.courseCount, 0),
    lectureCount: systems.reduce((sum, system) => sum + system.lectureCount, 0),
    nativeTrackCount: systems.reduce((sum, system) => sum + system.nativeTrackCount, 0),
    adaptedTrackCount: systems.reduce((sum, system) => sum + system.adaptedTrackCount, 0),
    releaseCount: systems.reduce((sum, system) => sum + system.releaseCount, 0),
    missingBindingCount: 0,
    missingResourceCount: storageAudits.reduce((sum, audit) => sum + audit.missingObjectCount, 0),
    storageHashMismatchCount: storageAudits.reduce((sum, audit) => sum + audit.hashMismatchCount, 0),
  };
  if (!manifest.example) {
    for (const [key, expected] of Object.entries(EXPECTED)) assert(actual[key] === expected, `actual.${key} must be ${expected}`);
  }

  const blockers = [];
  if (manifest.example) blockers.push("example-manifest");
  for (const system of systems) {
    const expected = SYSTEM_SPECS.get(system.key);
    if (system.courseCount !== expected.courseCount || system.lectureCount !== expected.lectureCount) blockers.push(`incomplete-inventory:${system.key}`);
  }
  for (const audit of storageAudits) if (audit.status !== "passed") blockers.push(`storage-audit-pending:${audit.bucket}`);

  return {
    root: repositoryRoot,
    manifest,
    manifestFile,
    manifestHash: textFileSha256(manifestFile),
    systems,
    storageAudits,
    actual,
    blockers,
    contentStateSha256: canonicalSha256({
      systems: systems.map((system) => ({ key: system.key, entrySetSha256: system.entrySetSha256 })),
      storage: storageAudits.map((audit) => ({ bucket: audit.bucket, scopeResourceSetSha256: audit.scopeResourceSetSha256, objectsManifestSha256: audit.objectsManifestSha256 })),
    }),
  };
}

export function buildCoursewareSourcePlan(context) {
  const plan = {
    schemaVersion: PLAN_VERSION,
    mode: "plan-only",
    writesAllowed: false,
    networkAllowed: false,
    databaseConnectionAllowed: false,
    manifestHash: context.manifestHash,
    contentStateSha256: context.contentStateSha256,
    expected: { ...EXPECTED },
    actual: { ...context.actual },
    courseSystems: context.systems.map((system) => ({
      key: system.key,
      courseCount: system.courseCount,
      lectureCount: system.lectureCount,
      nativeTrackCount: system.nativeTrackCount,
      adaptedTrackCount: system.adaptedTrackCount,
      releaseCount: system.releaseCount,
      inventorySha256: system.inventorySha256,
      entrySetSha256: system.entrySetSha256,
    })),
    storage: context.storageAudits.map((audit) => ({ ...audit })),
    releaseTarget: {
      releaseNo: 1,
      note: RELEASE_NOTE,
      count: 2374,
      legacyNativeHeadCount: 1187,
    },
    blockers: [...context.blockers],
    p6SourceManifestReady: context.blockers.length === 0,
    stageClosureAllowed: false,
    guards: {
      productionConnectionAllowed: false,
      sqlGenerationAllowed: false,
      cleanupExecutionAllowed: false,
      releaseExecutionAllowed: false,
      explicitLectureInventory: "required",
      exactTwoTracksPerLecture: "required",
      sourceRevisionAndBindingResolution: "required",
      contentAddressedStoragePaths: "required",
      h5PackageManifestHash: "required",
      adaptedBackgroundApproval: "required-for-e-series-mathin-4x3-backgrounds",
      storageMissingOrHashMismatch: "stop",
      countOrSnapshotHashMismatch: "stop",
    },
  };
  return { ...plan, planHash: canonicalSha256(plan) };
}

export function main(argv = process.argv.slice(2)) {
  try {
    assert(argv.length <= 1, "usage: plan-r1-courseware-source.mjs [manifest.json]");
    const context = loadCoursewareSourceContext({ manifestPath: argv[0] ?? undefined });
    process.stdout.write(`${JSON.stringify(buildCoursewareSourcePlan(context), null, 2)}\n`);
  } catch (error) {
    console.error(`R1 courseware source preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
