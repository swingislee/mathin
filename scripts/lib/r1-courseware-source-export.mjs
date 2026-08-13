import { createHash } from "node:crypto";

import {
  canonicalJson,
  canonicalSha256,
  deriveTrackDigests,
} from "../plan-r1-courseware-source.mjs";
import { h5StoragePath } from "./courseware-storage-paths.mjs";
import { normalizeNewlines } from "./text-hash.mjs";

const CAPTURE_VERSION = "mathin-r1-courseware-source-capture-v1";
const DATABASE_FINGERPRINT_VERSION = "mathin-r1-courseware-db-snapshot-v1";
const RELEASE_NOTE = "production-v1.0-baseline";
const TRACKS = ["native-16x9", "adapted-4x3"];
const SYSTEM_ORDER = new Map([["aixuexi-autumn", 0], ["e-series", 1]]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const PLACEHOLDER_SHA256 = /^([0-9a-f])\1{63}$/;
const MIGRATION_HEAD = /^([0-9]{14})_[a-z0-9_]+$/;
const ROLE = /^[a-z][a-z0-9_-]{0,49}$/;
const VARIANT = /^[a-z][a-z0-9._-]{0,79}$/;
const ASSET_KINDS = new Set(["image", "video", "audio", "svg", "h5"]);
const AIXUEXI_PACKAGE_KEYS = new Set([
  "2026-gplus-sujiao-math",
  "2026-xplus-sujiao-math",
  "2026-aplus-quanguo-math",
]);
const MAX_CAPTURE_BYTES = 512 * 1024 * 1024;
const MAX_CAPTURE_LINE_BYTES = 4 * 1024 * 1024;
const MAX_CAPTURE_RECORDS = 500_000;
const MAX_STORAGE_OBJECT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_H5_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_H5_FILES = 20_000;

function fail(message) {
  throw new Error(`R1 courseware source export: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function object(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function exactKeys(value, keys, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} keys must be exactly ${expected.join(", ")}`);
}

function string(value, label, minimum = 1, maximum = 500) {
  assert(typeof value === "string" && value.length >= minimum && value.length <= maximum, `${label} must be a ${minimum}-${maximum} character string`);
  return value;
}

function integer(value, label, minimum = 0) {
  assert(Number.isSafeInteger(value) && value >= minimum, `${label} must be an integer >= ${minimum}`);
  return value;
}

function uuid(value, label) {
  assert(typeof value === "string" && UUID.test(value), `${label} must be a UUID`);
  return value.toLowerCase();
}

function sha256(value, label) {
  assert(typeof value === "string" && SHA256.test(value), `${label} must be a lowercase SHA-256`);
  assert(!PLACEHOLDER_SHA256.test(value), `${label} must not be a repeated-character placeholder`);
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTrack(left, right) {
  return TRACKS.indexOf(left) - TRACKS.indexOf(right);
}

function normalizeLaunchQuery(value, label, { required = false } = {}) {
  if (value === null || value === undefined) {
    assert(!required, `${label} is required for H5`);
    return null;
  }
  exactKeys(value, ["query", "coursewareIdParam"], label);
  const query = object(value.query, `${label}.query`);
  const queryKeys = Object.keys(query).sort(compareText);
  assert(queryKeys.length <= 100, `${label}.query has too many keys`);
  const normalizedEntries = [];
  for (const key of queryKeys) {
    string(key, `${label}.query key`, 1, 100);
    assert(Array.isArray(query[key]) && query[key].length <= 100, `${label}.query.${key} must be an array with at most 100 values`);
    normalizedEntries.push([key, query[key].map((entry, index) => string(entry, `${label}.query.${key}[${index}]`, 0, 500))]);
  }
  const coursewareIdParam = value.coursewareIdParam;
  assert(coursewareIdParam === null || (typeof coursewareIdParam === "string" && coursewareIdParam.length >= 1 && coursewareIdParam.length <= 100), `${label}.coursewareIdParam must be string|null`);
  return { query: Object.fromEntries(normalizedEntries), coursewareIdParam };
}

function addBindingKey(keys, value, label) {
  if (value === null || value === undefined) return;
  keys.add(sha256(value, label));
}

function collectMathinPageBindingKeys(doc, label) {
  const keys = new Set();
  addBindingKey(keys, doc.canvas?.backgroundBindingKey, `${label}.canvas.backgroundBindingKey`);
  const walk = (nodes, trail) => {
    assert(Array.isArray(nodes), `${trail} must be an array`);
    for (let index = 0; index < nodes.length; index += 1) {
      const node = object(nodes[index], `${trail}[${index}]`);
      assert(Array.isArray(node.resources), `${trail}[${index}].resources must be an array`);
      for (let resourceIndex = 0; resourceIndex < node.resources.length; resourceIndex += 1) {
        const resource = object(node.resources[resourceIndex], `${trail}[${index}].resources[${resourceIndex}]`);
        addBindingKey(keys, resource.bindingKey, `${trail}[${index}].resources[${resourceIndex}].bindingKey`);
      }
      walk(node.children, `${trail}[${index}].children`);
    }
  };
  walk(doc.nodes, `${label}.nodes`);
  assert(Array.isArray(doc.interactions), `${label}.interactions must be an array`);
  for (let index = 0; index < doc.interactions.length; index += 1) {
    const interaction = object(doc.interactions[index], `${label}.interactions[${index}]`);
    addBindingKey(keys, interaction.audioBindingKey, `${label}.interactions[${index}].audioBindingKey`);
  }
  return keys;
}

// These two collectors deliberately mirror cw-import.mjs validatePageDoc(),
// which is the import-time authority today. Keep this seam explicit: before a
// real exporter CLI is added, both callers should be moved to one shared pure
// module so a newly introduced document binding field cannot drift silently.
function collectAixuexiPageBindingKeys(doc, label) {
  const keys = new Set();
  addBindingKey(keys, doc.canvas?.backgroundBindingKey, `${label}.canvas.backgroundBindingKey`);
  addBindingKey(keys, doc.sourceRuntime?.runtimeBindingKey, `${label}.sourceRuntime.runtimeBindingKey`);
  assert(Array.isArray(doc.nodes), `${label}.nodes must be an array`);
  for (let index = 0; index < doc.nodes.length; index += 1) {
    const node = object(doc.nodes[index], `${label}.nodes[${index}]`);
    addBindingKey(keys, node.resourceBindingKey, `${label}.nodes[${index}].resourceBindingKey`);
    for (const [resourceIndex, key] of (node.resourceBindingKeys ?? []).entries()) {
      addBindingKey(keys, key, `${label}.nodes[${index}].resourceBindingKeys[${resourceIndex}]`);
    }
    addBindingKey(keys, node.embeddedH5?.bindingKey, `${label}.nodes[${index}].embeddedH5.bindingKey`);
    for (const [asset, key] of Object.entries(node.trueOrFalse?.assets ?? {})) {
      addBindingKey(keys, key, `${label}.nodes[${index}].trueOrFalse.assets.${asset}`);
    }
    addBindingKey(keys, node.topicClassification?.backgroundBindingKey, `${label}.nodes[${index}].topicClassification.backgroundBindingKey`);
    for (const [asset, key] of Object.entries(node.topicClassification?.assets ?? {})) {
      addBindingKey(keys, key, `${label}.nodes[${index}].topicClassification.assets.${asset}`);
    }
  }
  addBindingKey(keys, doc.topicInteraction?.bindingKey, `${label}.topicInteraction.bindingKey`);
  if (doc.itvInteraction !== null && doc.itvInteraction !== undefined) {
    const itv = object(doc.itvInteraction, `${label}.itvInteraction`);
    addBindingKey(keys, itv.videoBindingKey, `${label}.itvInteraction.videoBindingKey`);
    addBindingKey(keys, itv.posterBindingKey, `${label}.itvInteraction.posterBindingKey`);
    addBindingKey(keys, itv.lastFrameBindingKey, `${label}.itvInteraction.lastFrameBindingKey`);
    for (let eventIndex = 0; eventIndex < (itv.events ?? []).length; eventIndex += 1) {
      const event = object(itv.events[eventIndex], `${label}.itvInteraction.events[${eventIndex}]`);
      addBindingKey(keys, event.previewBindingKey, `${label}.itvInteraction.events[${eventIndex}].previewBindingKey`);
      addBindingKey(keys, event.pauseFrameBindingKey, `${label}.itvInteraction.events[${eventIndex}].pauseFrameBindingKey`);
      for (let widgetIndex = 0; widgetIndex < (event.stage?.widgets ?? []).length; widgetIndex += 1) {
        const widget = object(event.stage.widgets[widgetIndex], `${label}.itvInteraction.events[${eventIndex}].stage.widgets[${widgetIndex}]`);
        addBindingKey(keys, widget.resourceBindingKey, `${label}.itvInteraction.events[${eventIndex}].stage.widgets[${widgetIndex}].resourceBindingKey`);
        for (const [state, key] of Object.entries(widget.stateBindingKeys ?? {})) {
          addBindingKey(keys, key, `${label}.itvInteraction.events[${eventIndex}].stage.widgets[${widgetIndex}].stateBindingKeys.${state}`);
        }
      }
    }
  }
  return keys;
}

export function extractRequiredBindingKeys(document, label = "document") {
  const doc = object(document, label);
  const keys = doc.docVersion === "page-doc-v1"
    ? collectMathinPageBindingKeys(doc, label)
    : doc.docVersion === "aixuexi-page-doc-v1"
      ? collectAixuexiPageBindingKeys(doc, label)
      : fail(`${label}.docVersion is unsupported`);
  return [...keys].sort(compareText);
}

function normalizeSourceEvidence(value, label) {
  if (value === null) return null;
  exactKeys(value, [
    "sourceSystem", "packageKey", "documentAdapter", "packageManifestSha256", "packageStatus",
    "sourceProductCode", "sourceCoursewareId", "sourceLessonIndex", "pageCount",
    "lectureVerificationSha256", "offlineStatus",
  ], label);
  return {
    sourceSystem: string(value.sourceSystem, `${label}.sourceSystem`, 1, 80),
    packageKey: string(value.packageKey, `${label}.packageKey`, 1, 160),
    documentAdapter: string(value.documentAdapter, `${label}.documentAdapter`, 1, 80),
    packageManifestSha256: sha256(value.packageManifestSha256, `${label}.packageManifestSha256`),
    packageStatus: string(value.packageStatus, `${label}.packageStatus`, 1, 40),
    sourceProductCode: string(value.sourceProductCode, `${label}.sourceProductCode`, 1, 160),
    sourceCoursewareId: string(value.sourceCoursewareId, `${label}.sourceCoursewareId`, 1, 160),
    sourceLessonIndex: integer(value.sourceLessonIndex, `${label}.sourceLessonIndex`, 1),
    pageCount: integer(value.pageCount, `${label}.pageCount`, 1),
    lectureVerificationSha256: sha256(value.lectureVerificationSha256, `${label}.lectureVerificationSha256`),
    offlineStatus: string(value.offlineStatus, `${label}.offlineStatus`, 1, 40),
  };
}

function normalizeLectureRecord(record, label) {
  exactKeys(record, ["recordType", "courseSystem", "catalogVersion", "productCode", "grade", "lectureId", "lectureNo", "sourceEvidence"], label);
  assert(record.recordType === "lecture", `${label}.recordType must be lecture`);
  assert(SYSTEM_ORDER.has(record.courseSystem), `${label}.courseSystem is unsupported`);
  integer(record.grade, `${label}.grade`, 1);
  assert(record.grade <= 6, `${label}.grade must be <= 6`);
  return {
    recordType: "lecture",
    courseSystem: record.courseSystem,
    catalogVersion: string(record.catalogVersion, `${label}.catalogVersion`, 1, 40),
    productCode: string(record.productCode, `${label}.productCode`, 3, 160),
    grade: record.grade,
    lectureId: uuid(record.lectureId, `${label}.lectureId`),
    lectureNo: integer(record.lectureNo, `${label}.lectureNo`, 1),
    sourceEvidence: normalizeSourceEvidence(record.sourceEvidence, `${label}.sourceEvidence`),
  };
}

function normalizeReleaseRecord(record, label) {
  exactKeys(record, ["recordType", "lectureId", "track", "releaseId", "releaseNo", "snapshot"], label);
  assert(record.recordType === "release", `${label}.recordType must be release`);
  assert(TRACKS.includes(record.track), `${label}.track is unsupported`);
  assert(Array.isArray(record.snapshot) && record.snapshot.length >= 1 && record.snapshot.length <= 200, `${label}.snapshot must contain 1-200 pages`);
  const pageIds = new Set();
  const projectedSnapshot = record.snapshot.map((entry, pageIndex) => {
    const pageLabel = `${label}.snapshot[${pageIndex}]`;
    object(entry, pageLabel);
    const pageDocId = uuid(entry.pageDocId, `${pageLabel}.pageDocId`);
    assert(!pageIds.has(pageDocId), `${label}.snapshot contains duplicate pageDocId ${pageDocId}`);
    pageIds.add(pageDocId);
    assert(Array.isArray(entry.bindings) && entry.bindings.length > 0, `${pageLabel}.bindings must be non-empty`);
    const bindingKeys = new Set();
    const bindings = entry.bindings.map((binding, bindingIndex) => {
      const bindingLabel = `${pageLabel}.bindings[${bindingIndex}]`;
      object(binding, bindingLabel);
      const bindingKey = sha256(binding.bindingKey, `${bindingLabel}.bindingKey`);
      assert(!bindingKeys.has(bindingKey), `${pageLabel}.bindings contains duplicate bindingKey ${bindingKey}`);
      bindingKeys.add(bindingKey);
      return {
        bindingKey,
        assetRevisionId: uuid(binding.assetRevisionId, `${bindingLabel}.assetRevisionId`),
        launchQuery: normalizeLaunchQuery(binding.launchQuery, `${bindingLabel}.launchQuery`),
      };
    }).sort((left, right) => compareText(`${left.bindingKey}\0${left.assetRevisionId}`, `${right.bindingKey}\0${right.assetRevisionId}`));
    if (entry.learningCheckEnabled !== undefined) {
      assert(typeof entry.learningCheckEnabled === "boolean", `${pageLabel}.learningCheckEnabled must be boolean when present`);
    }
    return {
      pageDocId,
      revisionId: uuid(entry.revisionId, `${pageLabel}.revisionId`),
      bindings,
      learningCheckEnabled: entry.learningCheckEnabled ?? false,
    };
  });
  return {
    recordType: "release",
    lectureId: uuid(record.lectureId, `${label}.lectureId`),
    track: record.track,
    releaseId: uuid(record.releaseId, `${label}.releaseId`),
    releaseNo: integer(record.releaseNo, `${label}.releaseNo`, 1),
    snapshot: record.snapshot,
    rawSnapshotSha256: canonicalSha256(record.snapshot),
    projectedSnapshot,
  };
}

function normalizeCapturedBinding(binding, label, context) {
  exactKeys(binding, [
    "bindingKey", "assetRevisionId", "objectSha256", "bindingKind", "sharedAssetKind", "objectKind",
    "bindingRole", "sharedAssetRole", "variant", "mime", "byteCount", "storagePath",
    "bindingSharedAssetId", "assetSharedAssetId", "adaptationStatus", "launchQuery",
  ], label);
  const bindingKind = string(binding.bindingKind, `${label}.bindingKind`, 1, 20);
  assert(ASSET_KINDS.has(bindingKind), `${label}.bindingKind is unsupported`);
  assert(binding.sharedAssetKind === bindingKind, `${label}.sharedAssetKind differs from bindingKind`);
  assert(binding.objectKind === bindingKind, `${label}.objectKind differs from bindingKind`);
  const bindingRole = string(binding.bindingRole, `${label}.bindingRole`, 1, 50);
  assert(ROLE.test(bindingRole), `${label}.bindingRole is invalid`);
  assert(binding.sharedAssetRole === bindingRole, `${label}.sharedAssetRole differs from bindingRole`);
  const bindingSharedAssetId = uuid(binding.bindingSharedAssetId, `${label}.bindingSharedAssetId`);
  assert(uuid(binding.assetSharedAssetId, `${label}.assetSharedAssetId`) === bindingSharedAssetId, `${label}.assetSharedAssetId differs from bindingSharedAssetId`);
  const objectSha256 = sha256(binding.objectSha256, `${label}.objectSha256`);
  const storagePath = string(binding.storagePath, `${label}.storagePath`, 10, 500);
  if (bindingKind === "h5") {
    assert(storagePath === `packages/${objectSha256}`, `${label}.storagePath is not the H5 content-addressed package path`);
  } else {
    assert(storagePath === `sha256/${objectSha256.slice(0, 2)}/${objectSha256}`, `${label}.storagePath is not the CAS object path`);
  }
  const variant = string(binding.variant, `${label}.variant`, 1, 80);
  assert(VARIANT.test(variant), `${label}.variant is invalid`);
  const launchQuery = normalizeLaunchQuery(binding.launchQuery, `${label}.launchQuery`, { required: bindingKind === "h5" });
  assert(bindingKind === "h5" || launchQuery === null, `${label}.launchQuery must be null outside H5`);
  const requiresApproval = context.courseSystem === "e-series"
    && context.track === "adapted-4x3"
    && bindingRole === "background"
    && variant === "mathin-4x3";
  if (requiresApproval) {
    assert(binding.adaptationStatus === "approved", `${label} lacks approved E-series 4:3 provenance`);
  } else {
    assert(binding.adaptationStatus === null || binding.adaptationStatus === "approved", `${label}.adaptationStatus is not a completed decision`);
  }
  return {
    bindingKey: sha256(binding.bindingKey, `${label}.bindingKey`),
    assetRevisionId: uuid(binding.assetRevisionId, `${label}.assetRevisionId`),
    objectSha256,
    kind: bindingKind,
    role: bindingRole,
    variant,
    mime: string(binding.mime, `${label}.mime`, 3, 160),
    byteCount: integer(binding.byteCount, `${label}.byteCount`, 1),
    storageBucket: bindingKind === "h5" ? "cw-h5" : "cw-objects",
    storagePath,
    launchQuery,
    adaptationStatus: requiresApproval ? "approved" : "not-required",
  };
}

function normalizePageRecord(record, label, lecture) {
  exactKeys(record, [
    "recordType", "lectureId", "track", "releaseId", "snapshotOrdinal", "pageNo", "pageDocId", "revisionId",
    "revisionTrack", "pageSourceCoursewareId", "document", "learningCheckEnabled", "snapshotBindingCount", "bindings",
  ], label);
  assert(record.recordType === "page", `${label}.recordType must be page`);
  assert(TRACKS.includes(record.track), `${label}.track is unsupported`);
  assert(TRACKS.includes(record.revisionTrack), `${label}.revisionTrack is unsupported`);
  assert(record.track === "adapted-4x3" || record.revisionTrack === "native-16x9", `${label} native release cannot reference an adapted revision`);
  assert(typeof record.learningCheckEnabled === "boolean", `${label}.learningCheckEnabled must be boolean`);
  assert(Array.isArray(record.bindings), `${label}.bindings must be an array`);
  const normalizedBindings = record.bindings.map((binding, index) => normalizeCapturedBinding(
    binding,
    `${label}.bindings[${index}]`,
    { courseSystem: lecture.courseSystem, track: record.track },
  )).sort((left, right) => compareText(`${left.bindingKey}\0${left.assetRevisionId}`, `${right.bindingKey}\0${right.assetRevisionId}`));
  assert(integer(record.snapshotBindingCount, `${label}.snapshotBindingCount`, 1) === normalizedBindings.length, `${label} did not resolve every release snapshot binding`);
  const bindingKeys = normalizedBindings.map((binding) => binding.bindingKey);
  assert(new Set(bindingKeys).size === bindingKeys.length, `${label} contains duplicate binding keys`);
  const requiredBindingKeys = extractRequiredBindingKeys(record.document, `${label}.document`);
  assert(canonicalJson(requiredBindingKeys) === canonicalJson(bindingKeys), `${label} document bindings differ from the immutable release snapshot`);
  return {
    recordType: "page",
    lectureId: uuid(record.lectureId, `${label}.lectureId`),
    track: record.track,
    releaseId: uuid(record.releaseId, `${label}.releaseId`),
    snapshotOrdinal: integer(record.snapshotOrdinal, `${label}.snapshotOrdinal`, 1),
    pageNo: integer(record.pageNo, `${label}.pageNo`, 1),
    pageDocId: uuid(record.pageDocId, `${label}.pageDocId`),
    revisionId: uuid(record.revisionId, `${label}.revisionId`),
    revisionTrack: record.revisionTrack,
    pageSourceCoursewareId: record.pageSourceCoursewareId === null
      ? null
      : string(record.pageSourceCoursewareId, `${label}.pageSourceCoursewareId`, 1, 160),
    document: object(record.document, `${label}.document`),
    learningCheckEnabled: record.learningCheckEnabled,
    snapshotBindingCount: record.snapshotBindingCount,
    requiredBindingKeys,
    bindings: normalizedBindings,
  };
}

function normalizeMetaRecord(record, label) {
  exactKeys(record, ["recordType", "captureVersion", "transactionReadOnly", "migrationVersion"], label);
  assert(record.recordType === "meta", `${label}.recordType must be meta`);
  assert(record.captureVersion === CAPTURE_VERSION, `${label}.captureVersion must be ${CAPTURE_VERSION}`);
  assert(record.transactionReadOnly === true, `${label}.transactionReadOnly must be true`);
  assert(/^[0-9]{14}$/.test(record.migrationVersion ?? ""), `${label}.migrationVersion must be a 14-digit migration version`);
  return { ...record };
}

export function parseCoursewareSourceCaptureNdjson(text) {
  assert(typeof text === "string", "capture NDJSON must be text");
  assert(Buffer.byteLength(text, "utf8") <= MAX_CAPTURE_BYTES, `capture NDJSON exceeds ${MAX_CAPTURE_BYTES} bytes`);
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  assert(lines.length > 0, "capture NDJSON must not be empty");
  assert(lines.length <= MAX_CAPTURE_RECORDS, `capture NDJSON exceeds ${MAX_CAPTURE_RECORDS} records`);
  return lines.map((line, index) => {
    assert(Buffer.byteLength(line, "utf8") <= MAX_CAPTURE_LINE_BYTES, `capture line ${index + 1} exceeds ${MAX_CAPTURE_LINE_BYTES} bytes`);
    assert(line.length > 0 && line.trim() === line, `capture line ${index + 1} must be one compact JSON object`);
    try {
      return JSON.parse(line);
    } catch (error) {
      fail(`capture line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
}

export function validateCoursewareSourceCapture(records, { migrationHead } = {}) {
  assert(Array.isArray(records) && records.length > 0, "capture records must be a non-empty array");
  assert(records.length <= MAX_CAPTURE_RECORDS, `capture records exceed ${MAX_CAPTURE_RECORDS}`);
  const headMatch = MIGRATION_HEAD.exec(migrationHead ?? "");
  assert(headMatch, "migrationHead must be a complete migration name");
  const metaRecords = records.filter((record) => record?.recordType === "meta");
  assert(metaRecords.length === 1, "capture must contain exactly one meta record");
  const meta = normalizeMetaRecord(metaRecords[0], "capture.meta");
  assert(meta.migrationVersion === headMatch[1], "capture migration version differs from migrationHead");

  const lectures = records.filter((record) => record?.recordType === "lecture")
    .map((record, index) => normalizeLectureRecord(record, `capture.lectures[${index}]`));
  const lectureById = new Map();
  const naturalKeys = new Set();
  for (const lecture of lectures) {
    if (lecture.courseSystem === "aixuexi-autumn") {
      assert(lecture.sourceEvidence !== null, `AIXUEXI lecture ${lecture.lectureId} lacks database source provenance`);
      assert(lecture.sourceEvidence.sourceSystem === "aixuexi_bsk", `AIXUEXI lecture ${lecture.lectureId} has an unexpected database source system`);
      assert(lecture.sourceEvidence.documentAdapter === "aixuexi-page-v1", `AIXUEXI lecture ${lecture.lectureId} has an unexpected document adapter`);
      assert(lecture.sourceEvidence.packageStatus === "imported", `AIXUEXI lecture ${lecture.lectureId} package is not imported`);
      assert(AIXUEXI_PACKAGE_KEYS.has(lecture.sourceEvidence.packageKey), `AIXUEXI lecture ${lecture.lectureId} has an unexpected package key`);
      assert(lecture.sourceEvidence.sourceProductCode === lecture.productCode, `AIXUEXI lecture ${lecture.lectureId} source product code differs from course product code`);
      assert(lecture.sourceEvidence.sourceLessonIndex === lecture.lectureNo, `AIXUEXI lecture ${lecture.lectureId} source lesson index differs from lecture.no`);
      assert(lecture.sourceEvidence.offlineStatus === "complete", `AIXUEXI lecture ${lecture.lectureId} database source is not complete`);
    } else {
      assert(lecture.sourceEvidence === null, `E-series lecture ${lecture.lectureId} must use reviewed external provenance`);
    }
    assert(!lectureById.has(lecture.lectureId), `duplicate lecture capture ${lecture.lectureId}`);
    const naturalKey = `${lecture.courseSystem}\0${lecture.catalogVersion}\0${lecture.productCode}\0${lecture.lectureNo}`;
    assert(!naturalKeys.has(naturalKey), `duplicate lecture natural key ${naturalKey}`);
    naturalKeys.add(naturalKey);
    lectureById.set(lecture.lectureId, lecture);
  }
  assert(lectures.length > 0, "capture contains no lectures");

  const releases = records.filter((record) => record?.recordType === "release")
    .map((record, index) => normalizeReleaseRecord(record, `capture.releases[${index}]`));
  const releaseByKey = new Map();
  const releaseIds = new Set();
  for (const release of releases) {
    assert(lectureById.has(release.lectureId), `release ${release.releaseId} references an unknown lecture`);
    const key = `${release.lectureId}\0${release.track}`;
    assert(!releaseByKey.has(key), `lecture ${release.lectureId} has duplicate ${release.track} release heads`);
    assert(!releaseIds.has(release.releaseId), `release ${release.releaseId} is selected by more than one current head`);
    releaseByKey.set(key, release);
    releaseIds.add(release.releaseId);
  }

  const pageRecords = records.filter((record) => record?.recordType === "page");
  const pages = pageRecords.map((record, index) => {
    const lectureId = uuid(record.lectureId, `capture.pages[${index}].lectureId`);
    const lecture = lectureById.get(lectureId);
    assert(lecture, `page capture references unknown lecture ${lectureId}`);
    return normalizePageRecord(record, `capture.pages[${index}]`, lecture);
  });
  const pagesByRelease = new Map();
  for (const page of pages) {
    const key = `${page.lectureId}\0${page.track}`;
    const release = releaseByKey.get(key);
    assert(release, `page ${page.pageDocId} has no captured current release`);
    assert(page.releaseId === release.releaseId, `page ${page.pageDocId} did not come from current_release_id`);
    const group = pagesByRelease.get(key) ?? [];
    group.push(page);
    pagesByRelease.set(key, group);
  }

  for (const lecture of lectures) {
    for (const track of TRACKS) {
      const key = `${lecture.lectureId}\0${track}`;
      const release = releaseByKey.get(key);
      assert(release, `lecture ${lecture.lectureId} lacks current ${track} release`);
      const trackPages = (pagesByRelease.get(key) ?? []).sort((left, right) => left.snapshotOrdinal - right.snapshotOrdinal);
      assert(trackPages.length === release.projectedSnapshot.length, `release ${release.releaseId} resolved ${trackPages.length}/${release.projectedSnapshot.length} pages`);
      for (let index = 0; index < trackPages.length; index += 1) {
        assert(trackPages[index].snapshotOrdinal === index + 1, `release ${release.releaseId} snapshot ordinality is incomplete`);
        if (index > 0) assert(trackPages[index].pageNo > trackPages[index - 1].pageNo, `release ${release.releaseId} page numbers must be unique and strictly increasing`);
      }
      const pageProjection = trackPages.map((page) => ({
        pageDocId: page.pageDocId,
        revisionId: page.revisionId,
        bindings: page.bindings.map((binding) => ({
          bindingKey: binding.bindingKey,
          assetRevisionId: binding.assetRevisionId,
          launchQuery: binding.launchQuery,
        })),
        learningCheckEnabled: page.learningCheckEnabled,
      }));
      assert(canonicalJson(pageProjection) === canonicalJson(release.projectedSnapshot), `release ${release.releaseId} page records differ from the immutable snapshot projection`);
      pagesByRelease.set(key, trackPages);
    }
    if (lecture.courseSystem === "aixuexi-autumn") {
      for (const track of TRACKS) {
        const trackPages = pagesByRelease.get(`${lecture.lectureId}\0${track}`);
        assert(trackPages.length === lecture.sourceEvidence.pageCount, `AIXUEXI lecture ${lecture.lectureId} ${track} page count differs from source provenance`);
        for (const page of trackPages) {
          assert(page.document.docVersion === "aixuexi-page-doc-v1", `AIXUEXI lecture ${lecture.lectureId} contains a non-AIXUEXI page document`);
          assert(page.pageSourceCoursewareId === lecture.sourceEvidence.sourceCoursewareId, `AIXUEXI lecture ${lecture.lectureId} page row source courseware ID differs from source provenance`);
          assert(page.document.source?.coursewareId === lecture.sourceEvidence.sourceCoursewareId, `AIXUEXI lecture ${lecture.lectureId} page source courseware ID differs from source provenance`);
        }
      }
    }
    const nativePages = pagesByRelease.get(`${lecture.lectureId}\0native-16x9`).map((page) => [page.pageNo, page.pageDocId]);
    const adaptedPages = pagesByRelease.get(`${lecture.lectureId}\0adapted-4x3`).map((page) => [page.pageNo, page.pageDocId]);
    assert(canonicalJson(nativePages) === canonicalJson(adaptedPages), `lecture ${lecture.lectureId} track page identities differ`);
  }

  const supported = new Set(["meta", "lecture", "release", "page"]);
  for (const record of records) assert(supported.has(record?.recordType), `unsupported capture record type ${record?.recordType ?? "<missing>"}`);
  lectures.sort(compareLecture);
  releases.sort((left, right) => compareText(left.lectureId, right.lectureId) || compareTrack(left.track, right.track));
  pages.sort((left, right) => compareText(left.lectureId, right.lectureId) || compareTrack(left.track, right.track) || left.snapshotOrdinal - right.snapshotOrdinal);
  return { meta, migrationHead, lectures, releases, pages, lectureById, releaseByKey, pagesByRelease };
}

function normalizeProvenance(provenance) {
  assert(Array.isArray(provenance), "provenance must be an array");
  const byLecture = new Map();
  for (let index = 0; index < provenance.length; index += 1) {
    const row = provenance[index];
    const label = `provenance[${index}]`;
    exactKeys(row, ["lectureId", "packageKey", "packageVersion", "packageManifestSha256", "lectureVerificationSha256", "offlineStatus"], label);
    const normalized = {
      lectureId: uuid(row.lectureId, `${label}.lectureId`),
      packageKey: string(row.packageKey, `${label}.packageKey`, 3, 160),
      packageVersion: string(row.packageVersion, `${label}.packageVersion`, 3, 160),
      packageManifestSha256: sha256(row.packageManifestSha256, `${label}.packageManifestSha256`),
      lectureVerificationSha256: sha256(row.lectureVerificationSha256, `${label}.lectureVerificationSha256`),
      offlineStatus: row.offlineStatus,
    };
    assert(normalized.offlineStatus === "complete", `${label}.offlineStatus must be complete`);
    assert(!byLecture.has(normalized.lectureId), `${label}.lectureId is duplicated`);
    byLecture.set(normalized.lectureId, normalized);
  }
  return byLecture;
}

function normalizeH5Evidence(evidence) {
  assert(Array.isArray(evidence), "h5ManifestEvidence must be an array");
  const byObject = new Map();
  for (let index = 0; index < evidence.length; index += 1) {
    const row = evidence[index];
    const label = `h5ManifestEvidence[${index}]`;
    exactKeys(row, ["objectSha256", "h5ManifestPath", "h5ManifestSha256"], label);
    const normalized = {
      objectSha256: sha256(row.objectSha256, `${label}.objectSha256`),
      h5ManifestPath: string(row.h5ManifestPath, `${label}.h5ManifestPath`, 3, 500),
      h5ManifestSha256: sha256(row.h5ManifestSha256, `${label}.h5ManifestSha256`),
    };
    assert(!normalized.h5ManifestPath.includes("\\") && !/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(normalized.h5ManifestPath), `${label}.h5ManifestPath must be a relative forward-slash path`);
    assert(!byObject.has(normalized.objectSha256), `${label}.objectSha256 is duplicated`);
    byObject.set(normalized.objectSha256, normalized);
  }
  return byObject;
}

function compareLecture(left, right) {
  return (SYSTEM_ORDER.get(left.courseSystem) - SYSTEM_ORDER.get(right.courseSystem))
    || compareText(left.catalogVersion, right.catalogVersion)
    || compareText(left.productCode, right.productCode)
    || left.lectureNo - right.lectureNo
    || compareText(left.lectureId, right.lectureId);
}

export function sortCoursewareInventoryEntries(entries) {
  assert(Array.isArray(entries), "inventory entries must be an array");
  return [...entries].sort((left, right) => (
    (SYSTEM_ORDER.get(left.courseSystem) - SYSTEM_ORDER.get(right.courseSystem))
    || compareText(left.course.catalogVersion, right.course.catalogVersion)
    || compareText(left.course.productCode, right.course.productCode)
    || left.lecture.no - right.lecture.no
    || compareText(left.lecture.id, right.lecture.id)
  ));
}

export function sortCoursewareStorageResources(resources) {
  assert(Array.isArray(resources), "storage resources must be an array");
  return [...resources].sort((left, right) => compareText(`${left.storageBucket}\0${left.storagePath}`, `${right.storageBucket}\0${right.storagePath}`));
}

function databaseFingerprintPayload(capture) {
  return {
    schemaVersion: DATABASE_FINGERPRINT_VERSION,
    migrationHead: capture.migrationHead,
    lectures: capture.lectures,
    releases: capture.releases.map((release) => ({
      lectureId: release.lectureId,
      track: release.track,
      releaseId: release.releaseId,
      releaseNo: release.releaseNo,
      rawSnapshotSha256: release.rawSnapshotSha256,
      snapshot: release.snapshot,
    })),
    pages: capture.pages.map((page) => ({
      lectureId: page.lectureId,
      track: page.track,
      releaseId: page.releaseId,
      snapshotOrdinal: page.snapshotOrdinal,
      pageNo: page.pageNo,
      pageDocId: page.pageDocId,
      revisionId: page.revisionId,
      revisionTrack: page.revisionTrack,
      pageSourceCoursewareId: page.pageSourceCoursewareId,
      document: page.document,
      learningCheckEnabled: page.learningCheckEnabled,
      bindings: page.bindings,
    })),
  };
}

/**
 * @param {any[]} records
 * @param {{migrationHead?: string}} [options]
 */
export function deriveCoursewareDatabaseFingerprint(records, options) {
  return canonicalSha256(databaseFingerprintPayload(validateCoursewareSourceCapture(records, options)));
}

/**
 * @param {any[]} records
 * @param {{migrationHead?: string, provenance?: any[], h5ManifestEvidence?: any[]}} [options]
 * @returns {any}
 */
export function assembleCoursewareSourceCapture(records, {
  migrationHead,
  provenance = [],
  h5ManifestEvidence = [],
} = {}) {
  const capture = validateCoursewareSourceCapture(records, { migrationHead });
  const provenanceByLecture = normalizeProvenance(provenance);
  const h5EvidenceByObject = normalizeH5Evidence(h5ManifestEvidence);
  const usedProvenance = new Set();
  const usedH5Evidence = new Set();
  const resourceMap = new Map();
  const entries = [];

  for (const lecture of capture.lectures) {
    const source = provenanceByLecture.get(lecture.lectureId);
    assert(source, `lecture ${lecture.lectureId} lacks reviewed source provenance`);
    usedProvenance.add(lecture.lectureId);
    if (lecture.sourceEvidence !== null) {
      assert(lecture.sourceEvidence.packageKey === source.packageKey, `lecture ${lecture.lectureId} package key differs from captured database provenance`);
      assert(lecture.sourceEvidence.packageManifestSha256 === source.packageManifestSha256, `lecture ${lecture.lectureId} package manifest differs from captured database provenance`);
      assert(lecture.sourceEvidence.lectureVerificationSha256 === source.lectureVerificationSha256, `lecture ${lecture.lectureId} verification differs from captured database provenance`);
      assert(lecture.sourceEvidence.offlineStatus === source.offlineStatus, `lecture ${lecture.lectureId} offline status differs from captured database provenance`);
    }
    const tracks = TRACKS.map((track) => {
      const key = `${lecture.lectureId}\0${track}`;
      const release = capture.releaseByKey.get(key);
      const pages = capture.pagesByRelease.get(key).map((capturedPage) => {
        const bindings = capturedPage.bindings.map((binding) => {
          let h5ManifestPath = null;
          let h5ManifestSha256 = null;
          if (binding.kind === "h5") {
            const h5 = h5EvidenceByObject.get(binding.objectSha256);
            assert(h5, `H5 ${binding.objectSha256} lacks verified package manifest provenance`);
            usedH5Evidence.add(binding.objectSha256);
            h5ManifestPath = h5.h5ManifestPath;
            h5ManifestSha256 = h5.h5ManifestSha256;
          }
          const normalized = { ...binding, h5ManifestPath, h5ManifestSha256 };
          const resource = {
            objectSha256: normalized.objectSha256,
            kind: normalized.kind,
            mime: normalized.mime,
            byteCount: normalized.byteCount,
            storageBucket: normalized.storageBucket,
            storagePath: normalized.storagePath,
            h5ManifestPath: normalized.h5ManifestPath,
            h5ManifestSha256: normalized.h5ManifestSha256,
          };
          const resourceKey = `${resource.storageBucket}\0${resource.storagePath}`;
          const prior = resourceMap.get(resourceKey);
          assert(!prior || canonicalJson(prior) === canonicalJson(resource), `resource metadata drifts at ${resource.storageBucket}/${resource.storagePath}`);
          resourceMap.set(resourceKey, resource);
          return normalized;
        });
        return {
          pageNo: capturedPage.pageNo,
          pageDocId: capturedPage.pageDocId,
          sourceRevisionId: capturedPage.revisionId,
          docSha256: canonicalSha256(capturedPage.document),
          learningCheckEnabled: capturedPage.learningCheckEnabled,
          requiredBindingKeys: capturedPage.requiredBindingKeys,
          documentBindingKeysSha256: canonicalSha256(capturedPage.requiredBindingKeys),
          bindings,
        };
      });
      const digests = deriveTrackDigests(pages);
      assert(digests.snapshotSha256 === canonicalSha256(release.projectedSnapshot), `release ${release.releaseId} planner digest differs from immutable snapshot projection`);
      return {
        track,
        readiness: lecture.courseSystem === "e-series"
          ? (track === "native-16x9" ? "native-source-verified" : "approved-adaptation")
          : (track === "native-16x9" ? "verified-16x9-projection" : "verified-4x3-source-master"),
        pages,
        pageSetSha256: digests.pageSetSha256,
        bindingSetSha256: digests.bindingSetSha256,
        resourceSetSha256: digests.resourceSetSha256,
        capturedRelease: {
          id: release.releaseId,
          releaseNo: release.releaseNo,
          rawSnapshotSha256: release.rawSnapshotSha256,
          snapshotSha256: digests.snapshotSha256,
        },
        release: {
          releaseNo: 1,
          note: RELEASE_NOTE,
          snapshotSha256: digests.snapshotSha256,
        },
      };
    });
    entries.push({
      courseSystem: lecture.courseSystem,
      course: {
        catalogVersion: lecture.catalogVersion,
        productCode: lecture.productCode,
        grade: lecture.grade,
      },
      lecture: { id: lecture.lectureId, no: lecture.lectureNo },
      source: {
        packageKey: source.packageKey,
        packageVersion: source.packageVersion,
        packageManifestSha256: source.packageManifestSha256,
        lectureVerificationSha256: source.lectureVerificationSha256,
        offlineStatus: source.offlineStatus,
      },
      tracks,
    });
  }
  assert(usedProvenance.size === provenanceByLecture.size, "provenance contains lectures outside the captured scope");
  assert(usedH5Evidence.size === h5EvidenceByObject.size, "H5 manifest evidence contains objects outside the captured scope");
  const sortedEntries = sortCoursewareInventoryEntries(entries);
  return {
    schemaVersion: CAPTURE_VERSION,
    migrationHead,
    databaseFingerprint: canonicalSha256(databaseFingerprintPayload(capture)),
    inventories: [
      { courseSystem: "aixuexi-autumn", entries: sortedEntries.filter((entry) => entry.courseSystem === "aixuexi-autumn") },
      { courseSystem: "e-series", entries: sortedEntries.filter((entry) => entry.courseSystem === "e-series") },
    ],
    storageResources: sortCoursewareStorageResources([...resourceMap.values()]),
  };
}

function bytesFromChunk(chunk, label) {
  if (typeof chunk === "string") fail(`${label} yielded text instead of bytes`);
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  if (ArrayBuffer.isView(chunk)) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  fail(`${label} yielded an unsupported chunk type`);
}

function aborted(signal, label) {
  if (signal?.aborted) fail(`${label} was aborted`);
}

function nextWithAbort(nextPromise, signal, label) {
  if (!signal) return nextPromise;
  aborted(signal, label);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error(`R1 courseware source export: ${label} was aborted`));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(nextPromise).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function consumeWebStream(stream, consume, signal, label) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await nextWithAbort(reader.read(), signal, label);
      if (done) break;
      consume(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * @param {any} stream
 * @param {{expectedSha256?: string | null, expectedByteCount?: number | null, maxBytes?: number, timeoutMs?: number, signal?: AbortSignal, label?: string}} [options]
 */
export async function hashStorageByteStream(stream, {
  expectedSha256 = null,
  expectedByteCount = null,
  maxBytes = expectedByteCount ?? MAX_STORAGE_OBJECT_BYTES,
  timeoutMs = 5 * 60 * 1000,
  signal = undefined,
  label = "Storage object",
} = {}) {
  assert(stream !== null && stream !== undefined, `${label} stream is required`);
  integer(maxBytes, `${label} maxBytes`, 1);
  integer(timeoutMs, `${label} timeoutMs`, 1);
  assert(timeoutMs <= 60 * 60 * 1000, `${label} timeoutMs exceeds the exporter hard limit`);
  assert(maxBytes <= MAX_STORAGE_OBJECT_BYTES, `${label} maxBytes exceeds the exporter hard limit`);
  if (expectedByteCount !== null) assert(expectedByteCount <= maxBytes, `${label} expectedByteCount exceeds maxBytes`);
  const hash = createHash("sha256");
  let byteCount = 0;
  const consume = (chunk) => {
    const bytes = bytesFromChunk(chunk, label);
    byteCount += bytes.byteLength;
    assert(byteCount <= maxBytes, `${label} exceeds ${maxBytes} bytes`);
    hash.update(bytes);
  };
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const effectiveSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  if (typeof stream.getReader === "function") {
    await consumeWebStream(stream, consume, effectiveSignal, label);
  } else if (typeof stream[Symbol.asyncIterator] === "function") {
    const iterator = stream[Symbol.asyncIterator]();
    try {
      while (true) {
        const { done, value } = await nextWithAbort(iterator.next(), effectiveSignal, label);
        if (done) break;
        consume(value);
      }
    } finally {
      await iterator.return?.();
    }
  } else {
    fail(`${label} must be a Web ReadableStream or async iterable`);
  }
  const result = { sha256: hash.digest("hex"), byteCount };
  if (expectedSha256 !== null) assert(result.sha256 === sha256(expectedSha256, `${label} expectedSha256`), `${label} SHA-256 mismatch`);
  if (expectedByteCount !== null) assert(result.byteCount === integer(expectedByteCount, `${label} expectedByteCount`, 0), `${label} byte count mismatch`);
  return result;
}

function safePackagePath(value, label) {
  string(value, label, 1, 500);
  assert(!value.includes("\\") && !value.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(value), `${label} must be a relative forward-slash path`);
  const segments = value.split("/");
  assert(segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".."), `${label} contains an unsafe path segment`);
  return value;
}

/**
 * @param {ArrayBuffer | ArrayBufferView} bytes
 * @param {{expectedPackageHash?: string, expectedByteCount?: number, label?: string}} [options]
 */
export function parseH5PackageManifestBytes(bytes, { expectedPackageHash, expectedByteCount, label = "H5 package manifest" } = {}) {
  const buffer = bytesFromChunk(bytes, label);
  assert(buffer.byteLength <= MAX_H5_MANIFEST_BYTES, `${label} exceeds ${MAX_H5_MANIFEST_BYTES} bytes`);
  let rawText;
  try {
    rawText = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail(`${label} is not valid UTF-8`);
  }
  let manifest;
  try {
    manifest = JSON.parse(rawText);
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
  exactKeys(manifest, ["schemaVersion", "packageHash", "entryPath", "byteCount", "files"], label);
  assert(manifest.schemaVersion === "mathin-h5-manifest-v1", `${label}.schemaVersion is unsupported`);
  const packageHash = sha256(manifest.packageHash, `${label}.packageHash`);
  if (expectedPackageHash !== undefined) assert(packageHash === sha256(expectedPackageHash, `${label} expectedPackageHash`), `${label}.packageHash mismatch`);
  const byteCount = integer(manifest.byteCount, `${label}.byteCount`, 1);
  if (expectedByteCount !== undefined) assert(byteCount === integer(expectedByteCount, `${label} expectedByteCount`, 1), `${label}.byteCount mismatch`);
  const entryPath = safePackagePath(manifest.entryPath, `${label}.entryPath`);
  assert(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= MAX_H5_FILES, `${label}.files must contain 1-${MAX_H5_FILES} entries`);
  const packagePaths = new Set();
  const storagePaths = new Set();
  let summedBytes = 0;
  const files = manifest.files.map((file, index) => {
    const fileLabel = `${label}.files[${index}]`;
    exactKeys(file, ["packagePath", "sha256", "byteCount", "mime"], fileLabel);
    const packagePath = safePackagePath(file.packagePath, `${fileLabel}.packagePath`);
    assert(!packagePaths.has(packagePath), `${label} has duplicate packagePath ${packagePath}`);
    packagePaths.add(packagePath);
    const storagePath = h5StoragePath(packageHash, packagePath);
    assert(!storagePaths.has(storagePath), `${label} maps multiple files to ${storagePath}`);
    storagePaths.add(storagePath);
    const fileByteCount = integer(file.byteCount, `${fileLabel}.byteCount`, 0);
    summedBytes += fileByteCount;
    assert(summedBytes <= MAX_STORAGE_OBJECT_BYTES, `${label} total bytes exceed the exporter hard limit`);
    return {
      packagePath,
      storagePath,
      sha256: sha256(file.sha256, `${fileLabel}.sha256`),
      byteCount: fileByteCount,
      mime: string(file.mime, `${fileLabel}.mime`, 3, 160),
    };
  });
  assert(packagePaths.has(entryPath), `${label}.entryPath is absent from files`);
  assert(summedBytes === byteCount, `${label}.file byte counts do not sum to byteCount`);
  return {
    manifest: { schemaVersion: manifest.schemaVersion, packageHash, entryPath, byteCount, files },
    rawSha256: createHash("sha256").update(buffer).digest("hex"),
    textSha256: createHash("sha256").update(normalizeNewlines(rawText), "utf8").digest("hex"),
  };
}

/**
 * Verify one H5 prefix from the authoritative remote manifest through every
 * listed file. The caller owns Storage authentication/listing and supplies
 * streams only; this core never receives URLs or credentials.
 */
export async function verifyH5PackageStorage({
  packageHash,
  expectedByteCount,
  manifestBytes,
  listedObjectPaths,
  openObjectStream,
  label = `H5 ${packageHash}`,
}) {
  assert(typeof openObjectStream === "function", `${label}.openObjectStream must be a function`);
  const parsed = parseH5PackageManifestBytes(manifestBytes, { expectedPackageHash: packageHash, expectedByteCount, label: `${label} manifest` });
  const manifestStoragePath = `packages/${parsed.manifest.packageHash}/__mathin_manifest.json`;
  const expectedPaths = [manifestStoragePath, ...parsed.manifest.files.map((file) => file.storagePath)].sort(compareText);
  assert(Array.isArray(listedObjectPaths), `${label}.listedObjectPaths must be an array`);
  const actualPaths = listedObjectPaths.map((entry, index) => safePackagePath(entry, `${label}.listedObjectPaths[${index}]`)).sort(compareText);
  assert(new Set(actualPaths).size === actualPaths.length, `${label}.listedObjectPaths contains duplicates`);
  assert(canonicalJson(actualPaths) === canonicalJson(expectedPaths), `${label} Storage file set differs from the package manifest`);
  for (const file of parsed.manifest.files) {
    const stream = await openObjectStream(file.storagePath);
    await hashStorageByteStream(stream, {
      expectedSha256: file.sha256,
      expectedByteCount: file.byteCount,
      maxBytes: Math.max(file.byteCount, 1),
      label: `${label}/${file.packagePath}`,
    });
  }
  return {
    packageHash: parsed.manifest.packageHash,
    entryPath: parsed.manifest.entryPath,
    byteCount: parsed.manifest.byteCount,
    fileCount: parsed.manifest.files.length,
    manifestRawSha256: parsed.rawSha256,
    manifestTextSha256: parsed.textSha256,
  };
}
