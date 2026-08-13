import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  assembleCoursewareSourceCapture,
  deriveCoursewareDatabaseFingerprint,
  extractRequiredBindingKeys,
  hashStorageByteStream,
  parseCoursewareSourceCaptureNdjson,
  parseH5PackageManifestBytes,
  sortCoursewareInventoryEntries,
  sortCoursewareStorageResources,
  verifyH5PackageStorage,
} from "../scripts/lib/r1-courseware-source-export.mjs";
import { canonicalSha256, deriveTrackDigests } from "../scripts/plan-r1-courseware-source.mjs";

const migrationHead = "20260813000500_p6_aixuexi_v31_levels";
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

type UnknownRecord = { recordType?: string; [key: string]: unknown };
type SourceProvenance = {
  lectureId: string;
  packageKey: string;
  packageVersion: string;
  packageManifestSha256: string;
  lectureVerificationSha256: string;
  offlineStatus: string;
};
type AssembledTrack = {
  track: string;
  pages: UnknownRecord[];
  pageSetSha256: string;
  bindingSetSha256: string;
  resourceSetSha256: string;
  capturedRelease: { releaseNo: number; rawSnapshotSha256: string; snapshotSha256: string };
  release: { releaseNo: number; snapshotSha256: string };
};
type AssembledResult = {
  schemaVersion: string;
  databaseFingerprint: string;
  inventories: Array<{ courseSystem: string; entries: Array<{ tracks: AssembledTrack[] }> }>;
  storageResources: Array<{ storagePath: string }>;
};

function uuid(seed: string) {
  const digest = hash(seed);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function captureFixture() {
  const lectureId = uuid("lecture");
  const pageDocId = uuid("page");
  const nativeBindingKey = hash("native-binding");
  const adaptedBindingKey = hash("adapted-binding");
  const makeDocument = (bindingKey: string, width: number, height: number) => ({
    docVersion: "page-doc-v1",
    canvas: { width, height, backgroundBindingKey: bindingKey },
    nodes: [],
    interactions: [],
  });
  const makeBinding = (track: "native-16x9" | "adapted-4x3", bindingKey: string) => {
    const objectSha256 = hash(`${track}-object`);
    const sharedAssetId = uuid(`${track}-asset`);
    return {
      bindingKey,
      assetRevisionId: uuid(`${track}-asset-revision`),
      objectSha256,
      bindingKind: "image",
      sharedAssetKind: "image",
      objectKind: "image",
      bindingRole: "background",
      sharedAssetRole: "background",
      variant: track === "adapted-4x3" ? "mathin-4x3" : "source",
      mime: "image/png",
      byteCount: track === "adapted-4x3" ? 43 : 169,
      storagePath: `sha256/${objectSha256.slice(0, 2)}/${objectSha256}`,
      bindingSharedAssetId: sharedAssetId,
      assetSharedAssetId: sharedAssetId,
      launchQuery: null,
      adaptationStatus: track === "adapted-4x3" ? "approved" : null,
    };
  };
  const nativeSnapshot = [{
    pageDocId,
    revisionId: uuid("native-revision"),
    bindings: [{
      bindingKey: nativeBindingKey,
      assetRevisionId: uuid("native-16x9-asset-revision"),
      launchQuery: null,
    }],
  }];
  const adaptedSnapshot = [{
    pageDocId,
    revisionId: uuid("adapted-revision"),
    bindings: [{
      assetRevisionId: uuid("adapted-4x3-asset-revision"),
      bindingKey: adaptedBindingKey,
    }],
    learningCheckEnabled: true,
  }];
  const records: UnknownRecord[] = [
    {
      recordType: "meta",
      captureVersion: "mathin-r1-courseware-source-capture-v1",
      transactionReadOnly: true,
      migrationVersion: "20260813000500",
    },
    {
      recordType: "lecture",
      courseSystem: "e-series",
      catalogVersion: "2026",
      productCode: "MFHK00621",
      grade: 1,
      lectureId,
      lectureNo: 1,
      sourceEvidence: null,
    },
    {
      recordType: "release",
      lectureId,
      track: "adapted-4x3",
      releaseId: uuid("adapted-release"),
      releaseNo: 7,
      snapshot: adaptedSnapshot,
    },
    {
      recordType: "page",
      lectureId,
      track: "adapted-4x3",
      releaseId: uuid("adapted-release"),
      snapshotOrdinal: 1,
      pageNo: 23,
      pageDocId,
      revisionId: uuid("adapted-revision"),
      revisionTrack: "adapted-4x3",
      pageSourceCoursewareId: "e-series-source-courseware",
      document: makeDocument(adaptedBindingKey, 1200, 900),
      learningCheckEnabled: true,
      snapshotBindingCount: 1,
      bindings: [makeBinding("adapted-4x3", adaptedBindingKey)],
    },
    {
      recordType: "release",
      lectureId,
      track: "native-16x9",
      releaseId: uuid("native-release"),
      releaseNo: 4,
      snapshot: nativeSnapshot,
    },
    {
      recordType: "page",
      lectureId,
      track: "native-16x9",
      releaseId: uuid("native-release"),
      snapshotOrdinal: 1,
      pageNo: 23,
      pageDocId,
      revisionId: uuid("native-revision"),
      revisionTrack: "native-16x9",
      pageSourceCoursewareId: "e-series-source-courseware",
      document: makeDocument(nativeBindingKey, 1600, 900),
      learningCheckEnabled: false,
      snapshotBindingCount: 1,
      bindings: [makeBinding("native-16x9", nativeBindingKey)],
    },
  ];
  const provenance: SourceProvenance[] = [{
    lectureId,
    packageKey: "mofaxiao-e-math-baseline-2026-07-17",
    packageVersion: "2490b13a-44cc-4b34-a68f-e45df77c5c45",
    packageManifestSha256: hash("package-manifest"),
    lectureVerificationSha256: hash("lecture-verification"),
    offlineStatus: "complete",
  }];
  return { records, provenance, lectureId, nativeBindingKey, adaptedBindingKey };
}

describe("R1 courseware source export core", () => {
  it("assembles immutable release captures with planner-v3 digests and deterministic ordering", () => {
    const fixture = captureFixture();
    const shuffled = [fixture.records[4], fixture.records[1], fixture.records[5], fixture.records[0], fixture.records[2], fixture.records[3]];
    const result = assembleCoursewareSourceCapture(shuffled, {
      migrationHead,
      provenance: fixture.provenance,
    }) as AssembledResult;

    expect(result.schemaVersion).toBe("mathin-r1-courseware-source-capture-v1");
    expect(result.databaseFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.inventories.map((inventory) => inventory.courseSystem)).toEqual(["aixuexi-autumn", "e-series"]);
    expect(result.inventories[0].entries).toEqual([]);
    const [entry] = result.inventories[1].entries;
    expect(entry.tracks.map((track) => track.track)).toEqual(["native-16x9", "adapted-4x3"]);
    expect(entry.tracks.map((track) => track.capturedRelease.releaseNo)).toEqual([4, 7]);
    expect(entry.tracks.map((track) => track.capturedRelease.rawSnapshotSha256)).toEqual([
      canonicalSha256((fixture.records[4] as UnknownRecord).snapshot),
      canonicalSha256((fixture.records[2] as UnknownRecord).snapshot),
    ]);
    expect(entry.tracks.map((track) => track.release.releaseNo)).toEqual([1, 1]);
    expect(entry.tracks.map((track) => track.pages[0].pageNo)).toEqual([23, 23]);
    for (const track of entry.tracks) {
      const plannerDigest = deriveTrackDigests(track.pages);
      expect(track.pageSetSha256).toBe(plannerDigest.pageSetSha256);
      expect(track.bindingSetSha256).toBe(plannerDigest.bindingSetSha256);
      expect(track.resourceSetSha256).toBe(plannerDigest.resourceSetSha256);
      expect(track.capturedRelease.snapshotSha256).toBe(plannerDigest.snapshotSha256);
      expect(track.release.snapshotSha256).toBe(plannerDigest.snapshotSha256);
    }
    expect(result.storageResources.map((resource) => resource.storagePath)).toEqual(
      [...result.storageResources.map((resource) => resource.storagePath)].sort(),
    );
    expect(deriveCoursewareDatabaseFingerprint(shuffled, { migrationHead })).toBe(result.databaseFingerprint);
    expect(deriveCoursewareDatabaseFingerprint([...shuffled].reverse(), { migrationHead })).toBe(result.databaseFingerprint);
  });

  it("extracts both supported document binding contracts", () => {
    const key = hash("aixuexi-runtime");
    const aixuexi = {
      docVersion: "aixuexi-page-doc-v1",
      canvas: { backgroundBindingKey: null },
      sourceRuntime: { runtimeBindingKey: key },
      nodes: [],
    };
    expect(extractRequiredBindingKeys(aixuexi)).toEqual([key]);
    expect(() => extractRequiredBindingKeys({ docVersion: "spatial-page-v1" })).toThrow(/unsupported/);
  });

  it("fails closed when reviewed provenance is absent or disagrees with captured database evidence", () => {
    const fixture = captureFixture();
    expect(() => assembleCoursewareSourceCapture(fixture.records, { migrationHead })).toThrow(/lacks reviewed source provenance/);

    const records = structuredClone(fixture.records);
    const lecture = records.find((record) => record.recordType === "lecture")!;
    lecture.sourceEvidence = {
      sourceSystem: "aixuexi_bsk",
      packageKey: fixture.provenance[0].packageKey,
      documentAdapter: "aixuexi-page-v1",
      packageManifestSha256: hash("different-package"),
      packageStatus: "imported",
      sourceProductCode: "AXX26G-SJ-03-AUT",
      sourceCoursewareId: "source-courseware-3-1",
      sourceLessonIndex: 1,
      pageCount: 1,
      lectureVerificationSha256: fixture.provenance[0].lectureVerificationSha256,
      offlineStatus: "complete",
    };
    expect(() => assembleCoursewareSourceCapture(records, {
      migrationHead,
      provenance: fixture.provenance,
    })).toThrow(/E-series lecture .* must use reviewed external provenance/);

    const aixuexiRecords = structuredClone(records);
    const aixuexiLecture = aixuexiRecords.find((record) => record.recordType === "lecture")!;
    aixuexiLecture.courseSystem = "aixuexi-autumn";
    aixuexiLecture.catalogVersion = "default";
    aixuexiLecture.productCode = "AXX26G-SJ-03-AUT";
    const aixuexiProvenance = [{ ...fixture.provenance[0], packageKey: "2026-gplus-sujiao-math" }];
    (aixuexiLecture.sourceEvidence as UnknownRecord).packageKey = "2026-gplus-sujiao-math";
    for (const page of aixuexiRecords.filter((record) => record.recordType === "page")) {
      const oldDocument = page.document as { canvas: { backgroundBindingKey: string } };
      page.pageSourceCoursewareId = "source-courseware-3-1";
      page.document = {
        docVersion: "aixuexi-page-doc-v1",
        source: { coursewareId: "source-courseware-3-1", pageDatabaseId: Number(page.pageNo) },
        canvas: { backgroundBindingKey: oldDocument.canvas.backgroundBindingKey },
        nodes: [],
      };
    }
    expect(() => assembleCoursewareSourceCapture(aixuexiRecords, {
      migrationHead,
      provenance: aixuexiProvenance,
    })).toThrow(/package manifest differs/);
  });

  it("rejects joins that drop snapshot pages or bindings and never falls back to mutable heads", () => {
    const fixture = captureFixture();
    const missingPage = structuredClone(fixture.records);
    const release = missingPage.find((record) => record.recordType === "release" && record.track === "native-16x9")!;
    (release.snapshot as UnknownRecord[]).push({
      pageDocId: uuid("uncaptured-page"),
      revisionId: uuid("uncaptured-revision"),
      bindings: [{ bindingKey: hash("uncaptured-binding"), assetRevisionId: uuid("uncaptured-asset-revision") }],
    });
    expect(() => assembleCoursewareSourceCapture(missingPage, {
      migrationHead,
      provenance: fixture.provenance,
    })).toThrow(/resolved 1\/2 pages/);

    const missingBinding = structuredClone(fixture.records);
    const page = missingBinding.find((record) => record.recordType === "page" && record.track === "native-16x9")!;
    page.snapshotBindingCount = 2;
    expect(() => assembleCoursewareSourceCapture(missingBinding, {
      migrationHead,
      provenance: fixture.provenance,
    })).toThrow(/did not resolve every release snapshot binding/);

    const wrongDocument = structuredClone(fixture.records);
    const nativePage = wrongDocument.find((record) => record.recordType === "page" && record.track === "native-16x9")!;
    const document = nativePage.document as { canvas: { backgroundBindingKey: string } };
    document.canvas.backgroundBindingKey = hash("not-in-snapshot");
    expect(() => assembleCoursewareSourceCapture(wrongDocument, {
      migrationHead,
      provenance: fixture.provenance,
    })).toThrow(/document bindings differ/);

    const rawSnapshotMismatch = structuredClone(fixture.records);
    const rawRelease = rawSnapshotMismatch.find((record) => record.recordType === "release" && record.track === "native-16x9")!;
    const [rawPage] = rawRelease.snapshot as UnknownRecord[];
    rawPage.learningCheckEnabled = true;
    expect(() => assembleCoursewareSourceCapture(rawSnapshotMismatch, {
      migrationHead,
      provenance: fixture.provenance,
    })).toThrow(/page records differ from the immutable snapshot projection/);

    const launchQueryMismatch = structuredClone(fixture.records);
    const nativeRelease = launchQueryMismatch.find((record) => record.recordType === "release" && record.track === "native-16x9")!;
    const [snapshotPage] = nativeRelease.snapshot as UnknownRecord[];
    const [snapshotBinding] = snapshotPage.bindings as UnknownRecord[];
    snapshotBinding.launchQuery = { query: { level: ["2"] }, coursewareIdParam: null };
    expect(() => assembleCoursewareSourceCapture(launchQueryMismatch, {
      migrationHead,
      provenance: fixture.provenance,
    })).toThrow(/page records differ from the immutable snapshot projection/);

    const wrongRevisionTrack = structuredClone(fixture.records);
    const nativeTrackPage = wrongRevisionTrack.find((record) => record.recordType === "page" && record.track === "native-16x9")!;
    nativeTrackPage.revisionTrack = "adapted-4x3";
    expect(() => assembleCoursewareSourceCapture(wrongRevisionTrack, {
      migrationHead,
      provenance: fixture.provenance,
    })).toThrow(/native release cannot reference an adapted revision/);

    const h5WithoutLaunchQuery = structuredClone(fixture.records);
    const h5Page = h5WithoutLaunchQuery.find((record) => record.recordType === "page" && record.track === "native-16x9")!;
    const [h5Binding] = h5Page.bindings as UnknownRecord[];
    h5Binding.bindingKind = "h5";
    h5Binding.sharedAssetKind = "h5";
    h5Binding.objectKind = "h5";
    h5Binding.mime = "application/x-mathin-h5-package";
    h5Binding.storagePath = `packages/${h5Binding.objectSha256}`;
    expect(() => assembleCoursewareSourceCapture(h5WithoutLaunchQuery, {
      migrationHead,
      provenance: fixture.provenance,
    })).toThrow(/launchQuery is required for H5/);
  });

  it("requires an approved E-series 4:3 background decision", () => {
    const fixture = captureFixture();
    const records = structuredClone(fixture.records);
    const page = records.find((record) => record.recordType === "page" && record.track === "adapted-4x3")!;
    const [binding] = page.bindings as UnknownRecord[];
    binding.adaptationStatus = "pending";
    expect(() => assembleCoursewareSourceCapture(records, {
      migrationHead,
      provenance: fixture.provenance,
    })).toThrow(/lacks approved E-series 4:3 provenance/);
  });

  it("fails closed on incomplete AIXUEXI database provenance and page-source drift", () => {
    const fixture = captureFixture();
    const records = structuredClone(fixture.records);
    const lecture = records.find((record) => record.recordType === "lecture")!;
    lecture.courseSystem = "aixuexi-autumn";
    lecture.catalogVersion = "default";
    lecture.productCode = "AXX26G-SJ-03-AUT";
    lecture.sourceEvidence = {
      sourceSystem: "aixuexi_bsk",
      packageKey: "2026-gplus-sujiao-math",
      documentAdapter: "aixuexi-page-v1",
      packageManifestSha256: fixture.provenance[0].packageManifestSha256,
      packageStatus: "importing",
      sourceProductCode: "AXX26G-SJ-03-AUT",
      sourceCoursewareId: "source-courseware-3-1",
      sourceLessonIndex: 1,
      pageCount: 1,
      lectureVerificationSha256: fixture.provenance[0].lectureVerificationSha256,
      offlineStatus: "complete",
    };
    const provenance = [{ ...fixture.provenance[0], packageKey: "2026-gplus-sujiao-math" }];
    for (const page of records.filter((record) => record.recordType === "page")) {
      const oldDocument = page.document as { canvas: { backgroundBindingKey: string } };
      page.pageSourceCoursewareId = "source-courseware-3-1";
      page.document = {
        docVersion: "aixuexi-page-doc-v1",
        source: { coursewareId: "source-courseware-3-1", pageDatabaseId: 1 },
        canvas: { backgroundBindingKey: oldDocument.canvas.backgroundBindingKey },
        nodes: [],
      };
    }
    expect(() => assembleCoursewareSourceCapture(records, { migrationHead, provenance })).toThrow(/package is not imported/);
    (lecture.sourceEvidence as UnknownRecord).packageStatus = "imported";
    (lecture.sourceEvidence as UnknownRecord).sourceProductCode = "AXX26G-SJ-04-AUT";
    expect(() => assembleCoursewareSourceCapture(records, { migrationHead, provenance })).toThrow(/source product code differs/);
    (lecture.sourceEvidence as UnknownRecord).sourceProductCode = "AXX26G-SJ-03-AUT";
    const nativePage = records.find((record) => record.recordType === "page" && record.track === "native-16x9")!;
    nativePage.pageSourceCoursewareId = "different-courseware";
    expect(() => assembleCoursewareSourceCapture(records, { migrationHead, provenance })).toThrow(/page row source courseware ID differs/);
  });

  it("hashes Node and Web byte streams without materializing a Blob", async () => {
    const bytes = Buffer.from("streamed courseware object", "utf8");
    const expectedSha256 = hash(bytes.toString("utf8"));
    await expect(hashStorageByteStream(Readable.from([bytes.subarray(0, 8), bytes.subarray(8)]), {
      expectedSha256,
      expectedByteCount: bytes.length,
    })).resolves.toEqual({ sha256: expectedSha256, byteCount: bytes.length });

    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 5));
        controller.enqueue(bytes.subarray(5));
        controller.close();
      },
    });
    await expect(hashStorageByteStream(webStream)).resolves.toEqual({ sha256: expectedSha256, byteCount: bytes.length });
    await expect(hashStorageByteStream(Readable.from([bytes]), { expectedByteCount: bytes.length + 1 })).rejects.toThrow(/byte count mismatch/);
    await expect(hashStorageByteStream(Readable.from([bytes]), { maxBytes: 4 })).rejects.toThrow(/exceeds 4 bytes/);
    const controller = new AbortController();
    controller.abort();
    await expect(hashStorageByteStream(Readable.from([bytes]), { signal: controller.signal })).rejects.toThrow(/was aborted/);
  });

  it("verifies an H5 package manifest, exact Storage file set, and every file byte stream", async () => {
    const packageHash = hash("h5-package");
    const files = new Map([
      ["index.html", Buffer.from("<html></html>")],
      ["assets/数学.js", Buffer.from("console.log('数学')")],
    ]);
    const manifest = {
      schemaVersion: "mathin-h5-manifest-v1",
      packageHash,
      entryPath: "index.html",
      byteCount: [...files.values()].reduce((total, value) => total + value.length, 0),
      files: [...files].map(([packagePath, value]) => ({
        packagePath,
        sha256: crypto.createHash("sha256").update(value).digest("hex"),
        byteCount: value.length,
        mime: packagePath.endsWith(".html") ? "text/html" : "text/javascript",
      })),
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
    const parsed = parseH5PackageManifestBytes(manifestBytes, { expectedPackageHash: packageHash, expectedByteCount: manifest.byteCount }) as {
      manifest: { files: Array<{ storagePath: string; packagePath: string }> };
    };
    const byStoragePath = new Map(parsed.manifest.files.map((file: { storagePath: string; packagePath: string }) => [file.storagePath, files.get(file.packagePath)!]));
    const listedObjectPaths = [
      `packages/${packageHash}/__mathin_manifest.json`,
      ...parsed.manifest.files.map((file: { storagePath: string }) => file.storagePath),
    ];
    await expect(verifyH5PackageStorage({
      packageHash,
      expectedByteCount: manifest.byteCount,
      manifestBytes,
      listedObjectPaths,
      openObjectStream: async (storagePath: string) => Readable.from([byStoragePath.get(storagePath)!]),
    })).resolves.toMatchObject({ packageHash, entryPath: "index.html", fileCount: 2, byteCount: manifest.byteCount });

    await expect(verifyH5PackageStorage({
      packageHash,
      expectedByteCount: manifest.byteCount,
      manifestBytes,
      listedObjectPaths: [...listedObjectPaths, `packages/${packageHash}/extra.js`],
      openObjectStream: async (storagePath: string) => Readable.from([byStoragePath.get(storagePath)!]),
    })).rejects.toThrow(/file set differs/);
    await expect(verifyH5PackageStorage({
      packageHash,
      expectedByteCount: manifest.byteCount,
      manifestBytes,
      listedObjectPaths,
      openObjectStream: async () => Readable.from([Buffer.from("tampered")]),
    })).rejects.toThrow(/SHA-256 mismatch|byte count mismatch/);
    const unsafe = structuredClone(manifest);
    unsafe.files[0].packagePath = "../index.html";
    expect(() => parseH5PackageManifestBytes(Buffer.from(JSON.stringify(unsafe)), { expectedPackageHash: packageHash }))
      .toThrow(/unsafe path segment/);
  });

  it("parses compact LF/CRLF capture records and exposes stable sort helpers", () => {
    const fixture = captureFixture();
    const text = fixture.records.slice(0, 2).map((record) => JSON.stringify(record)).join("\r\n") + "\r\n";
    expect(parseCoursewareSourceCaptureNdjson(text)).toEqual(fixture.records.slice(0, 2));
    expect(() => parseCoursewareSourceCaptureNdjson(`${JSON.stringify(fixture.records[0])}\n \n`)).toThrow(/one compact JSON object/);
    expect(() => parseCoursewareSourceCaptureNdjson(`{"oversized":"${"x".repeat(4 * 1024 * 1024)}"}\n`)).toThrow(/line 1 exceeds/);

    const one = { courseSystem: "e-series", course: { catalogVersion: "2026", productCode: "B" }, lecture: { no: 2, id: uuid("b") } };
    const two = { courseSystem: "e-series", course: { catalogVersion: "2025", productCode: "A" }, lecture: { no: 1, id: uuid("a") } };
    expect(sortCoursewareInventoryEntries([one, two])).toEqual([two, one]);
    expect(sortCoursewareStorageResources([
      { storageBucket: "cw-objects", storagePath: "sha256/b" },
      { storageBucket: "cw-h5", storagePath: "packages/a" },
    ])).toEqual([
      { storageBucket: "cw-h5", storagePath: "packages/a" },
      { storageBucket: "cw-objects", storagePath: "sha256/b" },
    ]);
  });

  it("changes the database fingerprint when captured immutable content changes", () => {
    const fixture = captureFixture();
    const before = deriveCoursewareDatabaseFingerprint(fixture.records, { migrationHead });
    const records = structuredClone(fixture.records);
    const page = records.find((record) => record.recordType === "page" && record.track === "native-16x9")!;
    const document = page.document as UnknownRecord;
    document.auditMarker = "changed";
    expect(deriveCoursewareDatabaseFingerprint(records, { migrationHead })).not.toBe(before);
    expect(canonicalSha256(document)).toMatch(/^[0-9a-f]{64}$/);

    const rawOnlyChange = structuredClone(fixture.records);
    const release = rawOnlyChange.find((record) => record.recordType === "release" && record.track === "native-16x9")!;
    const [snapshotPage] = release.snapshot as UnknownRecord[];
    snapshotPage.legacyAuditMarker = "retained-only-in-raw-snapshot";
    expect(deriveCoursewareDatabaseFingerprint(rawOnlyChange, { migrationHead })).not.toBe(before);
    const assembled = assembleCoursewareSourceCapture(rawOnlyChange, {
      migrationHead,
      provenance: fixture.provenance,
    }) as AssembledResult;
    expect(assembled.inventories[1].entries[0].tracks[0].capturedRelease.rawSnapshotSha256)
      .toBe(canonicalSha256(release.snapshot));
  });
});

describe("R1 courseware source export SQL", () => {
  it("is one fixed repeatable-read read-only capture rooted only at current release snapshots", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "scripts/sql/r1-courseware-source-export.sql"), "utf8");
    const executable = sql.replace(/^\s*--.*$/gm, "");
    expect(executable).toMatch(/begin transaction isolation level repeatable read read only/i);
    expect(executable).toMatch(/set local default_transaction_read_only\s*=\s*on/i);
    expect(executable).toMatch(/release\.id\s*=\s*head\.current_release_id/i);
    expect(executable).toMatch(/jsonb_array_elements\(selected\.snapshot\)/i);
    expect(executable).toMatch(/'snapshot',\s*selected\.snapshot/i);
    expect(executable).toMatch(/scope\.course_system\s*<>\s*'aixuexi-autumn'[\s\S]*source_lecture\.id\s+is\s+null/i);
    expect(executable).toMatch(/'snapshotOrdinal',\s*page\.snapshot_ordinal/i);
    expect(executable).toMatch(/'pageNo',\s*page\.page_no/i);
    expect(executable).toMatch(/'revisionTrack',\s*page\.revision_track/i);
    expect(executable).toMatch(/'launchQuery',\s*snapshot_binding\.value\s*->\s*'launchQuery'/i);
    expect(executable).not.toMatch(/cw_page_track_heads/i);
    expect(executable).not.toMatch(/draft_revision_id|current_revision_id/i);
    expect(executable).not.toMatch(/\binsert\s+into\b|\bupdate\s+[^;]+\s+set\b|\bdelete\s+from\b|\bcall\s+/i);
    expect((executable.match(/\bbegin transaction\b/gi) ?? [])).toHaveLength(1);
    expect((executable.match(/\bcommit\s*;/gi) ?? [])).toHaveLength(1);
  });
});
