import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertProductionSourceRuntimeUpgrade,
  buildImportSql,
  h5StoragePath,
  importCourseware,
  loadImportPlan,
  parseArgs,
  resolveInside,
  sourceRuntimeImportFingerprint,
  storageTargetsForPlan,
} from "../scripts/cw-import.mjs";
import { resolveCatalogVersion, unresolvedSourceRuntimeDrift } from "../scripts/aixuexi-import-all.mjs";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function writeFixtureFile(root: string, relative: string, value: string) {
  const target = join(root, ...relative.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, value, "utf8");
  return { path: relative, sha256: hash(value), byteCount: Buffer.byteLength(value) };
}

const RICH_HTML = '<div style="line-height: 0;"><sup>2</sup><table cellpadding="0"><tbody><tr><td colspan="2">题干</td></tr></tbody></table>'
  + '<svg viewBox="0 0 10 10"><text font-size="24" text-anchor="middle" dy=".3em">1</text>'
  + '<linearGradient x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/></linearGradient>'
  + '<rect rx="2" ry="2" stroke-dasharray="4 2"/><ellipse cx="5" cy="5"/></svg></div>';

async function createPackageFixture(html = RICH_HTML) {
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
    nodes: [{ content: { kind: "rich_text", html }, resources: [{ bindingKey: usageH5, bindingPath: "$.src", role: "entry", kind: "h5" }], children: [] }],
    interactions: [],
  };
  const files = await Promise.all([
    writeFixtureFile(root, "lectures.ndjson", `${JSON.stringify({ coursewareId: "sample-courseware", mathinProductCode: "MFHK00001", lessonIndex: 1, lessonName: "样本", pageCount: 1, sourceRuntimePackageHash: "7".repeat(64) })}\n`),
    writeFixtureFile(root, "asset-objects.ndjson", `${JSON.stringify({ objectHash: normalHash, mime: "image/png", byteCount: 1, storeRelativePath: `objects/sha256/aa/${normalHash}`, kind: "image" })}\n`),
    writeFixtureFile(root, "candidates.ndjson", `${JSON.stringify({ candidateKey: candidateNormal, objectHash: normalHash, kind: "image", role: "background" })}\n${JSON.stringify({ candidateKey: candidateH5, objectHash: h5Hash, kind: "h5", role: "entry" })}\n`),
    writeFixtureFile(root, "usages.ndjson", `${JSON.stringify({ usageKey: usageNormal, coursewareId: "sample-courseware", pageDatabaseId: 1, objectHash: normalHash, objectKind: "cas", candidateKey: candidateNormal, role: "background", kind: "image" })}\n${JSON.stringify({ usageKey: usageH5, coursewareId: "sample-courseware", pageDatabaseId: 1, objectHash: h5Hash, objectKind: "h5_package", candidateKey: candidateH5, role: "entry", kind: "h5", launchQuery: { level: ["3"] }, coursewareIdParam: "lesson" })}\n`),
    writeFixtureFile(root, "page-docs/sample-courseware.ndjson", `${JSON.stringify({ coursewareId: "sample-courseware", pageIndex: 1, pageDatabaseId: 1, name: "第一页", thumbnailBindingKey: null, doc })}\n`),
    writeFixtureFile(root, `h5-manifests/${h5Hash}.json`, JSON.stringify({ schemaVersion: "mathin-h5-manifest-v1", packageHash: h5Hash, entryPath: "index.html", byteCount: 7, files: [{ packagePath: "index.html", sha256: hash("<html>"), byteCount: 6, mime: "text/html" }] })),
    writeFixtureFile(root, `h5-input-profiles/${h5Hash}.json`, JSON.stringify({
      schemaVersion: "mathin-classroom-h5-input-profile-v1",
      packageHash: h5Hash,
      providerSchema: "mathin-classroom-input",
      providerVersion: 1,
      defaultCapability: "click",
      engineFamily: "fixture-dom",
      auditMethod: "fixture-contract-v1",
      evidenceSha256: "9".repeat(64),
    })),
  ]);
  await writeFixtureFile(root, "manifest.json", JSON.stringify({ schemaVersion: "mathin-package-export-v1", exportId: "fixture-export", files }));
  return { root, normalHash, h5Hash };
}

describe("P6 courseware importer", () => {
  it("uses an ASCII-safe Storage key without changing an H5 package's logical filename", () => {
    expect(h5StoragePath("a".repeat(64), "images/位图12.png")).toBe(
      `packages/${"a".repeat(64)}/images/u__E4_BD_8D_E5_9B_BE12.png`,
    );
    expect(h5StoragePath("a".repeat(64), "images/169%3A%E6%8C%82%E4%BB%B6.png")).toBe(
      `packages/${"a".repeat(64)}/images/u_169_3A_E6_8C_82_E4_BB_B6.png`,
    );
  });
  it("builds a complete sample import plan and preserves H5 launch query", async () => {
    const fixture = await createPackageFixture();
    const plan = await loadImportPlan({ packageRoot: fixture.root, coursewareId: "sample-courseware" });

    expect(plan.pages).toHaveLength(1);
    expect(plan.lecture.sourceRuntimePackageHash).toBe("7".repeat(64));
    expect(plan.objects).toHaveLength(2);
    expect(plan.assets).toHaveLength(2);
    expect(plan.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ bindingKey: "d".repeat(64), launchQuery: { query: { level: ["3"] }, coursewareIdParam: "lesson" } }),
    ]));
    expect(plan.objects.find((object) => object.objectHash === fixture.normalHash)?.storagePath).toBe(`sha256/aa/${fixture.normalHash}`);
    expect(plan.objects.find((object) => object.objectHash === fixture.h5Hash)?.storagePath).toBe(`packages/${fixture.h5Hash}`);
    expect(plan.h5InputProfiles.get(fixture.h5Hash)).toMatchObject({
      defaultCapability: "click",
      engineFamily: "fixture-dom",
    });
    expect(storageTargetsForPlan(plan)).toEqual(expect.arrayContaining([
      { bucket: "cw-objects", remotePath: `sha256/aa/${fixture.normalHash}` },
      { bucket: "cw-h5", remotePath: `packages/${fixture.h5Hash}/__mathin_manifest.json` },
      { bucket: "cw-h5", remotePath: h5StoragePath(fixture.h5Hash, "index.html") },
    ]));

    const sql = buildImportSql(plan);
    expect(sql).toContain("CW_IMPORT_LECTURE_MAPPING_MISSING_OR_AMBIGUOUS");
    expect(sql).toContain("'launchQuery'");
    expect(sql).toContain("courseware_template = '[]'::jsonb");
    expect(sql).toContain("CW_IMPORT_H5_INPUT_PROFILE_MISMATCH");
    expect(sql).toContain("insert into public.cw_h5_input_profiles");
  });

  it("stores documents verbatim — presentation markup passes the lossless gate untouched", async () => {
    const fixture = await createPackageFixture();
    const plan = await loadImportPlan({ packageRoot: fixture.root, coursewareId: "sample-courseware" });

    expect(plan.pages[0].doc.nodes[0].content.html).toBe(RICH_HTML);
  });

  it("tolerates unescaped < inside attribute values (LaTeX formulas)", async () => {
    const html = '<span class="xes-formula-latex" data-latex="10<y<20" style="line-height: 0;">x</span>';
    const fixture = await createPackageFixture(html);
    const plan = await loadImportPlan({ packageRoot: fixture.root, coursewareId: "sample-courseware" });

    expect(plan.pages[0].doc.nodes[0].content.html).toBe(html);
  });

  it("fails loudly when markup would be altered by sanitization", async () => {
    const fixture = await createPackageFixture('<div onclick="alert(1)"><blink>x</blink></div>');

    await expect(loadImportPlan({ packageRoot: fixture.root, coursewareId: "sample-courseware" }))
      .rejects.toThrow(/sanitize would drop/);
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

  it("requires an attested database target for local Docker imports", () => {
    expect(() => parseArgs([
      "--package-root", "C:/package",
      "--store-root", "C:/store",
      "--courseware-id", "123",
      "--local-docker",
    ])).toThrow(/--database-url is required/);

    expect(parseArgs([
      "--package-root", "C:/package",
      "--store-root", "C:/store",
      "--courseware-id", "123",
      "--local-docker",
      "--database-url", "postgresql://127.0.0.1:35422/postgres",
    ])).toMatchObject({
      localDocker: true,
      databaseUrl: "postgresql://127.0.0.1:35422/postgres",
    });
  });

  it("requires a second explicit gate for production source-runtime upgrades", () => {
    const base = [
      "--package-root", "C:/package",
      "--store-root", "C:/store",
      "--courseware-id", "123",
      "--upgrade-source-runtime",
    ];
    expect(() => parseArgs(base)).toThrow(/require both --allow-production-target/);
    expect(() => parseArgs([...base, "--allow-production-target"]))
      .toThrow(/--allow-production-source-runtime-upgrade/);
    expect(parseArgs([
      ...base,
      "--allow-production-target",
      "--allow-production-source-runtime-upgrade",
    ])).toMatchObject({
      upgradeSourceRuntime: true,
      allowProductionTarget: true,
      allowProductionSourceRuntimeUpgrade: true,
      localDocker: false,
    });
    expect(() => parseArgs([
      "--package-root", "C:/package",
      "--store-root", "C:/store",
      "--courseware-id", "123",
      "--allow-production-source-runtime-upgrade",
    ])).toThrow(/requires --upgrade-source-runtime/);
  });

  it("keeps local source-runtime upgrades on the non-production path", () => {
    expect(parseArgs([
      "--package-root", "C:/package",
      "--store-root", "C:/store",
      "--courseware-id", "123",
      "--local-docker",
      "--database-url", "postgresql://127.0.0.1:35422/postgres",
      "--upgrade-source-runtime",
    ])).toMatchObject({
      localDocker: true,
      upgradeSourceRuntime: true,
      allowProductionTarget: false,
      allowProductionSourceRuntimeUpgrade: false,
    });
  });

  it("accepts the production upgrade confirmation only from the current process", () => {
    const options = {
      upgradeSourceRuntime: true,
      localDocker: false,
      allowProductionTarget: true,
      allowProductionSourceRuntimeUpgrade: true,
    };
    expect(() => assertProductionSourceRuntimeUpgrade(options, { NODE_ENV: "test" }))
      .toThrow(/MATHIN_PRODUCTION_SOURCE_RUNTIME_UPGRADE_CONFIRMATION/);
    expect(() => assertProductionSourceRuntimeUpgrade(options, {
      NODE_ENV: "test",
      MATHIN_PRODUCTION_SOURCE_RUNTIME_UPGRADE_CONFIRMATION: "cw:import:source-runtime-upgrade:wrong",
    })).toThrow(/MATHIN_PRODUCTION_SOURCE_RUNTIME_UPGRADE_CONFIRMATION/);
    expect(() => assertProductionSourceRuntimeUpgrade(options, {
      NODE_ENV: "test",
      MATHIN_PRODUCTION_SOURCE_RUNTIME_UPGRADE_CONFIRMATION: "cw:import:source-runtime-upgrade:10e3f97e32b01840",
    })).not.toThrow();
  });

  it("resolves mixed E-series catalog versions without guessing duplicate product codes", () => {
    const unique = new Map([["SUMMER", new Set(["2026"])]]);
    expect(resolveCatalogVersion(
      { mathinProductCode: "SUMMER", catalogVersionSlug: null },
      { catalogVersion: null, duplicateCatalogVersion: null },
      unique,
    )).toBe("2026");

    const duplicate = new Map([["AUTUMN", new Set(["2025", "2026"])]]);
    expect(() => resolveCatalogVersion(
      { mathinProductCode: "AUTUMN", catalogVersionSlug: null },
      { catalogVersion: null, duplicateCatalogVersion: null },
      duplicate,
    )).toThrow(/multiple catalog versions/);
    expect(resolveCatalogVersion(
      { mathinProductCode: "AUTUMN", catalogVersionSlug: null },
      { catalogVersion: null, duplicateCatalogVersion: "2025" },
      duplicate,
    )).toBe("2025");
  });

  it("reports only baseline drift that a versioned source-runtime upgrade did not reconcile", () => {
    expect(unresolvedSourceRuntimeDrift({ baselineDrift: 66, sourceRuntimeUpgraded: 66 })).toBe(0);
    expect(unresolvedSourceRuntimeDrift({ baselineDrift: 66, sourceRuntimeUpgraded: 60 })).toBe(6);
    expect(unresolvedSourceRuntimeDrift()).toBe(0);
  });

  it("versions repeated source-runtime releases by the complete immutable import input", () => {
    const base = {
      lecture: {
        sourcePackageManifestSha256: "1".repeat(64),
        sourceRuntimePackageHash: "2".repeat(64),
      },
      pages: [{
        pageNo: 1,
        title: "首页",
        sourcePageDatabaseId: 1,
        doc: { docVersion: "source-runtime-page-v1", runtime: { packageHash: "2".repeat(64) } },
      }],
      bindings: [{
        pageNo: 1,
        bindingKey: "3".repeat(64),
        kind: "h5",
        candidateKey: "4".repeat(64),
        launchQuery: null,
      }],
      assets: [{ candidateKey: "4".repeat(64), kind: "h5", objectHash: "2".repeat(64) }],
    };
    const original = sourceRuntimeImportFingerprint(base);
    const refreshed = sourceRuntimeImportFingerprint({
      ...base,
      lecture: { ...base.lecture, sourceRuntimePackageHash: "5".repeat(64) },
    });
    const rebound = sourceRuntimeImportFingerprint({
      ...base,
      assets: [{ ...base.assets[0], objectHash: "6".repeat(64) }],
    });

    expect(original).toMatch(/^[0-9a-f]{64}$/);
    expect(refreshed).not.toBe(original);
    expect(rebound).not.toBe(original);
  });

  it("exports the in-process importer used by local resumable batches", () => {
    expect(importCourseware).toBeTypeOf("function");
  });
});
