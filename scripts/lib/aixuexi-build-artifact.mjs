import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const HASH = /^[0-9a-f]{64}$/;
const POINTER_SCHEMA = "mathin-aixuexi-build-pointer-v1";
const BUILD_SCHEMA = "mathin-aixuexi-build-v1";
const digest = (body) => createHash("sha256").update(body).digest("hex");

function inside(root, relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\")
      || path.isAbsolute(relative) || relative.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("AIXUEXI_BUILD_ARTIFACT: 无效产物相对路径");
  }
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("AIXUEXI_BUILD_ARTIFACT: 产物路径越界");
  return target;
}

async function optionalJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export async function resolveAixuexiImportRoot(root) {
  const pointer = await optionalJson(path.join(root, "latest.json"));
  if (!pointer) return path.resolve(root);
  if (pointer.schemaVersion !== POINTER_SCHEMA || !HASH.test(pointer.inputFingerprint ?? "")
      || pointer.artifactPath !== `artifacts/${pointer.inputFingerprint}`) {
    throw new Error("AIXUEXI_BUILD_ARTIFACT: 最新产物指针无效");
  }
  return inside(root, pointer.artifactPath);
}

async function verifyFile(root, file) {
  if (!HASH.test(file.sha256 ?? "") || !Number.isSafeInteger(file.byteCount) || file.byteCount < 0) {
    throw new Error("AIXUEXI_BUILD_ARTIFACT: 产物清单缺少有效摘要或字节数");
  }
  const body = await readFile(inside(root, file.path));
  if (body.byteLength !== file.byteCount || digest(body) !== file.sha256) {
    throw new Error(`AIXUEXI_BUILD_ARTIFACT: 产物正文不匹配 ${file.path}`);
  }
}

export async function verifyAixuexiBuildArtifact(root, inputFingerprint) {
  const manifest = await optionalJson(path.join(root, "manifest.json"));
  if (!manifest) return null;
  if (manifest.schemaVersion !== "mathin-package-export-v1"
      || manifest.build?.schemaVersion !== BUILD_SCHEMA
      || manifest.build.inputFingerprint !== inputFingerprint || !Array.isArray(manifest.files)) {
    throw new Error("AIXUEXI_BUILD_ARTIFACT: 已有构建产物合同不匹配，保留原目录供检查");
  }
  for (const file of manifest.files) {
    await verifyFile(root, file);
    if (!file.path.startsWith("h5-manifests/") || manifest.build.summary.h5Staged === false) continue;
    const h5 = JSON.parse(await readFile(inside(root, file.path), "utf8"));
    for (const entry of h5.files) {
      if (entry.storeScope === "package") {
        await verifyFile(root, { path: entry.storeRelativePath, sha256: entry.sha256, byteCount: entry.byteCount });
      }
    }
  }
  return manifest.build.summary;
}

/** 构建到本次独立目录，完整后一次发布；已有产物和失败诊断目录保持可追溯。 */
export async function publishAixuexiBuildArtifact({ outputRoot, inputFingerprint, write }) {
  if (!HASH.test(inputFingerprint ?? "")) throw new Error("AIXUEXI_BUILD_ARTIFACT: 构建指纹无效");
  const base = path.resolve(outputRoot);
  const relative = `artifacts/${inputFingerprint}`;
  const target = inside(base, relative);
  const cached = await verifyAixuexiBuildArtifact(target, inputFingerprint);
  let summary = cached;
  if (!cached) {
    const existing = await stat(target).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (existing) throw new Error("AIXUEXI_BUILD_ARTIFACT: 已有不完整产物，保留原目录供检查");
    await mkdir(path.join(base, ".building"), { recursive: true });
    const staging = await mkdtemp(path.join(base, ".building", `${inputFingerprint.slice(0, 12)}-`));
    summary = await write(staging);
    const manifestPath = path.join(staging, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const { outputRoot: _outputRoot, sourceRoot: _sourceRoot, ...portableSummary } = summary;
    manifest.build = { schemaVersion: BUILD_SCHEMA, inputFingerprint, summary: portableSummary };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await verifyAixuexiBuildArtifact(staging, inputFingerprint);
    await mkdir(path.dirname(target), { recursive: true });
    try { await rename(staging, target); }
    catch (error) {
      // 同一输入的并发任务只认已完整校验的产物；本任务目录保留为诊断记录。
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code)
          || !await verifyAixuexiBuildArtifact(target, inputFingerprint)) throw error;
    }
    summary = portableSummary;
  }
  const pointerPath = path.join(base, `.latest-${randomUUID()}.json`);
  await writeFile(pointerPath, `${JSON.stringify({ schemaVersion: POINTER_SCHEMA, inputFingerprint, artifactPath: relative })}\n`, "utf8");
  await rename(pointerPath, path.join(base, "latest.json"));
  return { ...summary, outputRoot: target, inputFingerprint, reused: Boolean(cached) };
}
