import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aixuexiPackageDefinition, assertAixuexiSourceScope, selectAixuexiLectures } from "../scripts/lib/aixuexi-import-scope.mjs";
import { publishAixuexiBuildArtifact, resolveAixuexiImportRoot } from "../scripts/lib/aixuexi-build-artifact.mjs";
import { parseBuildArgs } from "../scripts/aixuexi-build-package.mjs";

const roots: string[] = [];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function root() { const dir = await mkdtemp(path.join(os.tmpdir(), "mathin-incremental-")); roots.push(dir); return dir; }
afterEach(async () => { for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true }); });
const course = { coursewareId: "123", grade: "五年级", term: "秋季", level: "能力强化 G+", status: "complete", pageCount: 25, lessonIndex: 7 };
const packageKey = "2026-gplus-sujiao-math";
const catalog = { schemaVersion: 1, packageKey, courseCount: 1, courses: [course] };
const manifest = { schemaVersion: 1, sourceSystem: "aixuexi_bsk", packageKey, courseCount: 1, pageCount: 25, projectedPageCount: 25, unsupportedLayoutNodeCount: 0, unmappedLayoutResourceCount: 0, registeredGapNodeCount: 0, registeredGapResourceCount: 0 };

describe("single-lesson scope", () => {
  it("accepts actual added content independently of historical package counts", () => {
    const definition = aixuexiPackageDefinition(packageKey);
    expect(assertAixuexiSourceScope(manifest, catalog, definition, { packageKey, lessonIds: ["123"] })).toEqual([course]);
    expect(() => assertAixuexiSourceScope(manifest, catalog, definition, { packageKey, checkBaselineCounts: true })).toThrow("历史整包基线");
  });
  it("requires actual counts and complete selected lessons", () => {
    const definition = aixuexiPackageDefinition(packageKey);
    expect(() => assertAixuexiSourceScope({ ...manifest, pageCount: 26 }, catalog, definition, { packageKey })).toThrow("实际讲页数量");
    expect(() => assertAixuexiSourceScope(manifest, { ...catalog, courses: [{ ...course, status: "pending" }] }, definition, { packageKey, lessonIds: ["123"] })).toThrow("尚未完成");
  });
  it("selects stable IDs, rejecting unknown IDs, duplicates and positional ambiguity", () => {
    expect(selectAixuexiLectures([course, { ...course, coursewareId: "456" }], { lessonIds: ["456,456"] })).toHaveLength(1);
    expect(() => selectAixuexiLectures([course], { lessonIds: ["456"] })).toThrow("没有这些讲次");
    expect(() => selectAixuexiLectures([course, course])).toThrow("重复");
    expect(() => selectAixuexiLectures([course], { lessonIds: ["123"], limit: 1 })).toThrow("分别使用");
    expect(parseBuildArgs(["--lesson-id", "123", "--lesson-id", "456,123"]).lessonIds).toEqual(["123", "456"]);
  });
});

async function writeArtifact(directory: string) {
  const content = "content\n";
  await writeFile(path.join(directory, "lectures.ndjson"), content);
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ schemaVersion: "mathin-package-export-v1", files: [{ path: "lectures.ndjson", sha256: hash(content), byteCount: Buffer.byteLength(content) }] }));
  return { lectures: 1, pages: 25, h5Staged: true };
}
describe("immutable build publication", () => {
  it("reuses validated identical inputs without calling the writer", async () => {
    const outputRoot = await root();
    const first = await publishAixuexiBuildArtifact({ outputRoot, inputFingerprint: hash("one"), write: writeArtifact });
    const second = await publishAixuexiBuildArtifact({ outputRoot, inputFingerprint: hash("one"), write: () => { throw new Error("should reuse"); } });
    expect(second.reused).toBe(true);
    expect(second.outputRoot).toBe(first.outputRoot);
    expect(await resolveAixuexiImportRoot(outputRoot)).toBe(first.outputRoot);
  });
  it("keeps the previous complete artifact and failed staging directory on failure", async () => {
    const outputRoot = await root();
    const first = await publishAixuexiBuildArtifact({ outputRoot, inputFingerprint: hash("one"), write: writeArtifact });
    await expect(publishAixuexiBuildArtifact({ outputRoot, inputFingerprint: hash("two"), write: async () => { throw new Error("interrupted"); } })).rejects.toThrow("interrupted");
    expect(await resolveAixuexiImportRoot(outputRoot)).toBe(first.outputRoot);
    expect(await readdir(path.join(outputRoot, ".building"))).toHaveLength(1);
  });
  it("rejects tampered cache contents and keeps them available for diagnosis", async () => {
    const outputRoot = await root();
    const first = await publishAixuexiBuildArtifact({ outputRoot, inputFingerprint: hash("one"), write: writeArtifact });
    const file = path.join(first.outputRoot, "lectures.ndjson");
    await writeFile(file, "corrupt");
    await expect(publishAixuexiBuildArtifact({ outputRoot, inputFingerprint: hash("one"), write: writeArtifact })).rejects.toThrow("正文不匹配");
    expect(await readFile(file, "utf8")).toBe("corrupt");
  });
  it("supports legacy roots and rejects path traversal in pointers", async () => {
    const outputRoot = await root();
    expect(await resolveAixuexiImportRoot(outputRoot)).toBe(outputRoot);
    await writeFile(path.join(outputRoot, "latest.json"), JSON.stringify({ schemaVersion: "mathin-aixuexi-build-pointer-v1", inputFingerprint: hash("one"), artifactPath: "../escape" }));
    await expect(resolveAixuexiImportRoot(outputRoot)).rejects.toThrow("指针无效");
  });
});
