import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildImportSql, loadImportPlan, parseArgs, resolveInside } from "../scripts/cw-import.mjs";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function writeFixtureFile(root: string, relative: string, value: string) {
  const target = join(root, ...relative.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, value, "utf8");
  return { path: relative, sha256: hash(value), byteCount: Buffer.byteLength(value) };
}

async function createPackageFixture() {
  const root = await mkdtemp(join(tmpdir(), "mathin-cw-import-"));
  const normalHash = "a".repeat(64);
  const h5Hash = "b".repeat(64);
  const usageNormal = "c".repeat(64);
  const usageH5 = "d".repeat(64);
  const candidateNormal = "e".repeat(64);
  const candidateH5 = "f".repeat(64);
  const doc = {
    docVersion: "page-doc-v1",
    sourceCoursewareId: "sample-courseware",
    sourcePageId: "page-id:1",
    sourcePageDatabaseId: 1,
    sourceSnapshotId: 1,
    sourceContentHash: "1".repeat(64),
    canvas: { width: 1280, height: 720, backgroundColor: null, backgroundBindingKey: usageNormal },
    nodes: [{ resources: [{ bindingKey: usageH5, bindingPath: "$.src", role: "entry", kind: "h5" }], children: [] }],
    interactions: [],
  };
  const files = await Promise.all([
    writeFixtureFile(root, "lectures.ndjson", `${JSON.stringify({ coursewareId: "sample-courseware", mathinProductCode: "MFHK00001", lessonIndex: 1, lessonName: "样本", pageCount: 1 })}\n`),
    writeFixtureFile(root, "asset-objects.ndjson", `${JSON.stringify({ objectHash: normalHash, mime: "image/png", byteCount: 1, storeRelativePath: `objects/sha256/aa/${normalHash}`, kind: "image" })}\n`),
    writeFixtureFile(root, "candidates.ndjson", `${JSON.stringify({ candidateKey: candidateNormal, objectHash: normalHash, kind: "image", role: "background" })}\n${JSON.stringify({ candidateKey: candidateH5, objectHash: h5Hash, kind: "h5", role: "entry" })}\n`),
    writeFixtureFile(root, "usages.ndjson", `${JSON.stringify({ usageKey: usageNormal, coursewareId: "sample-courseware", pageDatabaseId: 1, objectHash: normalHash, objectKind: "cas", candidateKey: candidateNormal, role: "background", kind: "image" })}\n${JSON.stringify({ usageKey: usageH5, coursewareId: "sample-courseware", pageDatabaseId: 1, objectHash: h5Hash, objectKind: "h5_package", candidateKey: candidateH5, role: "entry", kind: "h5", launchQuery: { level: ["3"] }, coursewareIdParam: "lesson" })}\n`),
    writeFixtureFile(root, "page-docs/sample-courseware.ndjson", `${JSON.stringify({ coursewareId: "sample-courseware", pageIndex: 1, pageDatabaseId: 1, name: "第一页", thumbnailBindingKey: null, doc })}\n`),
    writeFixtureFile(root, `h5-manifests/${h5Hash}.json`, JSON.stringify({ schemaVersion: "mathin-h5-manifest-v1", packageHash: h5Hash, entryPath: "index.html", byteCount: 7, files: [{ packagePath: "index.html", sha256: hash("<html>"), byteCount: 6, mime: "text/html" }] })),
  ]);
  await writeFixtureFile(root, "manifest.json", JSON.stringify({ schemaVersion: "mathin-package-export-v1", exportId: "fixture-export", files }));
  return { root, normalHash, h5Hash };
}

describe("P6 courseware importer", () => {
  it("builds a complete sample import plan and preserves H5 launch query", async () => {
    const fixture = await createPackageFixture();
    const plan = await loadImportPlan({ packageRoot: fixture.root, coursewareId: "sample-courseware" });

    expect(plan.pages).toHaveLength(1);
    expect(plan.objects).toHaveLength(2);
    expect(plan.assets).toHaveLength(2);
    expect(plan.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ bindingKey: "d".repeat(64), launchQuery: { query: { level: ["3"] }, coursewareIdParam: "lesson" } }),
    ]));
    expect(plan.objects.find((object) => object.objectHash === fixture.normalHash)?.storagePath).toBe(`sha256/aa/${fixture.normalHash}`);
    expect(plan.objects.find((object) => object.objectHash === fixture.h5Hash)?.storagePath).toBe(`packages/${fixture.h5Hash}`);

    const sql = buildImportSql(plan);
    expect(sql).toContain("CW_IMPORT_LECTURE_MAPPING_MISSING_OR_AMBIGUOUS");
    expect(sql).toContain("'launchQuery'");
    expect(sql).toContain("courseware_template = '[]'::jsonb");
  });

  it("rejects package paths that escape their declared root", () => {
    expect(() => resolveInside("C:/fixture", "../secret")).toThrow("unsafe relative path");
    expect(() => resolveInside("C:/fixture", "/absolute")).toThrow("unsafe relative path");
  });

  it("accepts pnpm's argument delimiter", () => {
    expect(parseArgs(["--", "--package-root", "C:/package", "--store-root", "C:/store", "--courseware-id", "123"])).toMatchObject({
      packageRoot: "C:/package",
      storeRoot: "C:/store",
      coursewareId: "123",
    });
  });
});
