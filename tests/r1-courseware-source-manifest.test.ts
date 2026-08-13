import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCoursewareSourcePlan,
  canonicalSha256,
  deriveReleaseSnapshot,
  deriveTrackDigests,
  loadCoursewareSourceContext,
} from "../scripts/plan-r1-courseware-source.mjs";
import { textFileSha256 } from "../scripts/lib/text-hash.mjs";

const repositoryRoot = process.cwd();
const exampleManifestPath = "docs/manifests/r1-courseware-source.example.json";
const schemaRelativePath = "schemas/r1-courseware-source-manifest.schema.json";
const rosterRelativePath = "supabase/seed/teaching-plans.json";
const schemaPath = path.join(repositoryRoot, schemaRelativePath);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function uuid(seed: string | number) {
  const digest = hash(String(seed));
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

type CourseSystem = "e-series" | "aixuexi-autumn";
type Track = "native-16x9" | "adapted-4x3";
type Course = { catalogVersion: string; productCode: string; grade: number };
type SourcePackage = { packageKey: string; packageVersion: string };
type H5Evidence = { path: string; sha256: string };

function binding(system: CourseSystem, track: Track, index: number, h5Evidence: H5Evidence) {
  const h5 = system === "aixuexi-autumn" && track === "native-16x9" && index === 1;
  const objectSha256 = hash(`${system}:${track}:${index}:object`);
  const adaptedBackground = system === "e-series" && track === "adapted-4x3";
  return {
    bindingKey: hash(`${system}:${track}:${index}:binding`),
    assetRevisionId: uuid(`${system}:${track}:${index}:asset-revision`),
    objectSha256,
    kind: h5 ? "h5" : "image",
    role: h5 ? "interactive" : "background",
    variant: adaptedBackground ? "mathin-4x3" : "source",
    mime: h5 ? "application/x-mathin-h5-package" : "image/png",
    byteCount: 100 + index,
    storageBucket: h5 ? "cw-h5" : "cw-objects",
    storagePath: h5 ? `packages/${objectSha256}` : `sha256/${objectSha256.slice(0, 2)}/${objectSha256}`,
    h5ManifestPath: h5 ? h5Evidence.path : null,
    h5ManifestSha256: h5 ? h5Evidence.sha256 : null,
    adaptationStatus: adaptedBackground ? "approved" : "not-required",
  };
}

function track(system: CourseSystem, name: Track, index: number, pageDocId: string, h5Evidence: H5Evidence) {
  const asset = binding(system, name, index, h5Evidence);
  const page = {
    pageNo: 1,
    pageDocId,
    sourceRevisionId: uuid(`${system}:${name}:${index}:source-revision`),
    docSha256: hash(`${system}:${name}:${index}:doc`),
    learningCheckEnabled: index % 2 === 0,
    requiredBindingKeys: [asset.bindingKey],
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
  course: Course,
  lectureNo: number,
  sourcePackage: SourcePackage,
  h5Evidence: H5Evidence,
) {
  const pageDocId = uuid(`${system}:${index}:page`);
  return {
    courseSystem: system,
    course,
    lecture: { id: uuid(`${system}:${index}:lecture`), no: lectureNo },
    source: {
      ...sourcePackage,
      packageManifestSha256: hash(`${sourcePackage.packageKey}:${sourcePackage.packageVersion}:manifest`),
      lectureVerificationSha256: hash(`${system}:${index}:verification`),
      offlineStatus: "complete",
    },
    tracks: [
      track(system, "native-16x9", index, pageDocId, h5Evidence),
      track(system, "adapted-4x3", index, pageDocId, h5Evidence),
    ],
  };
}

function prepareFixtureRoot(temp: string) {
  for (const relative of [schemaRelativePath, rosterRelativePath]) {
    const target = path.join(temp, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, relative), target);
  }
  fs.mkdirSync(path.join(temp, "artifacts"), { recursive: true });
}

function writeH5Manifest(temp: string): H5Evidence {
  const relativePath = "artifacts/h5-package.json";
  const packageHash = hash("aixuexi-autumn:native-16x9:1:object");
  const manifest = {
    schemaVersion: "mathin-h5-manifest-v1",
    packageHash,
    entryPath: "index.html",
    byteCount: 101,
    files: [{ packagePath: "index.html", sha256: hash("full-fixture-h5-index"), byteCount: 101, mime: "text/html" }],
  };
  const target = path.join(temp, relativePath);
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { path: relativePath, sha256: textFileSha256(target) };
}

function buildFullEntries(h5Evidence: H5Evidence) {
  let index = 1;
  const aixuexi: Array<ReturnType<typeof lectureEntry>> = [];
  const fullLectureNos = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const gapLectureNos = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14];
  const courses = [
    ...[3, 4, 5, 6].map((grade) => ({ productCode: `AXX26G-SJ-0${grade}-AUT`, grade, packageKey: "2026-gplus-sujiao-math", lectureNos: [3, 4].includes(grade) ? fullLectureNos : gapLectureNos })),
    ...[1, 2, 3, 4, 5, 6].map((grade) => ({ productCode: `AXX26X-SJ-0${grade}-AUT`, grade, packageKey: "2026-xplus-sujiao-math", lectureNos: [1, 3, 4].includes(grade) ? fullLectureNos : gapLectureNos })),
    ...[1, 2].map((grade) => ({ productCode: `AXX26A-QG-0${grade}-AUT`, grade, packageKey: "2026-aplus-quanguo-math", lectureNos: fullLectureNos })),
  ];
  for (const course of courses) {
    const sourcePackage = { packageKey: course.packageKey, packageVersion: "projection-v31-2026-08-13" };
    for (const lectureNo of course.lectureNos) {
      aixuexi.push(lectureEntry("aixuexi-autumn", index++, { catalogVersion: "default", productCode: course.productCode, grade: course.grade }, lectureNo, sourcePackage, h5Evidence));
    }
  }

  const roster = JSON.parse(fs.readFileSync(path.join(repositoryRoot, rosterRelativePath), "utf8")) as Array<{
    productCode: string;
    catalogVersion: string;
    grade: number;
    term: string;
    lectures: Array<{ no: number }>;
  }>;
  const eSeries: Array<ReturnType<typeof lectureEntry>> = [];
  for (const rosterCourse of roster) {
    const autumn2026 = rosterCourse.catalogVersion === "2026" && rosterCourse.term === "秋季";
    const sourcePackage = autumn2026
      ? { packageKey: "mofaxiao-e-math-2026-autumn-2026-08-03", packageVersion: "8a4001a9-2ab7-47a8-ac7b-3c004d427682" }
      : { packageKey: "mofaxiao-e-math-baseline-2026-07-17", packageVersion: "2490b13a-44cc-4b34-a68f-e45df77c5c45" };
    for (const lecture of rosterCourse.lectures) {
      eSeries.push(lectureEntry(
        "e-series",
        index++,
        { catalogVersion: rosterCourse.catalogVersion, productCode: rosterCourse.productCode, grade: rosterCourse.grade },
        lecture.no,
        sourcePackage,
        h5Evidence,
      ));
    }
  }
  const order = (left: ReturnType<typeof lectureEntry>, right: ReturnType<typeof lectureEntry>) => (
    `${left.course.catalogVersion}\0${left.course.productCode}\0${String(left.lecture.no).padStart(8, "0")}\0${left.lecture.id}`
      .localeCompare(`${right.course.catalogVersion}\0${right.course.productCode}\0${String(right.lecture.no).padStart(8, "0")}\0${right.lecture.id}`)
  );
  return { aixuexi: aixuexi.sort(order), eSeries: eSeries.sort(order) };
}

function writeNdjson(target: string, entries: unknown[]) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

function resourceRows(entries: Array<ReturnType<typeof lectureEntry>>, bucket: "cw-h5" | "cw-objects") {
  const resources = new Map<string, {
    objectSha256: string;
    kind: string;
    mime: string;
    byteCount: number;
    storageBucket: string;
    storagePath: string;
    h5ManifestPath: string | null;
    h5ManifestSha256: string | null;
  }>();
  for (const entry of entries) {
    for (const currentTrack of entry.tracks) {
      for (const page of currentTrack.pages) {
        for (const currentBinding of page.bindings) {
          if (currentBinding.storageBucket !== bucket) continue;
          const resource = {
            objectSha256: currentBinding.objectSha256,
            kind: currentBinding.kind,
            mime: currentBinding.mime,
            byteCount: currentBinding.byteCount,
            storageBucket: currentBinding.storageBucket,
            storagePath: currentBinding.storagePath,
            h5ManifestPath: currentBinding.h5ManifestPath,
            h5ManifestSha256: currentBinding.h5ManifestSha256,
          };
          resources.set(`${resource.storageBucket}\0${resource.storagePath}`, resource);
        }
      }
    }
  }
  return [...resources.values()].sort((left, right) => left.storagePath.localeCompare(right.storagePath));
}

function writeFullFixture(temp: string) {
  prepareFixtureRoot(temp);
  const h5Evidence = writeH5Manifest(temp);
  const entries = buildFullEntries(h5Evidence);
  const aixuexiPath = path.join(temp, "artifacts/aixuexi.ndjson");
  const eSeriesPath = path.join(temp, "artifacts/e-series.ndjson");
  writeNdjson(aixuexiPath, entries.aixuexi);
  writeNdjson(eSeriesPath, entries.eSeries);
  const allEntries = [...entries.aixuexi, ...entries.eSeries];
  const h5AuditPath = path.join(temp, "artifacts/cw-h5-objects.ndjson");
  const objectAuditPath = path.join(temp, "artifacts/cw-objects.ndjson");
  writeNdjson(h5AuditPath, resourceRows(allEntries, "cw-h5"));
  writeNdjson(objectAuditPath, resourceRows(allEntries, "cw-objects"));
  const manifest = {
    $schema: schemaRelativePath,
    schemaVersion: "mathin-r1-courseware-source-manifest-v2",
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
      { courseSystem: "aixuexi-autumn", path: "artifacts/aixuexi.ndjson", sha256: textFileSha256(aixuexiPath) },
      {
        courseSystem: "e-series",
        path: "artifacts/e-series.ndjson",
        sha256: textFileSha256(eSeriesPath),
        roster: { path: rosterRelativePath, sha256: textFileSha256(path.join(temp, rosterRelativePath)) },
      },
    ],
    storageAudits: [
      { bucket: "cw-h5", prefix: "packages/", objectsManifestPath: "artifacts/cw-h5-objects.ndjson", objectsManifestSha256: textFileSha256(h5AuditPath) },
      { bucket: "cw-objects", prefix: "sha256/", objectsManifestPath: "artifacts/cw-objects.ndjson", objectsManifestSha256: textFileSha256(objectAuditPath) },
    ],
    expected: {
      courseCount: 102,
      lectureCount: 1305,
      nativeTrackCount: 1305,
      adaptedTrackCount: 1305,
      releaseCount: 2610,
      missingBindingCount: 0,
      missingResourceCount: 0,
      storageHashMismatchCount: 0,
    },
  };
  const manifestPath = path.join(temp, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    manifest,
    manifestPath: "manifest.json",
    entries,
    paths: { aixuexiPath, eSeriesPath, h5AuditPath, objectAuditPath, manifestPath },
  };
}

function copyExampleFixture(temp: string) {
  prepareFixtureRoot(temp);
  const files = [
    "docs/manifests/r1-courseware-source.example.json",
    "docs/manifests/r1-courseware-aixuexi.example.ndjson",
    "docs/manifests/r1-courseware-e-series.example.ndjson",
    "docs/manifests/r1-courseware-cw-h5-objects.example.ndjson",
    "docs/manifests/r1-courseware-cw-objects.example.ndjson",
    "docs/manifests/r1-courseware-h5-package.example.json",
  ];
  for (const relative of files) {
    const target = path.join(temp, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, relative), target);
  }
  return JSON.parse(fs.readFileSync(path.join(temp, exampleManifestPath), "utf8"));
}

function writeExampleManifest(temp: string, manifest: Record<string, unknown>) {
  const relative = "docs/manifests/test-manifest.json";
  fs.writeFileSync(path.join(temp, relative), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return relative;
}

function writeRootManifest(temp: string, manifest: Record<string, unknown>) {
  fs.writeFileSync(path.join(temp, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

describe("R1-9 P6 courseware source manifest", () => {
  it("keeps the repository example deterministic, read-only, and visibly blocked", () => {
    const first = buildCoursewareSourcePlan(loadCoursewareSourceContext({ root: repositoryRoot, manifestPath: exampleManifestPath }));
    const second = buildCoursewareSourcePlan(loadCoursewareSourceContext({ root: repositoryRoot, manifestPath: exampleManifestPath }));

    expect(first).toEqual(second);
    expect(first.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.actual).toMatchObject({ courseCount: 2, lectureCount: 2, nativeTrackCount: 2, adaptedTrackCount: 2, releaseCount: 4 });
    expect(first.expected).toMatchObject({ courseCount: 102, lectureCount: 1305, releaseCount: 2610 });
    expect(first.blockers).toEqual([
      "example-manifest",
      "incomplete-inventory:aixuexi-autumn",
      "incomplete-inventory:e-series",
    ]);
    expect(first.p6SourceManifestReady).toBe(false);
    expect(first.stageClosureAllowed).toBe(false);
  });

  it("uses the active release snapshot canonical contract including learningCheckEnabled", () => {
    const entry = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "docs/manifests/r1-courseware-e-series.example.ndjson"), "utf8"));
    const page = entry.tracks[0].pages[0];
    expect(deriveReleaseSnapshot([page])).toEqual([{
      pageDocId: page.pageDocId,
      revisionId: page.sourceRevisionId,
      bindings: page.bindings.map((item: { bindingKey: string; assetRevisionId: string }) => ({
        bindingKey: item.bindingKey,
        assetRevisionId: item.assetRevisionId,
      })),
      learningCheckEnabled: page.learningCheckEnabled,
    }]);
    const changed = clone(page);
    changed.learningCheckEnabled = !changed.learningCheckEnabled;
    expect(deriveTrackDigests([changed]).snapshotSha256).not.toBe(deriveTrackDigests([page]).snapshotSha256);
    const migration = fs.readFileSync(path.join(repositoryRoot, "supabase/migrations/20260730000400_r1_courseware_page_learning_check_flags.sql"), "utf8");
    expect(migration).toMatch(/'learningCheckEnabled',\s*rows\.learning_check_enabled/);
  });

  it("accepts the exact 90+12 course, 1135+170 lecture, two-track, 2610 release-1 target", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-courseware-source-"));
    try {
      const fixture = writeFullFixture(temp);
      const first = buildCoursewareSourcePlan(loadCoursewareSourceContext({ root: temp, manifestPath: fixture.manifestPath }));
      const second = buildCoursewareSourcePlan(loadCoursewareSourceContext({ root: temp, manifestPath: fixture.manifestPath }));
      expect(first).toEqual(second);
      expect(first.blockers).toEqual([]);
      expect(first.p6SourceManifestReady).toBe(true);
      expect(first.stageClosureAllowed).toBe(false);
      expect(first.actual).toEqual(first.expected);
      expect(first.courseSystems).toEqual([
        expect.objectContaining({ key: "aixuexi-autumn", courseCount: 12, lectureCount: 170, releaseCount: 340 }),
        expect.objectContaining({ key: "e-series", courseCount: 90, lectureCount: 1135, releaseCount: 2270 }),
      ]);
      expect(first.releaseTarget).toEqual({ releaseNo: 1, note: "production-v1.0-baseline", count: 2610, legacyNativeHeadCount: 1305 });

      const objectRows = fs.readFileSync(fixture.paths.objectAuditPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      objectRows[0].byteCount += 1;
      writeNdjson(fixture.paths.objectAuditPath, objectRows);
      fixture.manifest.storageAudits[1].objectsManifestSha256 = textFileSha256(fixture.paths.objectAuditPath);
      writeRootManifest(temp, fixture.manifest);
      expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: fixture.manifestPath })).toThrow(/resource metadata\/hash mismatches/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects learning-check snapshot drift and incomplete required bindings", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-courseware-source-"));
    try {
      const source = copyExampleFixture(temp);
      const inventoryPath = path.join(temp, "docs/manifests/r1-courseware-e-series.example.ndjson");
      const original = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));

      const snapshotDrift = clone(original);
      snapshotDrift.tracks[0].pages[0].learningCheckEnabled = !snapshotDrift.tracks[0].pages[0].learningCheckEnabled;
      writeNdjson(inventoryPath, [snapshotDrift]);
      source.inventories[1].sha256 = textFileSha256(inventoryPath);
      expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: writeExampleManifest(temp, source) })).toThrow(/snapshotSha256 does not match/);

      const missing = clone(original);
      const page = missing.tracks[0].pages[0];
      page.requiredBindingKeys = [...page.requiredBindingKeys, hash("missing-required-binding")].sort();
      page.documentBindingKeysSha256 = canonicalSha256(page.requiredBindingKeys);
      writeNdjson(inventoryPath, [missing]);
      source.inventories[1].sha256 = textFileSha256(inventoryPath);
      expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: writeExampleManifest(temp, source) })).toThrow(/is missing required bindings/);

      const empty = clone(original);
      empty.tracks[0].pages[0].bindings = [];
      writeNdjson(inventoryPath, [empty]);
      source.inventories[1].sha256 = textFileSha256(inventoryPath);
      expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: writeExampleManifest(temp, source) })).toThrow(/bindings must be non-empty/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("binds every E-series row to the reviewed roster and fixed source package", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-courseware-source-"));
    try {
      const source = copyExampleFixture(temp);
      const inventoryPath = path.join(temp, "docs/manifests/r1-courseware-e-series.example.ndjson");
      const original = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
      const cases: Array<[string, (entry: typeof original) => void, RegExp]> = [
        ["grade", (entry) => { entry.course.grade = 6; }, /grade does not match the fixed E-series roster/],
        ["package", (entry) => { entry.source.packageVersion = "swapped-package-version"; }, /packageVersion does not match the fixed E-series package roster/],
        ["lecture-no", (entry) => { entry.lecture.no = 999; }, /lecture.no is absent from the fixed E-series course roster/],
      ];
      for (const [, mutate, error] of cases) {
        const entry = clone(original);
        mutate(entry);
        writeNdjson(inventoryPath, [entry]);
        source.inventories[1].sha256 = textFileSha256(inventoryPath);
        expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: writeExampleManifest(temp, source) })).toThrow(error);
      }

      const duplicate = clone(original);
      duplicate.lecture.id = uuid("swapped-uuid-duplicate-natural-key");
      writeNdjson(inventoryPath, [original, duplicate]);
      source.inventories[1].sha256 = textFileSha256(inventoryPath);
      expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: writeExampleManifest(temp, source) })).toThrow(/duplicates the fixed \(course, lecture.no\) identity/);

      const rosterDrift = clone(source);
      rosterDrift.inventories[1].roster.sha256 = hash("unreviewed-roster");
      expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: writeExampleManifest(temp, rosterDrift) })).toThrow(/must bind the reviewed E-series roster artifact/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("requires readable, LF-hashed Storage and H5 audit artifacts", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-courseware-source-"));
    try {
      const source = copyExampleFixture(temp);
      const drifted = clone(source);
      drifted.storageAudits[0].objectsManifestSha256 = hash("wrong-storage-audit-file");
      expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: writeExampleManifest(temp, drifted) })).toThrow(/does not match the LF-normalized Storage objects manifest/);

      const inventoryPath = path.join(temp, "docs/manifests/r1-courseware-aixuexi.example.ndjson");
      const entry = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
      const h5ManifestPath = path.join(temp, entry.tracks[0].pages[0].bindings[0].h5ManifestPath);
      const h5Manifest = JSON.parse(fs.readFileSync(h5ManifestPath, "utf8"));
      h5Manifest.packageHash = hash("wrong-h5-package");
      fs.writeFileSync(h5ManifestPath, `${JSON.stringify(h5Manifest, null, 2)}\n`, "utf8");
      entry.tracks[0].pages[0].bindings[0].h5ManifestSha256 = textFileSha256(h5ManifestPath);
      writeNdjson(inventoryPath, [entry]);
      source.inventories[0].sha256 = textFileSha256(inventoryPath);
      expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: writeExampleManifest(temp, source) })).toThrow(/packageHash must match objectSha256/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("cannot omit, relabel, or unapprove the E-series adapted background", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-courseware-source-"));
    try {
      const source = copyExampleFixture(temp);
      const inventoryPath = path.join(temp, "docs/manifests/r1-courseware-e-series.example.ndjson");
      const original = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));

      const relabeled = clone(original);
      const relabeledBinding = relabeled.tracks[1].pages[0].bindings[0];
      relabeledBinding.role = "illustration";
      relabeledBinding.variant = "source";
      relabeledBinding.adaptationStatus = "not-required";
      writeNdjson(inventoryPath, [relabeled]);
      source.inventories[1].sha256 = textFileSha256(inventoryPath);
      expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: writeExampleManifest(temp, source) })).toThrow(/must explicitly bind an approved background\/mathin-4x3 resource/);

      const unapproved = clone(original);
      unapproved.tracks[1].pages[0].bindings[0].adaptationStatus = "not-required";
      writeNdjson(inventoryPath, [unapproved]);
      source.inventories[1].sha256 = textFileSha256(inventoryPath);
      expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: writeExampleManifest(temp, source) })).toThrow(/adaptationStatus does not match/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("rejects URI, UNC, absolute, drive-qualified, and root-external paths before reading", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-courseware-source-"));
    try {
      const source = copyExampleFixture(temp);
      const cases: Array<[string, RegExp]> = [
        ["https://example.invalid/inventory.ndjson", /must not contain an endpoint|must not be a URI/],
        ["//server/share/inventory.ndjson", /must not be absolute or UNC/],
        ["C:/Windows/inventory.ndjson", /must not be a URI or drive-qualified path/],
        ["../outside.ndjson", /must remain inside the repository/],
      ];
      for (const [unsafePath, error] of cases) {
        const changed = clone(source);
        changed.inventories[0].path = unsafePath;
        expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: writeExampleManifest(temp, changed) })).toThrow(error);
      }
      expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: path.join(temp, exampleManifestPath) })).toThrow(/manifestPath must use repository-relative forward slashes|manifestPath must not be a URI or drive-qualified path|manifestPath must not be absolute or UNC/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("rejects example IDs and repeated-character hash placeholders", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-courseware-source-"));
    try {
      const source = copyExampleFixture(temp);
      const inventoryPath = path.join(temp, "docs/manifests/r1-courseware-e-series.example.ndjson");
      const original = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
      const exampleId = clone(original);
      exampleId.lecture.id = "example-e-lecture-01";
      writeNdjson(inventoryPath, [exampleId]);
      source.inventories[1].sha256 = textFileSha256(inventoryPath);
      expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: writeExampleManifest(temp, source) })).toThrow(/lecture.id must be a UUID/);

      const placeholderHash = clone(source);
      placeholderHash.capturedFrom.databaseFingerprint = "1".repeat(64);
      expect(() => loadCoursewareSourceContext({ root: temp, manifestPath: writeExampleManifest(temp, placeholderHash) })).toThrow(/must not be a repeated-character placeholder/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("ships a strict executor without network, database, SQL, or child-process capability", () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const source = fs.readFileSync(path.join(repositoryRoot, "scripts/plan-r1-courseware-source.mjs"), "utf8");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.writesAllowed.const).toBe(false);
    expect(schema.properties.networkAllowed.const).toBe(false);
    expect(schema.properties.databaseConnectionAllowed.const).toBe(false);
    expect(schema.properties.expected.properties).toMatchObject({
      courseCount: { const: 102 },
      lectureCount: { const: 1305 },
      nativeTrackCount: { const: 1305 },
      adaptedTrackCount: { const: 1305 },
      releaseCount: { const: 2610 },
    });
    expect(source).not.toMatch(/from ["']node:(?:http|https|net|tls|child_process)["']/);
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("DATABASE_URL");
    expect(source).not.toContain("SUPABASE_");
    expect(source).not.toMatch(/\b(?:insert|update|delete|truncate)\s+(?:into|from|table)?\s*public\./i);
  });
});
