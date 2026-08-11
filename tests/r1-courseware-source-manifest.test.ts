import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCoursewareSourcePlan,
  canonicalSha256,
  deriveStorageScope,
  deriveTrackDigests,
  loadCoursewareSourceContext,
} from "../scripts/plan-r1-courseware-source.mjs";
import { textFileSha256 } from "../scripts/lib/text-hash.mjs";

const root = process.cwd();
const exampleManifestPath = "docs/manifests/r1-courseware-source.example.json";
const schemaPath = path.join(root, "schemas", "r1-courseware-source-manifest.schema.json");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function uuid(seed: number) {
  return `${seed.toString(16).padStart(8, "0")}-0000-4000-8000-${seed.toString(16).padStart(12, "0")}`;
}

type CourseSystem = "e-series" | "aixuexi-gplus-autumn";
type Track = "native-16x9" | "adapted-4x3";

function binding(system: CourseSystem, track: Track, index: number) {
  const h5 = system === "aixuexi-gplus-autumn" && track === "native-16x9" && index === 1;
  const objectSha256 = hash(`${system}:${track}:${index}:object`);
  const adaptedBackground = system === "e-series" && track === "adapted-4x3";
  return {
    bindingKey: hash(`${system}:${track}:${index}:binding`),
    assetRevisionId: uuid(500_000 + index * 2 + (track === "adapted-4x3" ? 1 : 0)),
    objectSha256,
    kind: h5 ? "h5" : "image",
    role: h5 ? "interactive" : "background",
    variant: adaptedBackground ? "mathin-4x3" : "source",
    mime: h5 ? "application/x-mathin-h5-package" : "image/png",
    byteCount: 100 + index,
    storageBucket: h5 ? "cw-h5" : "cw-objects",
    storagePath: h5 ? `packages/${objectSha256}` : `sha256/${objectSha256.slice(0, 2)}/${objectSha256}`,
    h5ManifestSha256: h5 ? hash(`${system}:${track}:${index}:h5-manifest`) : null,
    adaptationStatus: adaptedBackground ? "approved" : "not-required",
  };
}

function track(system: CourseSystem, name: Track, index: number, pageDocId: string) {
  const asset = binding(system, name, index);
  const page = {
    pageNo: 1,
    pageDocId,
    sourceRevisionId: uuid(200_000 + index * 2 + (name === "adapted-4x3" ? 1 : 0)),
    docSha256: hash(`${system}:${name}:${index}:doc`),
    documentBindingKeysSha256: canonicalSha256([asset.bindingKey]),
    bindings: [asset],
  };
  const digests = deriveTrackDigests([page]);
  const readiness = system === "e-series"
    ? (name === "native-16x9" ? "native-source-verified" : "approved-adaptation")
    : (name === "native-16x9" ? "verified-16x9-projection" : "verified-4x3-source-master");
  return {
    track: name,
    readiness,
    pages: [page],
    pageSetSha256: digests.pageSetSha256,
    bindingSetSha256: digests.bindingSetSha256,
    resourceSetSha256: digests.resourceSetSha256,
    release: { releaseNo: 1, note: "production-v1.0-baseline", snapshotSha256: digests.snapshotSha256 },
  };
}

function lectureEntry(
  system: CourseSystem,
  index: number,
  course: { catalogVersion: string; productCode: string; grade: number },
  lectureNo: number,
) {
  const pageDocId = uuid(100_000 + index);
  return {
    courseSystem: system,
    course,
    lecture: { id: uuid(index), no: lectureNo },
    source: {
      packageManifestSha256: hash(`${system}:${course.catalogVersion}:${course.productCode}:package`),
      lectureVerificationSha256: hash(`${system}:${index}:verification`),
      offlineStatus: "complete",
    },
    tracks: [
      track(system, "native-16x9", index, pageDocId),
      track(system, "adapted-4x3", index, pageDocId),
    ],
  };
}

function buildFullEntries() {
  let index = 1;
  const aixuexi: ReturnType<typeof lectureEntry>[] = [];
  const lectureNos = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14];
  for (const grade of [3, 4, 5, 6]) {
    const productCode = `AXX26G-SJ-0${grade}-AUT`;
    for (const lectureNo of lectureNos) {
      aixuexi.push(lectureEntry("aixuexi-gplus-autumn", index++, { catalogVersion: "default", productCode, grade }, lectureNo));
    }
  }

  const eSeries: ReturnType<typeof lectureEntry>[] = [];
  for (let courseIndex = 1; courseIndex <= 54; courseIndex += 1) {
    const count = courseIndex <= 3 ? 13 : 12;
    const productCode = `MFHK-E-2025-${String(courseIndex).padStart(3, "0")}`;
    for (let lectureNo = 1; lectureNo <= count; lectureNo += 1) {
      eSeries.push(lectureEntry("e-series", index++, { catalogVersion: "2025", productCode, grade: ((courseIndex - 1) % 6) + 1 }, lectureNo));
    }
  }
  for (let courseIndex = 1; courseIndex <= 36; courseIndex += 1) {
    const count = courseIndex <= 16 ? 14 : 13;
    const productCode = `MFHK-E-2026-${String(courseIndex).padStart(3, "0")}`;
    for (let lectureNo = 1; lectureNo <= count; lectureNo += 1) {
      eSeries.push(lectureEntry("e-series", index++, { catalogVersion: "2026", productCode, grade: ((courseIndex - 1) % 6) + 1 }, lectureNo));
    }
  }
  return { aixuexi, eSeries };
}

function writeNdjson(target: string, entries: unknown[]) {
  fs.writeFileSync(target, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

function writeFullFixture(temp: string) {
  const entries = buildFullEntries();
  const aixuexiPath = path.join(temp, "aixuexi.ndjson");
  const eSeriesPath = path.join(temp, "e-series.ndjson");
  writeNdjson(aixuexiPath, entries.aixuexi);
  writeNdjson(eSeriesPath, entries.eSeries);
  const allEntries = [...entries.aixuexi, ...entries.eSeries];
  const h5Scope = deriveStorageScope(allEntries, "cw-h5");
  const objectScope = deriveStorageScope(allEntries, "cw-objects");
  const manifest = {
    $schema: schemaPath,
    schemaVersion: "mathin-r1-courseware-source-manifest-v1",
    example: false,
    mode: "plan-only",
    writesAllowed: false,
    networkAllowed: false,
    databaseConnectionAllowed: false,
    capturedFrom: {
      environment: "offline-read-only-export",
      readOnly: true,
      databaseFingerprint: hash("full-fixture-database"),
      migrationHead: "20260812000100_r1_notebook_interaction_privacy",
      exportedAt: "2026-08-12T00:00:00Z",
    },
    inventories: [
      { courseSystem: "aixuexi-gplus-autumn", path: aixuexiPath, sha256: textFileSha256(aixuexiPath) },
      { courseSystem: "e-series", path: eSeriesPath, sha256: textFileSha256(eSeriesPath) },
    ],
    storageAudits: [
      {
        bucket: "cw-h5", prefix: "packages/", status: "passed", ...h5Scope,
        objectsManifestSha256: hash("full-fixture-h5-storage-manifest"), missingObjectCount: 0, hashMismatchCount: 0,
      },
      {
        bucket: "cw-objects", prefix: "sha256/", status: "passed", ...objectScope,
        objectsManifestSha256: hash("full-fixture-object-storage-manifest"), missingObjectCount: 0, hashMismatchCount: 0,
      },
    ],
    expected: {
      courseCount: 94,
      lectureCount: 1187,
      nativeTrackCount: 1187,
      adaptedTrackCount: 1187,
      releaseCount: 2374,
      missingBindingCount: 0,
      missingResourceCount: 0,
      storageHashMismatchCount: 0,
    },
  };
  const manifestPath = path.join(temp, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifestPath, manifest, entries, paths: { aixuexiPath, eSeriesPath } };
}

function readExampleManifest() {
  return JSON.parse(fs.readFileSync(path.join(root, exampleManifestPath), "utf8"));
}

function writeManifest(temp: string, value: Record<string, unknown>) {
  value.$schema = schemaPath;
  const target = path.join(temp, "manifest.json");
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return target;
}

describe("R1-9 P6 courseware source manifest", () => {
  it("keeps the repository example deterministic, read-only, and visibly blocked", () => {
    const first = buildCoursewareSourcePlan(loadCoursewareSourceContext({ root, manifestPath: exampleManifestPath }));
    const second = buildCoursewareSourcePlan(loadCoursewareSourceContext({ root, manifestPath: exampleManifestPath }));

    expect(first).toEqual(second);
    expect(first.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.actual).toMatchObject({ courseCount: 2, lectureCount: 2, nativeTrackCount: 2, adaptedTrackCount: 2, releaseCount: 4 });
    expect(first.expected).toMatchObject({ courseCount: 94, lectureCount: 1187, releaseCount: 2374 });
    expect(first.blockers).toEqual([
      "example-manifest",
      "incomplete-inventory:aixuexi-gplus-autumn",
      "incomplete-inventory:e-series",
      "storage-audit-pending:cw-h5",
      "storage-audit-pending:cw-objects",
    ]);
    expect(first.p6SourceManifestReady).toBe(false);
    expect(first.stageClosureAllowed).toBe(false);
    expect(first.guards).toMatchObject({
      productionConnectionAllowed: false,
      sqlGenerationAllowed: false,
      cleanupExecutionAllowed: false,
      releaseExecutionAllowed: false,
    });
  });

  it("accepts a complete 90+4 course, 1135+52 lecture, two-track source inventory", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-courseware-source-"));
    try {
      const fixture = writeFullFixture(temp);
      const firstContext = loadCoursewareSourceContext({ root, manifestPath: fixture.manifestPath });
      const secondContext = loadCoursewareSourceContext({ root, manifestPath: fixture.manifestPath });
      const first = buildCoursewareSourcePlan(firstContext);
      const second = buildCoursewareSourcePlan(secondContext);

      expect(first).toEqual(second);
      expect(first.blockers).toEqual([]);
      expect(first.p6SourceManifestReady).toBe(true);
      expect(first.stageClosureAllowed).toBe(false);
      expect(first.actual).toEqual(first.expected);
      expect(first.courseSystems).toEqual([
        expect.objectContaining({ key: "aixuexi-gplus-autumn", courseCount: 4, lectureCount: 52, releaseCount: 104 }),
        expect.objectContaining({ key: "e-series", courseCount: 90, lectureCount: 1135, releaseCount: 2270 }),
      ]);
      expect(first.releaseTarget).toEqual({ releaseNo: 1, note: "production-v1.0-baseline", count: 2374, legacyNativeHeadCount: 1187 });
      expect(first.storage.every((audit: { status: string; missingObjectCount: number; hashMismatchCount: number }) => (
        audit.status === "passed" && audit.missingObjectCount === 0 && audit.hashMismatchCount === 0
      ))).toBe(true);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects writable/networked manifests and inventory file hash drift", () => {
    const source = readExampleManifest();
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-courseware-source-"));
    try {
      for (const [field, value, error] of [
        ["writesAllowed", true, /writesAllowed must be false/],
        ["networkAllowed", true, /networkAllowed must be false/],
        ["databaseConnectionAllowed", true, /databaseConnectionAllowed must be false/],
      ] as const) {
        const changed = clone(source);
        changed[field] = value;
        expect(() => loadCoursewareSourceContext({ root, manifestPath: writeManifest(temp, changed) })).toThrow(error);
      }

      const drift = clone(source);
      drift.inventories[0].sha256 = "0".repeat(64);
      expect(() => loadCoursewareSourceContext({ root, manifestPath: writeManifest(temp, drift) })).toThrow(/does not match the LF-normalized inventory file/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("rejects unresolved document bindings, snapshot drift, and non-content-addressed Storage paths", () => {
    const source = readExampleManifest();
    const original = JSON.parse(fs.readFileSync(path.join(root, "docs/manifests/r1-courseware-e-series.example.ndjson"), "utf8"));
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-courseware-source-"));
    try {
      const cases: Array<[string, (entry: ReturnType<typeof lectureEntry>) => void, RegExp]> = [
        ["doc-binding", (entry) => { entry.tracks[0].pages[0].documentBindingKeysSha256 = "0".repeat(64); }, /documentBindingKeysSha256 does not match/],
        ["snapshot", (entry) => { entry.tracks[0].release.snapshotSha256 = "0".repeat(64); }, /snapshotSha256 does not match/],
        ["storage-path", (entry) => { entry.tracks[0].pages[0].bindings[0].storagePath = "sha256/unsafe"; }, /content addressed by objectSha256/],
      ];
      for (const [name, mutate, error] of cases) {
        const entry = clone(original);
        mutate(entry);
        const inventoryPath = path.join(temp, `${name}.ndjson`);
        writeNdjson(inventoryPath, [entry]);
        const manifest = clone(source);
        manifest.inventories[1].path = inventoryPath;
        manifest.inventories[1].sha256 = textFileSha256(inventoryPath);
        expect(() => loadCoursewareSourceContext({ root, manifestPath: writeManifest(temp, manifest) })).toThrow(error);
      }
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("rejects unapproved E-series 4:3 backgrounds and H5 packages without manifest hashes", () => {
    const source = readExampleManifest();
    const eSeries = JSON.parse(fs.readFileSync(path.join(root, "docs/manifests/r1-courseware-e-series.example.ndjson"), "utf8"));
    const aixuexi = JSON.parse(fs.readFileSync(path.join(root, "docs/manifests/r1-courseware-aixuexi.example.ndjson"), "utf8"));
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-courseware-source-"));
    try {
      const unapproved = clone(eSeries);
      unapproved.tracks[1].pages[0].bindings[0].adaptationStatus = "not-required";
      const unapprovedPath = path.join(temp, "unapproved.ndjson");
      writeNdjson(unapprovedPath, [unapproved]);
      const unapprovedManifest = clone(source);
      unapprovedManifest.inventories[1].path = unapprovedPath;
      unapprovedManifest.inventories[1].sha256 = textFileSha256(unapprovedPath);
      expect(() => loadCoursewareSourceContext({ root, manifestPath: writeManifest(temp, unapprovedManifest) })).toThrow(/adaptationStatus does not match/);

      const h5WithoutManifest = clone(aixuexi);
      h5WithoutManifest.tracks[0].pages[0].bindings[0].h5ManifestSha256 = null;
      const h5Path = path.join(temp, "h5.ndjson");
      writeNdjson(h5Path, [h5WithoutManifest]);
      const h5Manifest = clone(source);
      h5Manifest.inventories[0].path = h5Path;
      h5Manifest.inventories[0].sha256 = textFileSha256(h5Path);
      expect(() => loadCoursewareSourceContext({ root, manifestPath: writeManifest(temp, h5Manifest) })).toThrow(/h5ManifestSha256 must be a lowercase SHA-256/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("preserves the four AIXUEXI grade scopes and explicit source gaps 7 and 15", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-courseware-source-"));
    try {
      const fixture = writeFullFixture(temp);
      const rows = fixture.entries.aixuexi;
      rows.find((entry) => entry.course.grade === 3 && entry.lecture.no === 8)!.lecture.no = 7;
      writeNdjson(fixture.paths.aixuexiPath, rows);
      fixture.manifest.inventories[0].sha256 = textFileSha256(fixture.paths.aixuexiPath);
      const manifestPath = writeManifest(temp, fixture.manifest);
      expect(() => loadCoursewareSourceContext({ root, manifestPath })).toThrow(/explicit 7\/15 source gaps/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }, 30_000);

  it("ships a strict schema and an executor without network, database, SQL, or child-process capability", () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const source = fs.readFileSync(path.join(root, "scripts/plan-r1-courseware-source.mjs"), "utf8");

    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.writesAllowed.const).toBe(false);
    expect(schema.properties.networkAllowed.const).toBe(false);
    expect(schema.properties.databaseConnectionAllowed.const).toBe(false);
    expect(schema.properties.expected.properties).toMatchObject({
      courseCount: { const: 94 },
      lectureCount: { const: 1187 },
      nativeTrackCount: { const: 1187 },
      adaptedTrackCount: { const: 1187 },
      releaseCount: { const: 2374 },
    });
    expect(source).not.toMatch(/from ["']node:(?:http|https|net|tls|child_process)["']/);
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("DATABASE_URL");
    expect(source).not.toContain("SUPABASE_");
    expect(source).not.toMatch(/\b(?:insert|update|delete|truncate)\s+(?:into|from|table)?\s*public\./i);
  });
});
