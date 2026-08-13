#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeNewlines, textFileSha256 } from "./lib/text-hash.mjs";

const MANIFEST_VERSION = "mathin-r1-courseware-source-manifest-v4";
const PLAN_VERSION = "mathin-r1-courseware-source-plan-v4";
const RELEASE_NOTE = "production-v1.0-baseline";
const TRACKS = ["native-16x9", "adapted-4x3"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const PLACEHOLDER_SHA256 = /^([0-9a-f])\1{63}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const FORBIDDEN_KEY = /password|secret|token|credential|service.?role|connection.?string|endpoint|(^|_)url$/i;
const URL_OR_CONNECTION = /(?:https?|postgres(?:ql)?):\/\//i;
const ASSET_KINDS = new Set(["image", "video", "audio", "svg", "h5"]);
const PATH_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const E_SERIES_ROSTER_PATH = "supabase/seed/teaching-plans.json";
const E_SERIES_ROSTER_SHA256 = "6f89722d555d32600826a85a0ebcd31f72dd163b8f5ffa62d15fd6b7012cfe08";
const E_SERIES_PACKAGES = Object.freeze({
  baseline: {
    packageKey: "mofaxiao-e-math-baseline-2026-07-17",
    packageVersion: "2490b13a-44cc-4b34-a68f-e45df77c5c45",
  },
  autumn2026: {
    packageKey: "mofaxiao-e-math-2026-autumn-2026-08-03",
    packageVersion: "8a4001a9-2ab7-47a8-ac7b-3c004d427682",
  },
});

const AIXUEXI_FULL_LECTURE_NOS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const AIXUEXI_GAP_LECTURE_NOS = Object.freeze([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14]);
const AIXUEXI_PRODUCTS = new Map([
  ["AXX26G-SJ-03-AUT", { grade: 3, packageKey: "2026-gplus-sujiao-math", lectureNos: AIXUEXI_FULL_LECTURE_NOS }],
  ["AXX26G-SJ-04-AUT", { grade: 4, packageKey: "2026-gplus-sujiao-math", lectureNos: AIXUEXI_FULL_LECTURE_NOS }],
  ["AXX26G-SJ-05-AUT", { grade: 5, packageKey: "2026-gplus-sujiao-math", lectureNos: AIXUEXI_GAP_LECTURE_NOS }],
  ["AXX26G-SJ-06-AUT", { grade: 6, packageKey: "2026-gplus-sujiao-math", lectureNos: AIXUEXI_GAP_LECTURE_NOS }],
  ["AXX26X-SJ-01-AUT", { grade: 1, packageKey: "2026-xplus-sujiao-math", lectureNos: AIXUEXI_FULL_LECTURE_NOS }],
  ["AXX26X-SJ-02-AUT", { grade: 2, packageKey: "2026-xplus-sujiao-math", lectureNos: AIXUEXI_GAP_LECTURE_NOS }],
  ["AXX26X-SJ-03-AUT", { grade: 3, packageKey: "2026-xplus-sujiao-math", lectureNos: AIXUEXI_FULL_LECTURE_NOS }],
  ["AXX26X-SJ-04-AUT", { grade: 4, packageKey: "2026-xplus-sujiao-math", lectureNos: AIXUEXI_FULL_LECTURE_NOS }],
  ["AXX26X-SJ-05-AUT", { grade: 5, packageKey: "2026-xplus-sujiao-math", lectureNos: AIXUEXI_GAP_LECTURE_NOS }],
  ["AXX26X-SJ-06-AUT", { grade: 6, packageKey: "2026-xplus-sujiao-math", lectureNos: AIXUEXI_GAP_LECTURE_NOS }],
  ["AXX26A-QG-01-AUT", { grade: 1, packageKey: "2026-aplus-quanguo-math", lectureNos: AIXUEXI_FULL_LECTURE_NOS }],
  ["AXX26A-QG-02-AUT", { grade: 2, packageKey: "2026-aplus-quanguo-math", lectureNos: AIXUEXI_FULL_LECTURE_NOS }],
]);

const SYSTEM_SPECS = new Map([
  ["aixuexi-autumn", {
    courseCount: 12,
    lectureCount: 170,
    releaseCount: 340,
    versions: { default: { courseCount: 12, lectureCount: 170 } },
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
  courseCount: 102,
  lectureCount: 1305,
  nativeTrackCount: 1305,
  adaptedTrackCount: 1305,
  releaseCount: 2610,
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
  assert(!PLACEHOLDER_SHA256.test(value), `${label} must not be a repeated-character placeholder`);
  return value;
}

function stableId(value, label) {
  string(value, label, 3, 128);
  assert(UUID.test(value), `${label} must be a UUID`);
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

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertLocalRoot(root, label) {
  assert(typeof root === "string" && root.length > 0, `${label} must be a local directory`);
  assert(!root.startsWith("\\\\") && !root.startsWith("//"), `${label} must not be a UNC path`);
  const resolved = path.resolve(root);
  assert(!resolved.startsWith("\\\\") && !resolved.startsWith("//"), `${label} must not be a UNC path`);
  return resolved;
}

function safeRelativePath(declaredPath, label) {
  string(declaredPath, label, 3, 500);
  assert(!declaredPath.includes("\\"), `${label} must use repository-relative forward slashes`);
  assert(!PATH_SCHEME.test(declaredPath), `${label} must not be a URI or drive-qualified path`);
  assert(!path.posix.isAbsolute(declaredPath) && !path.win32.isAbsolute(declaredPath), `${label} must not be absolute or UNC`);
  return declaredPath;
}

function resolveUnderRoots(primaryRoot, declaredPath, label, approvedArtifactRoots = []) {
  safeRelativePath(declaredPath, label);
  const roots = [primaryRoot, ...approvedArtifactRoots].map((root, index) => assertLocalRoot(root, `${label} root[${index}]`));
  for (const candidateRoot of roots) {
    const candidate = path.resolve(candidateRoot, declaredPath);
    assert(isWithin(candidateRoot, candidate), `${label} must remain inside the repository or an approved artifact root`);
    if (!fs.existsSync(candidate)) continue;
    const realRoot = fs.realpathSync(candidateRoot);
    const realCandidate = fs.realpathSync(candidate);
    assert(isWithin(realRoot, realCandidate), `${label} resolves outside the repository or approved artifact root`);
    return realCandidate;
  }
  return path.resolve(roots[0], declaredPath);
}

function resolveInputPath(root, declaredPath, label, approvedArtifactRoots = []) {
  return resolveUnderRoots(root, declaredPath, label, approvedArtifactRoots);
}

function normalizedResource(binding) {
  return {
    objectSha256: binding.objectSha256,
    kind: binding.kind,
    mime: binding.mime,
    byteCount: binding.byteCount,
    storageBucket: binding.storageBucket,
    storagePath: binding.storagePath,
    h5ManifestPath: binding.h5ManifestPath,
    h5ManifestSha256: binding.h5ManifestSha256,
  };
}

export function deriveReleaseSnapshot(pages) {
  return pages.map((page) => ({
    pageDocId: page.pageDocId,
    revisionId: page.sourceRevisionId,
    bindings: page.bindings.map((binding) => ({
      bindingKey: binding.bindingKey,
      assetRevisionId: binding.assetRevisionId,
      launchQuery: binding.launchQuery,
    })),
    learningCheckEnabled: page.learningCheckEnabled,
  }));
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
  const snapshot = deriveReleaseSnapshot(pages);
  return {
    pageSetSha256: canonicalSha256(pageSet),
    bindingSetSha256: canonicalSha256(bindingSet),
    resourceSetSha256: canonicalSha256(resourceSet),
    snapshotSha256: canonicalSha256(snapshot),
    resources: resourceSet,
  };
}

function validateH5ManifestEvidence(binding, label, globalState) {
  const manifestFile = resolveInputPath(
    globalState.repositoryRoot,
    binding.h5ManifestPath,
    `${label}.h5ManifestPath`,
    globalState.approvedArtifactRoots,
  );
  assert(fs.existsSync(manifestFile), `${label}.h5ManifestPath does not exist`);
  assert(textFileSha256(manifestFile) === binding.h5ManifestSha256, `${label}.h5ManifestSha256 does not match the LF-normalized H5 package manifest`);
  const packageManifest = assertObject(readJson(manifestFile, `${label}.h5ManifestPath`), `${label}.h5ManifestPath`);
  assert(packageManifest.schemaVersion === "mathin-h5-manifest-v1", `${label}.h5ManifestPath must use mathin-h5-manifest-v1`);
  assert(packageManifest.packageHash === binding.objectSha256, `${label}.h5ManifestPath packageHash must match objectSha256`);
  assert(packageManifest.byteCount === binding.byteCount, `${label}.h5ManifestPath byteCount must match the H5 package resource`);
  safeRelativePath(packageManifest.entryPath, `${label}.h5ManifestPath.entryPath`);
  assert(Array.isArray(packageManifest.files) && packageManifest.files.length > 0, `${label}.h5ManifestPath.files must be non-empty`);
  let packageByteCount = 0;
  const packagePaths = new Set();
  for (let index = 0; index < packageManifest.files.length; index += 1) {
    const file = packageManifest.files[index];
    const fileLabel = `${label}.h5ManifestPath.files[${index}]`;
    exactKeys(file, ["packagePath", "sha256", "byteCount", "mime"], fileLabel);
    safeRelativePath(file.packagePath, `${fileLabel}.packagePath`);
    sha256(file.sha256, `${fileLabel}.sha256`);
    integer(file.byteCount, `${fileLabel}.byteCount`, 0);
    string(file.mime, `${fileLabel}.mime`, 3, 160);
    assert(!packagePaths.has(file.packagePath), `${label}.h5ManifestPath has duplicate packagePath ${file.packagePath}`);
    packagePaths.add(file.packagePath);
    packageByteCount += file.byteCount;
  }
  assert(packagePaths.has(packageManifest.entryPath), `${label}.h5ManifestPath.entryPath must be listed in files`);
  assert(packageByteCount === packageManifest.byteCount, `${label}.h5ManifestPath file byte counts must sum to byteCount`);
  const prior = globalState.h5Manifests.get(binding.h5ManifestPath);
  assert(!prior || prior === binding.h5ManifestSha256, `${label}.h5ManifestPath is associated with different hashes`);
  globalState.h5Manifests.set(binding.h5ManifestPath, binding.h5ManifestSha256);
}

function validateLaunchQuery(value, label) {
  exactKeys(value, ["query", "coursewareIdParam"], label);
  assertObject(value.query, `${label}.query`);
  const queryKeys = Object.keys(value.query);
  assert(queryKeys.length <= 100, `${label}.query has too many keys`);
  for (const key of queryKeys) {
    string(key, `${label}.query key`, 1, 100);
    const values = value.query[key];
    assert(Array.isArray(values) && values.length <= 100, `${label}.query.${key} must be an array with at most 100 values`);
    values.forEach((entry, index) => string(entry, `${label}.query.${key}[${index}]`, 0, 500));
  }
  assert(
    value.coursewareIdParam === null
      || (typeof value.coursewareIdParam === "string" && value.coursewareIdParam.length >= 1 && value.coursewareIdParam.length <= 100),
    `${label}.coursewareIdParam must be string|null`,
  );
  return value;
}

function validateBinding(binding, label, courseSystem, track, globalState) {
  exactKeys(binding, [
    "bindingKey", "assetRevisionId", "objectSha256", "kind", "role", "variant", "mime", "byteCount",
    "storageBucket", "storagePath", "h5ManifestPath", "h5ManifestSha256", "launchQuery", "adaptationStatus",
  ], label);
  sha256(binding.bindingKey, `${label}.bindingKey`);
  stableId(binding.assetRevisionId, `${label}.assetRevisionId`);
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
    safeRelativePath(binding.h5ManifestPath, `${label}.h5ManifestPath`);
    sha256(binding.h5ManifestSha256, `${label}.h5ManifestSha256`);
    validateLaunchQuery(binding.launchQuery, `${label}.launchQuery`);
    validateH5ManifestEvidence(binding, label, globalState);
  } else {
    assert(binding.storageBucket === "cw-objects", `${label}.storageBucket must be cw-objects for CAS objects`);
    assert(binding.storagePath === `sha256/${binding.objectSha256.slice(0, 2)}/${binding.objectSha256}`, `${label}.storagePath must be content addressed by objectSha256`);
    assert(binding.h5ManifestPath === null, `${label}.h5ManifestPath must be null outside H5`);
    assert(binding.h5ManifestSha256 === null, `${label}.h5ManifestSha256 must be null outside H5`);
    assert(binding.launchQuery === null, `${label}.launchQuery must be null outside H5`);
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

function validatePage(page, label, courseSystem, track, globalState) {
  exactKeys(page, ["pageNo", "pageDocId", "sourceRevisionId", "docSha256", "learningCheckEnabled", "requiredBindingKeys", "documentBindingKeysSha256", "bindings"], label);
  integer(page.pageNo, `${label}.pageNo`, 1);
  stableId(page.pageDocId, `${label}.pageDocId`);
  stableId(page.sourceRevisionId, `${label}.sourceRevisionId`);
  sha256(page.docSha256, `${label}.docSha256`);
  assert(typeof page.learningCheckEnabled === "boolean", `${label}.learningCheckEnabled must be a boolean`);
  assert(Array.isArray(page.requiredBindingKeys) && page.requiredBindingKeys.length > 0, `${label}.requiredBindingKeys must be non-empty`);
  const requiredBindingKeys = page.requiredBindingKeys.map((key, index) => sha256(key, `${label}.requiredBindingKeys[${index}]`));
  assert(new Set(requiredBindingKeys).size === requiredBindingKeys.length, `${label}.requiredBindingKeys must be unique`);
  assert(canonicalJson(requiredBindingKeys) === canonicalJson([...requiredBindingKeys].sort()), `${label}.requiredBindingKeys must be sorted`);
  sha256(page.documentBindingKeysSha256, `${label}.documentBindingKeysSha256`);
  assert(page.documentBindingKeysSha256 === canonicalSha256(requiredBindingKeys), `${label}.documentBindingKeysSha256 does not match requiredBindingKeys`);
  assert(Array.isArray(page.bindings) && page.bindings.length > 0, `${label}.bindings must be non-empty`);

  const bindingOrder = [];
  const bindingKeys = new Set();
  for (let index = 0; index < page.bindings.length; index += 1) {
    const binding = validateBinding(page.bindings[index], `${label}.bindings[${index}]`, courseSystem, track, globalState);
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
  const missingBindingKeys = requiredBindingKeys.filter((key) => !bindingKeys.has(key));
  globalState.missingBindingCount += missingBindingKeys.length;
  assert(missingBindingKeys.length === 0, `${label} is missing required bindings: ${missingBindingKeys.join(", ")}`);
  const extraBindingKeys = [...bindingKeys].filter((key) => !requiredBindingKeys.includes(key));
  assert(extraBindingKeys.length === 0, `${label} has bindings outside requiredBindingKeys: ${extraBindingKeys.join(", ")}`);

  const priorRevisionPage = globalState.revisionPages.get(page.sourceRevisionId);
  assert(!priorRevisionPage || priorRevisionPage === page.pageDocId, `source revision appears under different pages: ${page.sourceRevisionId}`);
  globalState.revisionPages.set(page.sourceRevisionId, page.pageDocId);
  return page;
}

function expectedReadiness(courseSystem, track) {
  if (courseSystem === "e-series") return track === "native-16x9" ? "native-source-verified" : "approved-adaptation";
  return track === "native-16x9" ? "verified-16x9-projection" : "verified-4x3-source-master";
}

function validateTrack(track, label, courseSystem, globalState) {
  exactKeys(track, ["track", "readiness", "pages", "pageSetSha256", "bindingSetSha256", "resourceSetSha256", "capturedRelease", "release"], label);
  assert(TRACKS.includes(track.track), `${label}.track is invalid`);
  assert(track.readiness === expectedReadiness(courseSystem, track.track), `${label}.readiness does not match ${courseSystem}/${track.track}`);
  assert(Array.isArray(track.pages) && track.pages.length > 0, `${label}.pages must be non-empty`);
  const pageOrder = [];
  const pageIds = new Set();
  for (let index = 0; index < track.pages.length; index += 1) {
    const page = validatePage(track.pages[index], `${label}.pages[${index}]`, courseSystem, track.track, globalState);
    assert(!pageIds.has(page.pageDocId), `${label} has a duplicate pageDocId`);
    pageIds.add(page.pageDocId);
    pageOrder.push(`${String(page.pageNo).padStart(8, "0")}\0${page.pageDocId}`);
  }
  assert(JSON.stringify(pageOrder) === JSON.stringify([...pageOrder].sort(compareTuple)), `${label}.pages must be sorted by pageNo and pageDocId`);

  for (const key of ["pageSetSha256", "bindingSetSha256", "resourceSetSha256"]) sha256(track[key], `${label}.${key}`);
  exactKeys(track.capturedRelease, ["id", "releaseNo", "rawSnapshotSha256", "snapshotSha256"], `${label}.capturedRelease`);
  stableId(track.capturedRelease.id, `${label}.capturedRelease.id`);
  assert(!globalState.sourceReleaseIds.has(track.capturedRelease.id), `${label}.capturedRelease.id is selected by more than one track head`);
  globalState.sourceReleaseIds.add(track.capturedRelease.id);
  integer(track.capturedRelease.releaseNo, `${label}.capturedRelease.releaseNo`, 1);
  sha256(track.capturedRelease.rawSnapshotSha256, `${label}.capturedRelease.rawSnapshotSha256`);
  sha256(track.capturedRelease.snapshotSha256, `${label}.capturedRelease.snapshotSha256`);
  exactKeys(track.release, ["releaseNo", "note", "snapshotSha256"], `${label}.release`);
  assert(track.release.releaseNo === 1, `${label}.release.releaseNo must be 1`);
  assert(track.release.note === RELEASE_NOTE, `${label}.release.note must be ${RELEASE_NOTE}`);
  sha256(track.release.snapshotSha256, `${label}.release.snapshotSha256`);

  const derived = deriveTrackDigests(track.pages);
  for (const key of ["pageSetSha256", "bindingSetSha256", "resourceSetSha256"]) {
    assert(track[key] === derived[key], `${label}.${key} does not match the explicit page/binding/resource set`);
  }
  assert(track.capturedRelease.snapshotSha256 === derived.snapshotSha256, `${label}.capturedRelease.snapshotSha256 does not match the normalized current release projection`);
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
  if (courseSystem === "aixuexi-autumn") {
    assert(AIXUEXI_PRODUCTS.get(productCode)?.grade === entry.course.grade, `${label}.course must be one of the twelve fixed AIXUEXI v31 autumn products`);
  }
  return `${version}\0${productCode}`;
}

function validateLectureEntry(entry, label, expectedSystem, globalState) {
  exactKeys(entry, ["courseSystem", "course", "lecture", "source", "tracks"], label);
  assert(entry.courseSystem === expectedSystem, `${label}.courseSystem must be ${expectedSystem}`);
  const courseKey = validateCourse(entry, label, expectedSystem);
  exactKeys(entry.lecture, ["id", "no"], `${label}.lecture`);
  stableId(entry.lecture.id, `${label}.lecture.id`);
  integer(entry.lecture.no, `${label}.lecture.no`, 1);
  assert(!globalState.lectureIds.has(entry.lecture.id), `duplicate lecture ID: ${entry.lecture.id}`);
  globalState.lectureIds.add(entry.lecture.id);
  const naturalLectureKey = `${courseKey}\0${String(entry.lecture.no).padStart(8, "0")}`;
  assert(!globalState.naturalLectureKeys.has(naturalLectureKey), `${label} duplicates the fixed (course, lecture.no) identity`);
  globalState.naturalLectureKeys.add(naturalLectureKey);

  exactKeys(entry.source, ["packageKey", "packageVersion", "packageManifestSha256", "lectureVerificationSha256", "offlineStatus"], `${label}.source`);
  string(entry.source.packageKey, `${label}.source.packageKey`, 3, 160);
  string(entry.source.packageVersion, `${label}.source.packageVersion`, 3, 160);
  sha256(entry.source.packageManifestSha256, `${label}.source.packageManifestSha256`);
  sha256(entry.source.lectureVerificationSha256, `${label}.source.lectureVerificationSha256`);
  assert(entry.source.offlineStatus === "complete", `${label}.source.offlineStatus must be complete`);
  const packageIdentity = `${entry.source.packageKey}\0${entry.source.packageVersion}`;
  const priorPackageHash = globalState.sourcePackageHashes.get(packageIdentity);
  assert(!priorPackageHash || priorPackageHash === entry.source.packageManifestSha256, `${label}.source.packageManifestSha256 drifts within one fixed source package`);
  globalState.sourcePackageHashes.set(packageIdentity, entry.source.packageManifestSha256);

  if (expectedSystem === "aixuexi-autumn") {
    const product = AIXUEXI_PRODUCTS.get(entry.course.productCode);
    assert(product.packageKey === entry.source.packageKey, `${label}.source.packageKey does not match the fixed AIXUEXI product`);
    assert(product.lectureNos.includes(entry.lecture.no), `${label}.lecture.no is absent from the AIXUEXI v31 source catalog`);
  }

  assert(Array.isArray(entry.tracks) && entry.tracks.length === 2, `${label}.tracks must contain exactly two tracks`);
  assert(JSON.stringify(entry.tracks.map((track) => track.track)) === JSON.stringify(TRACKS), `${label}.tracks must be ordered native-16x9 then adapted-4x3`);
  const tracks = entry.tracks.map((track, index) => validateTrack(track, `${label}.tracks[${index}]`, expectedSystem, globalState));
  const nativePages = tracks[0].pages.map((page) => [page.pageNo, page.pageDocId]);
  const adaptedPages = tracks[1].pages.map((page) => [page.pageNo, page.pageDocId]);
  assert(canonicalJson(nativePages) === canonicalJson(adaptedPages), `${label} track page identities must match`);
  for (const [, pageDocId] of nativePages) {
    const owner = globalState.pageOwners.get(pageDocId);
    assert(!owner || owner === entry.lecture.id, `pageDocId appears in more than one lecture: ${pageDocId}`);
    globalState.pageOwners.set(pageDocId, entry.lecture.id);
  }

  if (expectedSystem === "e-series") {
    const rosterCourse = globalState.eSeriesRoster.get(courseKey);
    assert(rosterCourse, `${label}.course.productCode is absent from the fixed E-series roster`);
    assert(entry.course.catalogVersion === rosterCourse.catalogVersion, `${label}.course.catalogVersion does not match the fixed E-series roster`);
    assert(entry.course.grade === rosterCourse.grade, `${label}.course.grade does not match the fixed E-series roster`);
    assert(rosterCourse.lectureNos.includes(entry.lecture.no), `${label}.lecture.no is absent from the fixed E-series course roster`);
    assert(entry.source.packageKey === rosterCourse.packageKey, `${label}.source.packageKey does not match the fixed E-series package roster`);
    assert(entry.source.packageVersion === rosterCourse.packageVersion, `${label}.source.packageVersion does not match the fixed E-series package roster`);
    const adaptedBackgrounds = tracks[1].pages.flatMap((page) => page.bindings).filter((binding) => (
      binding.role === "background"
      && binding.variant === "mathin-4x3"
      && binding.adaptationStatus === "approved"
    ));
    assert(adaptedBackgrounds.length > 0, `${label} adapted-4x3 track must explicitly bind an approved background/mathin-4x3 resource`);
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

function sourcePackageForRosterCourse(course, label) {
  if (course.catalogVersion === "2026" && course.term === "秋季") return E_SERIES_PACKAGES.autumn2026;
  const baselineTerm = (course.catalogVersion === "2026" && course.term === "暑期")
    || (course.catalogVersion === "2025" && ["秋季", "寒假", "春季"].includes(course.term));
  assert(baselineTerm, `${label} has no fixed E-series source package`);
  return E_SERIES_PACKAGES.baseline;
}

function validateESeriesRoster(roster, label) {
  assert(Array.isArray(roster) && roster.length === 90, `${label} must contain exactly 90 courses`);
  const courses = new Map();
  let lectureCount = 0;
  for (let index = 0; index < roster.length; index += 1) {
    const course = roster[index];
    const courseLabel = `${label}[${index}]`;
    exactKeys(course, ["productCode", "catalogVersion", "title", "grade", "term", "termIndex", "classType", "lectures"], courseLabel);
    assert(/^MFHK\d{5}$/.test(course.productCode ?? ""), `${courseLabel}.productCode is invalid`);
    assert(["2025", "2026"].includes(course.catalogVersion), `${courseLabel}.catalogVersion is invalid`);
    string(course.title, `${courseLabel}.title`, 3, 200);
    integer(course.grade, `${courseLabel}.grade`, 1);
    assert(course.grade <= 6, `${courseLabel}.grade must be <= 6`);
    const termIndexes = new Map([["暑期", 1], ["秋季", 2], ["寒假", 3], ["春季", 4]]);
    assert(termIndexes.get(course.term) === course.termIndex, `${courseLabel}.term/termIndex is invalid`);
    assert(["A", "B", "S"].includes(course.classType), `${courseLabel}.classType is invalid`);
    assert(Array.isArray(course.lectures) && course.lectures.length > 0, `${courseLabel}.lectures must be non-empty`);
    const rosterCourseKey = `${course.catalogVersion}\0${course.productCode}`;
    assert(!courses.has(rosterCourseKey), `${label} has duplicate catalogVersion/productCode ${course.catalogVersion}/${course.productCode}`);
    const lectureNos = [];
    for (let lectureIndex = 0; lectureIndex < course.lectures.length; lectureIndex += 1) {
      const lecture = course.lectures[lectureIndex];
      const lectureLabel = `${courseLabel}.lectures[${lectureIndex}]`;
      exactKeys(lecture, ["no", "name"], lectureLabel);
      integer(lecture.no, `${lectureLabel}.no`, 1);
      string(lecture.name, `${lectureLabel}.name`, 1, 200);
      lectureNos.push(lecture.no);
    }
    assert(new Set(lectureNos).size === lectureNos.length, `${courseLabel}.lectures has duplicate numbers`);
    assert(canonicalJson(lectureNos) === canonicalJson([...lectureNos].sort((left, right) => left - right)), `${courseLabel}.lectures must be sorted by no`);
    lectureCount += lectureNos.length;
    courses.set(rosterCourseKey, {
      productCode: course.productCode,
      catalogVersion: course.catalogVersion,
      grade: course.grade,
      lectureNos,
      ...sourcePackageForRosterCourse(course, courseLabel),
    });
  }
  assert(lectureCount === 1135, `${label} must contain exactly 1135 lectures`);
  return courses;
}

function validateSystemCardinality(courseSystem, entries, example, eSeriesRoster) {
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

  if (courseSystem === "aixuexi-autumn" && !example) {
    for (const [productCode, product] of AIXUEXI_PRODUCTS) {
      const rows = entries.filter((entry) => entry.course.productCode === productCode);
      assert(rows.length === product.lectureNos.length, `${productCode} must contain ${product.lectureNos.length} lectures`);
      assert(rows.every((entry) => entry.course.grade === product.grade), `${productCode} grade mismatch`);
      assert(canonicalJson(rows.map((entry) => entry.lecture.no)) === canonicalJson(product.lectureNos), `${productCode} must match the v31 source catalog`);
    }
  }
  if (courseSystem === "e-series" && !example) {
    const expectedNaturalKeys = [...eSeriesRoster.entries()].flatMap(([courseKey, course]) => (
      course.lectureNos.map((lectureNo) => `${courseKey}\0${String(lectureNo).padStart(8, "0")}`)
    )).sort();
    const actualNaturalKeys = entries.map((entry) => `${entry.courseKey}\0${String(entry.lecture.no).padStart(8, "0")}`).sort();
    assert(canonicalJson(actualNaturalKeys) === canonicalJson(expectedNaturalKeys), "e-series must exactly cover the fixed 90-course/1135-lecture roster");
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

function validateResourceEvidence(resource, label) {
  exactKeys(resource, [
    "objectSha256", "kind", "mime", "byteCount", "storageBucket", "storagePath", "h5ManifestPath", "h5ManifestSha256",
  ], label);
  sha256(resource.objectSha256, `${label}.objectSha256`);
  assert(ASSET_KINDS.has(resource.kind), `${label}.kind is unsupported`);
  string(resource.mime, `${label}.mime`, 3, 160);
  integer(resource.byteCount, `${label}.byteCount`, 1);
  if (resource.kind === "h5") {
    assert(resource.storageBucket === "cw-h5", `${label}.storageBucket must be cw-h5 for H5`);
    assert(resource.storagePath === `packages/${resource.objectSha256}`, `${label}.storagePath must be the content-addressed H5 package path`);
    safeRelativePath(resource.h5ManifestPath, `${label}.h5ManifestPath`);
    sha256(resource.h5ManifestSha256, `${label}.h5ManifestSha256`);
  } else {
    assert(resource.storageBucket === "cw-objects", `${label}.storageBucket must be cw-objects for CAS objects`);
    assert(resource.storagePath === `sha256/${resource.objectSha256.slice(0, 2)}/${resource.objectSha256}`, `${label}.storagePath must be content addressed by objectSha256`);
    assert(resource.h5ManifestPath === null, `${label}.h5ManifestPath must be null outside H5`);
    assert(resource.h5ManifestSha256 === null, `${label}.h5ManifestSha256 must be null outside H5`);
  }
  return resource;
}

function validateStorageAudits(manifest, entries, repositoryRoot, approvedArtifactRoots) {
  assert(Array.isArray(manifest.storageAudits) && manifest.storageAudits.length === 2, "storageAudits must contain cw-h5 and cw-objects");
  assert(canonicalJson(manifest.storageAudits.map((audit) => audit.bucket)) === canonicalJson(["cw-h5", "cw-objects"]), "storageAudits must be ordered cw-h5 then cw-objects");
  const allResources = collectResources(entries);
  const normalized = [];
  for (const audit of manifest.storageAudits) {
    const label = `storageAudits.${audit?.bucket ?? "unknown"}`;
    exactKeys(audit, ["bucket", "prefix", "objectsManifestPath", "objectsManifestSha256"], label);
    assert(["cw-h5", "cw-objects"].includes(audit.bucket), `${label}.bucket is unsupported`);
    assert(audit.prefix === (audit.bucket === "cw-h5" ? "packages/" : "sha256/"), `${label}.prefix is invalid`);
    safeRelativePath(audit.objectsManifestPath, `${label}.objectsManifestPath`);
    sha256(audit.objectsManifestSha256, `${label}.objectsManifestSha256`);
    const objectsManifestFile = resolveInputPath(repositoryRoot, audit.objectsManifestPath, `${label}.objectsManifestPath`, approvedArtifactRoots);
    assert(fs.existsSync(objectsManifestFile), `${label}.objectsManifestPath does not exist`);
    assert(textFileSha256(objectsManifestFile) === audit.objectsManifestSha256, `${label}.objectsManifestSha256 does not match the LF-normalized Storage objects manifest`);
    const auditedRows = parseNdjson(objectsManifestFile, `${label}.objectsManifestPath`);
    const auditedResources = new Map();
    const auditOrder = [];
    for (let index = 0; index < auditedRows.length; index += 1) {
      const resource = validateResourceEvidence(auditedRows[index], `${label}.objects[${index}]`);
      assert(resource.storageBucket === audit.bucket, `${label}.objects[${index}].storageBucket must be ${audit.bucket}`);
      const key = `${resource.storageBucket}\0${resource.storagePath}`;
      assert(!auditedResources.has(key), `${label}.objectsManifestPath has duplicate resource ${resource.storagePath}`);
      auditedResources.set(key, resource);
      auditOrder.push(resource.storagePath);
    }
    assert(canonicalJson(auditOrder) === canonicalJson([...auditOrder].sort()), `${label}.objectsManifestPath must be sorted by storagePath`);
    const requiredResources = new Map([...allResources].filter(([, resource]) => resource.storageBucket === audit.bucket));
    const extraResources = [...auditedResources.keys()].filter((key) => !requiredResources.has(key));
    assert(extraResources.length === 0, `${label}.objectsManifestPath contains resources outside the explicit binding scope`);
    let missingObjectCount = 0;
    let hashMismatchCount = 0;
    for (const [key, requiredResource] of requiredResources) {
      const auditedResource = auditedResources.get(key);
      if (!auditedResource) missingObjectCount += 1;
      else if (canonicalJson(auditedResource) !== canonicalJson(requiredResource)) hashMismatchCount += 1;
    }
    const derived = deriveStorageScope(entries, audit.bucket);
    if (!manifest.example) {
      assert(missingObjectCount === 0, `${label} audit is missing ${missingObjectCount} bound objects`);
      assert(hashMismatchCount === 0, `${label} audit has ${hashMismatchCount} resource metadata/hash mismatches`);
    }
    normalized.push({
      ...audit,
      status: missingObjectCount === 0 && hashMismatchCount === 0 ? "passed" : "pending",
      scopeResourceCount: derived.scopeResourceCount,
      scopeResourceSetSha256: derived.scopeResourceSetSha256,
      auditedObjectCount: auditedResources.size,
      missingObjectCount,
      hashMismatchCount,
    });
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
  approvedArtifactRoots = /** @type {string[]} */ ([]),
} = {}) {
  const repositoryRoot = assertLocalRoot(root, "root");
  assert(Array.isArray(approvedArtifactRoots), "approvedArtifactRoots must be an array");
  const localApprovedArtifactRoots = approvedArtifactRoots.map((approvedRoot, index) => assertLocalRoot(approvedRoot, `approvedArtifactRoots[${index}]`));
  const manifestFile = resolveInputPath(repositoryRoot, manifestPath, "manifestPath", localApprovedArtifactRoots);
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

  const schemaFile = fs.realpathSync(path.join(repositoryRoot, "schemas", "r1-courseware-source-manifest.schema.json"));
  assert(manifest.$schema === "schemas/r1-courseware-source-manifest.schema.json", "$schema must reference schemas/r1-courseware-source-manifest.schema.json from the repository root");
  const declaredSchema = fs.realpathSync(path.join(repositoryRoot, manifest.$schema));
  assert(declaredSchema === schemaFile, "manifest $schema must reference schemas/r1-courseware-source-manifest.schema.json");

  exactKeys(manifest.capturedFrom, ["environment", "readOnly", "databaseFingerprint", "migrationHead", "exportedAt"], "capturedFrom");
  assert(manifest.capturedFrom.environment === "offline-read-only-export", "capturedFrom.environment must be offline-read-only-export");
  assert(manifest.capturedFrom.readOnly === true, "capturedFrom.readOnly must be true");
  sha256(manifest.capturedFrom.databaseFingerprint, "capturedFrom.databaseFingerprint");
  assert(/^\d{14}_[a-z0-9_]+$/.test(manifest.capturedFrom.migrationHead ?? ""), "capturedFrom.migrationHead is invalid");
  assert(ISO_DATE_TIME.test(manifest.capturedFrom.exportedAt ?? ""), "capturedFrom.exportedAt must be an ISO UTC date-time");

  assert(Array.isArray(manifest.inventories) && manifest.inventories.length === 2, "inventories must contain exactly two systems");
  assert(canonicalJson(manifest.inventories.map((item) => item.courseSystem)) === canonicalJson([...SYSTEM_SPECS.keys()]), "inventories must be ordered aixuexi-autumn then e-series");
  const globalState = {
    lectureIds: new Set(),
    pageOwners: new Map(),
    revisionPages: new Map(),
    assetRevisions: new Map(),
    resources: new Map(),
    naturalLectureKeys: new Set(),
    sourcePackageHashes: new Map(),
    sourceReleaseIds: new Set(),
    eSeriesRoster: new Map(),
    missingBindingCount: 0,
    h5Manifests: new Map(),
    repositoryRoot,
    approvedArtifactRoots: localApprovedArtifactRoots,
  };
  const systems = [];
  const allEntries = [];
  for (const inventory of manifest.inventories) {
    const label = `inventories.${inventory?.courseSystem ?? "unknown"}`;
    exactKeys(inventory, inventory.courseSystem === "e-series" ? ["courseSystem", "path", "sha256", "roster"] : ["courseSystem", "path", "sha256"], label);
    assert(SYSTEM_SPECS.has(inventory.courseSystem), `${label}.courseSystem is unsupported`);
    sha256(inventory.sha256, `${label}.sha256`);
    if (inventory.courseSystem === "e-series") {
      exactKeys(inventory.roster, ["path", "sha256"], `${label}.roster`);
      assert(inventory.roster.path === E_SERIES_ROSTER_PATH, `${label}.roster.path must bind ${E_SERIES_ROSTER_PATH}`);
      assert(inventory.roster.sha256 === E_SERIES_ROSTER_SHA256, `${label}.roster.sha256 must bind the reviewed E-series roster artifact`);
      const rosterFile = resolveInputPath(repositoryRoot, inventory.roster.path, `${label}.roster.path`);
      assert(fs.existsSync(rosterFile), `${label}.roster.path does not exist`);
      assert(textFileSha256(rosterFile) === inventory.roster.sha256, `${label}.roster.sha256 does not match the LF-normalized roster file`);
      globalState.eSeriesRoster = validateESeriesRoster(readJson(rosterFile, `${label}.roster.path`), `${label}.roster`);
    }
    const inventoryFile = resolveInputPath(repositoryRoot, inventory.path, `${label}.path`, localApprovedArtifactRoots);
    assert(fs.existsSync(inventoryFile), `${label}.path does not exist`);
    assert(textFileSha256(inventoryFile) === inventory.sha256, `${label}.sha256 does not match the LF-normalized inventory file`);
    const rawEntries = parseNdjson(inventoryFile, label);
    const order = [];
    const entries = rawEntries.map((entry, index) => {
      const normalized = validateLectureEntry(entry, `${label}[${index}]`, inventory.courseSystem, globalState);
      order.push(`${normalized.courseKey}\0${String(normalized.lecture.no).padStart(8, "0")}\0${normalized.lecture.id}`);
      return normalized;
    });
    assert(canonicalJson(order) === canonicalJson([...order].sort(compareTuple)), `${label} entries must be sorted by catalogVersion, productCode, lectureNo, and lectureId`);
    const counts = validateSystemCardinality(inventory.courseSystem, entries, manifest.example, globalState.eSeriesRoster);
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
      sourceReleaseSetSha256: canonicalSha256(entries.flatMap((entry) => entry.tracks.map((track) => ({
        lectureId: entry.lecture.id,
        track: track.track,
        releaseId: track.capturedRelease.id,
        releaseNo: track.capturedRelease.releaseNo,
        rawSnapshotSha256: track.capturedRelease.rawSnapshotSha256,
        snapshotSha256: track.capturedRelease.snapshotSha256,
      })))),
    });
    allEntries.push(...entries);
  }

  validateExpected(manifest.expected);
  const storageAudits = validateStorageAudits(manifest, allEntries, repositoryRoot, localApprovedArtifactRoots);
  const actual = {
    courseCount: systems.reduce((sum, system) => sum + system.courseCount, 0),
    lectureCount: systems.reduce((sum, system) => sum + system.lectureCount, 0),
    nativeTrackCount: systems.reduce((sum, system) => sum + system.nativeTrackCount, 0),
    adaptedTrackCount: systems.reduce((sum, system) => sum + system.adaptedTrackCount, 0),
    releaseCount: systems.reduce((sum, system) => sum + system.releaseCount, 0),
    missingBindingCount: globalState.missingBindingCount,
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
      sourceReleases: systems.map((system) => ({ key: system.key, sourceReleaseSetSha256: system.sourceReleaseSetSha256 })),
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
      sourceReleaseSetSha256: system.sourceReleaseSetSha256,
    })),
    storage: context.storageAudits.map((audit) => ({ ...audit })),
    releaseTarget: {
      releaseNo: 1,
      note: RELEASE_NOTE,
      count: EXPECTED.releaseCount,
      legacyNativeHeadCount: EXPECTED.lectureCount,
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

export function parseCoursewareSourceCliArguments(argv) {
  const approvedArtifactRoots = [];
  let manifestPath;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--artifact-root") {
      const approvedRoot = argv[index + 1];
      assert(approvedRoot, "--artifact-root requires a local directory");
      approvedArtifactRoots.push(assertLocalRoot(approvedRoot, `--artifact-root[${approvedArtifactRoots.length}]`));
      index += 1;
      continue;
    }
    assert(!value.startsWith("-"), `unsupported option: ${value}`);
    assert(manifestPath === undefined, "only one manifest path is allowed");
    manifestPath = value;
  }
  return { manifestPath, approvedArtifactRoots };
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseCoursewareSourceCliArguments(argv);
    const context = loadCoursewareSourceContext(options);
    process.stdout.write(`${JSON.stringify(buildCoursewareSourcePlan(context), null, 2)}\n`);
  } catch (error) {
    console.error(`R1 courseware source preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
