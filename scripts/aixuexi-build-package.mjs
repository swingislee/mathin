import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { textFileSha256 } from "./lib/text-hash.mjs";
import {
  buildPortableAixuexiViewerRuntime,
  loadAixuexiSourceViewerRuntime,
  portableAixuexiViewerHtml,
  stripInertMathTexScriptsForInspection,
} from "./lib/aixuexi-source-viewer-runtime.mjs";

const PACKAGE_KEY = "2026-gplus-sujiao-math";
const HASH = /^[0-9a-f]{64}$/;
const GRADE = new Map([
  ["一年级", 1], ["二年级", 2], ["三年级", 3],
  ["四年级", 4], ["五年级", 5], ["六年级", 6],
]);
const PACKAGE_CONFIGS = new Map([
  ["2026-gplus-sujiao-math", {
    lectureCount: 56, pageCount: 1641, grades: [3, 4, 5, 6],
    level: "G+", sourceLevel: "能力强化 G+", edition: "苏教版", productPrefix: "AXX26G-SJ",
    term: "秋季", termCode: "AUT",
    playerRuntimeSchemaVersion: 3, playerRuntimeDerivationVersion: 3,
  }],
  ["2026-xplus-sujiao-math", {
    lectureCount: 84, pageCount: 2767, grades: [1, 2, 3, 4, 5, 6],
    level: "X+", sourceLevel: "能力提高 X+", edition: "苏教版", productPrefix: "AXX26X-SJ",
    term: "秋季", termCode: "AUT",
    playerRuntimeSchemaVersion: 3, playerRuntimeDerivationVersion: 3,
  }],
  ["2026-aplus-quanguo-math", {
    lectureCount: 30, pageCount: 1034, grades: [1, 2],
    level: "A+", sourceLevel: "思维突破 A+", edition: "全国版", productPrefix: "AXX26A-QG",
    term: "秋季", termCode: "AUT",
    playerRuntimeSchemaVersion: 3, playerRuntimeDerivationVersion: 3,
  }],
  ["2026-summer-aplus-quanguo-math", {
    lectureCount: 2, pageCount: 66, grades: [1],
    level: "A+", sourceLevel: "思维突破 A+", edition: "全国版", productPrefix: "AXX26A-QG",
    term: "暑期", termCode: "SUM",
    playerRuntimeSchemaVersion: 4, playerRuntimeDerivationVersion: 5,
  }],
]);
const TEXT_EXTENSIONS = new Set([".css", ".html", ".htm", ".js", ".json", ".mjs", ".svg", ".txt"]);

/**
 * projection v31 同时支持普通 1200×900 页与 1920×1080 原生游戏页。
 * 普通页的源播放器是 1920×1080 外层 + 水平居中的 1200×900 内层，最终由
 * layout.playerStage/layout.presentation 描述；Mathin 不再复制旧的手工放大或 xmind 偏移。
 */
const SOURCE_PROJECTION_VERSION = 31;
const SOURCE_ITV_PROJECTION_VERSION = 4;
const SOURCE_PRESENTATION_WIDTH = 1200;
const SOURCE_PRESENTATION_HEIGHT = 675;
const SOURCE_RUNTIME_PAGE_DOC_VERSION = "source-runtime-page-v1";
const SOURCE_RUNTIME_PROTOCOL = "mathin-source-runtime-v1";

function fail(message) {
  throw new Error(`AIXUEXI_BUILD: ${message}`);
}

export function aixuexiPackageDefinition(packageKey) {
  return PACKAGE_CONFIGS.get(packageKey) ?? null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(file) {
  return sha256(await readFile(file));
}

function resolveInside(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\")) {
    fail(`unsafe relative path: ${relativePath}`);
  }
  const parts = relativePath.split("/");
  if (relativePath.startsWith("/") || parts.some((part) => !part || part === "." || part === "..")) {
    fail(`unsafe relative path: ${relativePath}`);
  }
  const base = path.resolve(root);
  const target = path.resolve(base, ...parts);
  if (!target.startsWith(`${base}${path.sep}`)) fail(`path escapes root: ${relativePath}`);
  return target;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function domainHash(domain, ...parts) {
  return sha256([domain, ...parts].join("\0"));
}

function mimeFor(file) {
  const extension = path.extname(file).toLowerCase();
  return {
    ".css": "text/css",
    ".gif": "image/gif",
    ".html": "text/html",
    ".htm": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "application/javascript",
    ".json": "application/json",
    ".mjs": "application/javascript",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".wav": "audio/wav",
    ".webm": "video/webm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  }[extension] ?? "application/octet-stream";
}

/**
 * Source-runtime documents keep the producer's DOM structure and styling. The
 * only rewrite allowed here is an exact captured source URL -> resource protocol
 * substitution; the producer Viewer performs the final URL resolution and DOM
 * allow-list pass. Unknown network URLs and executable markup fail closed.
 */
export function preserveSourceMarkup(raw, bindingForResource, label, resourceRefByUrl = new Map()) {
  let markup = String(raw ?? "");
  for (const [url, resourceRefId] of [...resourceRefByUrl.entries()]
    .sort(([left], [right]) => right.length - left.length || left.localeCompare(right, "en"))) {
    const portableUrl = `asset://resource/${resourceRefId}`;
    markup = markup.split(url).join(portableUrl);
    const htmlEscapedUrl = url.replaceAll("&", "&amp;");
    if (htmlEscapedUrl !== url) markup = markup.split(htmlEscapedUrl).join(portableUrl);
  }
  markup.replace(/asset:\/\/resource\/(\d+)/g, (_all, rawId) => {
    if (!bindingForResource(Number(rawId))) fail(`${label} references missing resource ${rawId}`);
    return _all;
  });
  // MathJax v2 stores TeX in an inert script element. Keep that source DOM
  // byte-for-byte, but remove only the exact no-attribute math/tex form from
  // the executable-markup inspection copy. Every other script form remains a
  // hard failure (including src/event attributes and nested markup).
  const inspectedMarkup = stripInertMathTexScriptsForInspection(markup);
  if (/<\s*\/?\s*(?:script|iframe|object|embed|link|meta|base|form)\b/i.test(inspectedMarkup)
      || /(?:expression\s*\(|javascript:|-moz-binding|@import|\son[a-z]+\s*=)/i.test(markup)) {
    fail(`${label} contains unsafe CSS/script syntax`);
  }
  if (/(?<![A-Za-z0-9_-])(?:src|href|poster)\s*=\s*["']https?:\/\/|url\(\s*["']?https?:\/\//i.test(markup)) {
    fail(`${label} retains an external executable URL`);
  }
  return markup;
}

function sourceRuntimeRoutePath(prefix, ...parts) {
  const suffix = parts.flatMap((part) => String(part).split("/"))
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${prefix}/${suffix}`;
}

function parseArgs(argv) {
  const options = {
    packageKey: PACKAGE_KEY,
    stageH5: true,
    sourceRoot: path.resolve(process.cwd(), "..", "2026-07_mofaxiao_courseware"),
    outputRoot: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--metadata-only") {
      options.stageH5 = false;
      continue;
    }
    if (["--source-root", "--output-root", "--package-key"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) fail(`${arg} requires a value`);
      options[arg.slice(2).replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase())] = value;
      continue;
    }
    fail(`unknown argument ${arg}`);
  }
  options.sourceRoot = path.resolve(options.sourceRoot);
  options.outputRoot = path.resolve(
    options.outputRoot ?? path.join(process.cwd(), ".tmp", "aixuexi-import", options.packageKey),
  );
  return options;
}

export function rewriteTopicRootUrls(text, packagePath) {
  const directory = path.posix.dirname(packagePath);
  let remote = path.posix.relative(directory === "." ? "" : directory, "remote");
  if (!remote.startsWith(".")) remote = `./${remote}`;
  return text.replace(/(?<![A-Za-z0-9:])\/remote\//g, `${remote}/`);
}

async function buildTopicPackage({ sourcePackageRoot, outputRoot, topic, stageH5 }) {
  const sourceTopicRoot = resolveInside(sourcePackageRoot, topic.packageRootRelative);
  const manifestPath = path.join(sourceTopicRoot, "manifest.json");
  const manifest = await readJson(manifestPath);
  if (manifest.schemaVersion !== "aixuexi-topic-offline-package-v1" || manifest.status !== "complete") {
    fail(`${topic.packageRootRelative} is not a complete offline topic package`);
  }
  if (!manifest.launches?.some((launch) => launch.path === topic.launchPath)) {
    fail(`${topic.packageRootRelative} does not declare launch ${topic.launchPath}`);
  }

  const files = [];
  const buffers = new Map();
  for (const file of manifest.files ?? []) {
    const source = resolveInside(sourceTopicRoot, file.path);
    let buffer = await readFile(source);
    if (TEXT_EXTENSIONS.has(path.extname(file.path).toLowerCase())) {
      buffer = Buffer.from(rewriteTopicRootUrls(buffer.toString("utf8"), file.path), "utf8");
    }
    const hash = sha256(buffer);
    files.push({
      packagePath: file.path,
      sha256: hash,
      byteCount: buffer.byteLength,
      mime: mimeFor(file.path),
    });
    buffers.set(file.path, buffer);
  }
  files.sort((left, right) => left.packagePath.localeCompare(right.packagePath, "en"));
  const packageHash = sha256(JSON.stringify(stableJson({
    schemaVersion: "mathin-aixuexi-topic-package-v1",
    entryPath: topic.launchPath,
    files: files.map(({ packagePath, sha256: hash, byteCount }) => ({ packagePath, sha256: hash, byteCount })),
  })));
  const stagingRoot = path.join(outputRoot, "h5-staging", packageHash);
  if (buffers.size > 0) {
    for (const file of files) {
      const target = resolveInside(stagingRoot, file.packagePath);
      if (stageH5) {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, buffers.get(file.packagePath));
      }
      file.storeScope = "package";
      file.storeRelativePath = `h5-staging/${packageHash}/${file.packagePath}`;
    }
  }
  return {
    schemaVersion: "mathin-h5-manifest-v1",
    packageHash,
    entryPath: topic.launchPath,
    byteCount: files.reduce((sum, file) => sum + file.byteCount, 0),
    files,
    source: {
      schemaVersion: manifest.schemaVersion,
      packageRootRelative: topic.packageRootRelative,
      topicId: topic.topicId,
    },
  };
}

function assertSourceScope(siteManifest, catalog, config) {
  if (siteManifest.sourceSystem !== "aixuexi_bsk") fail("unexpected source system");
  if (siteManifest.schemaVersion !== 1 || catalog.schemaVersion !== 1) fail("unsupported source manifest schema");
  if (siteManifest.courseCount !== config.lectureCount || siteManifest.pageCount !== config.pageCount) {
    fail(`unexpected source counts: ${siteManifest.courseCount} lectures / ${siteManifest.pageCount} pages`);
  }
  if (siteManifest.projectedPageCount !== config.pageCount
      || siteManifest.unsupportedLayoutNodeCount !== 0
      || siteManifest.unmappedLayoutResourceCount !== 0
      || siteManifest.registeredGapNodeCount !== 0
      || siteManifest.registeredGapResourceCount !== 0) {
    fail("source manifest carries projection gaps");
  }
  if (catalog.courseCount !== config.lectureCount || catalog.courses?.length !== config.lectureCount) {
    fail(`catalog must contain ${config.lectureCount} lectures`);
  }
  for (const course of catalog.courses) {
    const grade = GRADE.get(course.grade);
    if (!config.grades.includes(grade) || course.term !== config.term || course.level !== config.sourceLevel
        || course.status !== "complete") {
      fail(`lecture ${course.coursewareId} is outside the approved ${config.level} scope`);
    }
  }
}

function assertSourceCanvas(layout, label) {
  const { canvas, playerStage, presentation } = layout;
  const canvasPair = `${canvas?.width}x${canvas?.height}`;
  if (!new Set(["1200x900", "1920x1080"]).has(canvasPair)
      || canvas?.sourceWidth !== canvas?.width || canvas?.sourceHeight !== canvas?.height
      || canvas?.coordinateScaleX !== 1 || canvas?.coordinateScaleY !== 1) {
    fail(`${label} carries an unsupported source canvas`);
  }
  if (playerStage?.width !== 1920 || playerStage?.height !== 1080
      || playerStage?.presentationScale !== 0.625
      || !Number.isFinite(playerStage?.offsetX) || !Number.isFinite(playerStage?.offsetY)
      || playerStage?.backgroundSize !== "auto 1080px"
      || playerStage?.backgroundPosition !== "center center"
      || playerStage?.backgroundRepeat !== "no-repeat"
      || !playerStage?.contentPadding || Object.values(playerStage.contentPadding).some((value) => !Number.isFinite(value))) {
    fail(`${label} carries an unexpected source player stage`);
  }
  if (presentation?.width !== SOURCE_PRESENTATION_WIDTH || presentation?.height !== SOURCE_PRESENTATION_HEIGHT
      || !Number.isFinite(presentation?.contentScale)
      || !Number.isFinite(presentation?.offsetX) || !Number.isFinite(presentation?.offsetY)) {
    fail(`${label} carries an unexpected source presentation rule`);
  }
  if (canvasPair === "1200x900" && presentation.contentScale !== 0.75) {
    fail(`${label} ordinary slide must use presentation scale 0.75`);
  }
  if (canvasPair === "1920x1080" && (presentation.contentScale !== 0.625
      || presentation.offsetX !== 0 || presentation.offsetY !== 0)) {
    fail(`${label} native game must use the 1920x1080 source presentation`);
  }
  if (!layout.behaviors || typeof layout.behaviors !== "object") fail(`${label} is missing source behaviors`);
}

export async function buildAixuexiPackage(options) {
  const sourceRoot = path.resolve(options.sourceRoot);
  const outputRoot = path.resolve(options.outputRoot);
  const config = PACKAGE_CONFIGS.get(options.packageKey);
  if (!config) fail(`unsupported package key ${options.packageKey}`);
  const sourcePackageRoot = path.join(sourceRoot, "exports", "packages", options.packageKey);
  const siteRoot = path.join(sourcePackageRoot, "site");
  const [siteManifest, catalog, slideRuntime, playerRuntime] = await Promise.all([
    readJson(path.join(siteRoot, "manifest.json")),
    readJson(path.join(siteRoot, "catalog.json")),
    readJson(path.join(siteRoot, "slide-runtime.json")),
    readJson(path.join(siteRoot, "player-runtime.json")),
  ]);
  assertSourceScope(siteManifest, catalog, config);
  if (slideRuntime.schemaVersion !== 1 || slideRuntime.packageKey !== options.packageKey
      || slideRuntime.stylesheetPath !== "slide-runtime.css" || !HASH.test(slideRuntime.cssSha256 ?? "")
      || siteManifest.slideRuntime?.cssSha256 !== slideRuntime.cssSha256) {
    fail("invalid slide runtime contract");
  }
  if (playerRuntime.schemaVersion !== config.playerRuntimeSchemaVersion
      || playerRuntime.packageKey !== options.packageKey
      || playerRuntime.derivationVersion !== config.playerRuntimeDerivationVersion
      || playerRuntime.lessonBindings?.length !== config.lectureCount) {
    fail("invalid player runtime contract");
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(path.join(outputRoot, "page-docs"), { recursive: true });
  await mkdir(path.join(outputRoot, "h5-manifests"), { recursive: true });

  const packageManifestSha256 = textFileSha256(path.join(siteRoot, "manifest.json"));
  const lectures = [];
  const pagesByLecture = new Map();
  const usages = new Map();
  const candidates = new Map();
  const objects = new Map();
  const h5Manifests = new Map();

  const addH5Package = async ({ packageHash, entryPath, sourceDirectory, source }) => {
    if (!HASH.test(packageHash ?? "")) fail(`invalid H5 package hash ${packageHash}`);
    if (h5Manifests.has(packageHash)) return h5Manifests.get(packageHash);
    const files = [];
    const walk = async (directory, prefix = "") => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute, relative);
        else if (entry.isFile()) {
          const info = await stat(absolute);
          const hash = await sha256File(absolute);
          files.push({
            packagePath: relative.replaceAll("\\", "/"),
            sha256: hash,
            byteCount: info.size,
            mime: mimeFor(relative),
            storeRelativePath: path.relative(sourceRoot, absolute).replaceAll("\\", "/"),
            storeScope: "source",
          });
        }
      }
    };
    await walk(sourceDirectory);
    if (!files.some((file) => file.packagePath === entryPath)) fail(`${packageHash} misses H5 entry ${entryPath}`);
    const manifest = {
      schemaVersion: "mathin-h5-manifest-v1",
      packageHash,
      entryPath,
      byteCount: files.reduce((sum, file) => sum + file.byteCount, 0),
      files: files.sort((left, right) => left.packagePath.localeCompare(right.packagePath, "en")),
      source,
    };
    h5Manifests.set(packageHash, manifest);
    return manifest;
  };

  let lottieRuntimeResource = null;
  for (const item of siteManifest.items.filter((entry) => entry.kind === "page")) {
    const page = await readJson(resolveInside(siteRoot, item.path));
    lottieRuntimeResource = (page.assets?.resources ?? []).find((resource) =>
      resource.kind === "script" && /(?:^|\/)lottie(?:\.min)?\.js(?:$|\?)/i.test(resource.normalizedUrl ?? resource.sourceUrl ?? ""),
    ) ?? null;
    if (lottieRuntimeResource) break;
  }

  const runtimeSourcePaths = [...new Set([
    "slide-runtime.css", "itv-runtime.css", "player-runtime.json",
    ...playerRuntime.questionImageSizingVariants.flatMap((item) => [item.jqueryRuntimePath, item.executionRuntimePath]),
  ])].sort((left, right) => left.localeCompare(right, "en"));
  const runtimeSourceFiles = new Map();
  for (const relativePath of runtimeSourcePaths) {
    const sourceFile = resolveInside(siteRoot, relativePath);
    const content = await readFile(sourceFile);
    runtimeSourceFiles.set(relativePath, { sourceFile, content, sha256: sha256(content) });
  }

  const staticRoutes = {};
  for (const variant of playerRuntime.questionImageSizingVariants) {
    staticRoutes[`/api/aixuexi-player-runtime/jquery/${variant.jquerySha256}.js`] = `./${variant.jqueryRuntimePath}`;
    staticRoutes[`/api/aixuexi-player-runtime/question-image/${variant.executionRuntimeSha256}.js`] = `./${variant.executionRuntimePath}`;
  }
  const sourceViewer = await loadAixuexiSourceViewerRuntime(sourceRoot);
  const portableViewer = buildPortableAixuexiViewerRuntime({
    ...sourceViewer,
    staticRoutes: Object.fromEntries(Object.entries(staticRoutes).sort(([left], [right]) => left.localeCompare(right, "en"))),
  });
  const runtimeHtml = portableAixuexiViewerHtml({ hasLottie: Boolean(lottieRuntimeResource) });
  const sourceCss = runtimeSourceFiles.get("slide-runtime.css").content.toString("utf8");
  const itvCss = runtimeSourceFiles.get("itv-runtime.css").content.toString("utf8");
  const runtimeCssText = `${sourceCss}\n${itvCss}\n${portableViewer.viewerStyles}`;
  const runtimeAssetMatches = [...runtimeCssText.matchAll(/\/api\/slide-(?:asset|font)\/([0-9a-f]{64})(\.[A-Za-z0-9]+)?/g)];
  const runtimeAssets = [...new Map(runtimeAssetMatches.map((match) => [match[1], {
    objectHash: match[1], extension: match[2] ?? "",
  }])).values()].sort((left, right) => left.objectHash.localeCompare(right.objectHash, "en"));

  const katexRoot = path.resolve(process.cwd(), "node_modules", "katex", "dist");
  const katexFiles = [
    { packagePath: "vendor/katex/katex.min.css", sourceFile: path.join(katexRoot, "katex.min.css") },
    { packagePath: "vendor/katex/katex.min.js", sourceFile: path.join(katexRoot, "katex.min.js") },
    ...(await readdir(path.join(katexRoot, "fonts"), { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .sort((left, right) => left.name.localeCompare(right.name, "en"))
      .map((entry) => ({ packagePath: `vendor/katex/fonts/${entry.name}`, sourceFile: path.join(katexRoot, "fonts", entry.name) })),
  ];
  for (const file of katexFiles) file.sha256 = await sha256File(file.sourceFile);

  const runtimePackageHash = domainHash(
    "aixuexi-source-viewer-runtime-v1",
    options.packageKey,
    portableViewer.sourceFingerprint,
    sha256(runtimeHtml),
    sha256(portableViewer.viewerScript),
    sha256(portableViewer.viewerStyles),
    ...[...runtimeSourceFiles.entries()].map(([relativePath, file]) => `${relativePath}:${file.sha256}`),
    ...runtimeAssets.map((item) => `${item.objectHash}${item.extension}`),
    ...katexFiles.map((file) => `${file.packagePath}:${file.sha256}`),
    lottieRuntimeResource?.objectSha256 ?? "no-lottie-runtime",
  );
  const runtimeStageRoot = path.join(outputRoot, "h5-staging", runtimePackageHash);
  const runtimeFiles = [];
  const stageRuntimeFile = async (packagePath, sourceFile, content = null) => {
    const target = resolveInside(runtimeStageRoot, packagePath);
    await mkdir(path.dirname(target), { recursive: true });
    if (content === null) content = await readFile(sourceFile);
    await writeFile(target, content);
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    runtimeFiles.push({
      packagePath,
      sha256: sha256(bytes),
      byteCount: bytes.byteLength,
      mime: mimeFor(packagePath),
      storeRelativePath: `h5-staging/${runtimePackageHash}/${packagePath}`,
      storeScope: "package",
    });
  };
  const rewriteRuntimeAssetUrls = (value) => value.replace(
    /\/api\/slide-(?:asset|font)\/([0-9a-f]{64})(\.[A-Za-z0-9]+)?/g,
    (_all, hash, extension = "") => `./runtime-assets/${hash}${extension}`,
  );
  for (const [relativePath, sourceFile] of runtimeSourceFiles) {
    const content = relativePath.endsWith(".css")
      ? rewriteRuntimeAssetUrls(sourceFile.content.toString("utf8"))
      : sourceFile.content;
    await stageRuntimeFile(relativePath, sourceFile.sourceFile, content);
  }
  await stageRuntimeFile("viewer-runtime.css", path.join(siteRoot, "viewer-runtime.css"), rewriteRuntimeAssetUrls(portableViewer.viewerStyles));
  await stageRuntimeFile("viewer-runtime.js", path.join(siteRoot, "viewer-runtime.js"), portableViewer.viewerScript);
  await stageRuntimeFile("index.html", path.join(siteRoot, "index.html"), runtimeHtml);
  for (const file of katexFiles) await stageRuntimeFile(file.packagePath, file.sourceFile);
  for (const asset of runtimeAssets) {
    const sourceFile = path.join(sourceRoot, "store", "objects", "sha256", asset.objectHash.slice(0, 2), asset.objectHash);
    if (await sha256File(sourceFile) !== asset.objectHash) fail(`runtime asset ${asset.objectHash} failed CAS verification`);
    await stageRuntimeFile(`runtime-assets/${asset.objectHash}${asset.extension}`, sourceFile);
  }
  if (lottieRuntimeResource) {
    const sourceFile = path.join(sourceRoot, "store", lottieRuntimeResource.objectRelativePath);
    if (await sha256File(sourceFile) !== lottieRuntimeResource.objectSha256) fail("lottie runtime failed CAS verification");
    await stageRuntimeFile("lottie.min.js", sourceFile);
  }
  h5Manifests.set(runtimePackageHash, {
    schemaVersion: "mathin-h5-manifest-v1",
    packageHash: runtimePackageHash,
    entryPath: "index.html",
    byteCount: runtimeFiles.reduce((sum, file) => sum + file.byteCount, 0),
    files: runtimeFiles.sort((left, right) => left.packagePath.localeCompare(right.packagePath, "en")),
    source: {
      kind: "aixuexi_source_viewer_runtime",
      packageKey: options.packageKey,
      cssSha256: slideRuntime.cssSha256,
      sourceFingerprint: portableViewer.sourceFingerprint,
    },
  });

  const addUsage = ({ coursewareId, pageDatabaseId, resource, role }) => {
    if (!resource || !HASH.test(resource.objectSha256 ?? "")) {
      fail(`${coursewareId}/${pageDatabaseId} has an unresolved ${role} resource`);
    }
    const projectedKind = resource.kind === "svg" ? "svg"
      : resource.kind === "video" ? "video"
        : resource.kind === "audio" ? "audio" : "image";
    const usageKey = domainHash(
      "aixuexi-usage-v1", coursewareId, String(pageDatabaseId),
      String(resource.resourceRefId), role, resource.objectSha256,
    );
    const candidateKey = domainHash("aixuexi-candidate-v1", projectedKind, role, resource.objectSha256);
    usages.set(usageKey, {
      usageKey, coursewareId, pageDatabaseId, objectHash: resource.objectSha256,
      objectKind: "cas", candidateKey, role, kind: projectedKind,
    });
    candidates.set(candidateKey, {
      candidateKey, objectHash: resource.objectSha256, kind: projectedKind, role,
    });
    objects.set(resource.objectSha256, {
      objectHash: resource.objectSha256,
      mime: resource.mime,
      byteCount: resource.byteCount,
      storeRelativePath: `store/${resource.objectRelativePath}`,
      storeScope: "source",
      kind: projectedKind,
    });
    return usageKey;
  };

  const addPackageUsage = ({ coursewareId, pageDatabaseId, packageHash, role, discriminator = "" }) => {
    if (!h5Manifests.has(packageHash)) fail(`${coursewareId}/${pageDatabaseId} misses H5 package ${packageHash}`);
    const usageKey = domainHash(
      "aixuexi-h5-usage-v2", coursewareId, String(pageDatabaseId), role, discriminator, packageHash,
    );
    const candidateKey = domainHash("aixuexi-h5-candidate-v2", role, packageHash);
    usages.set(usageKey, {
      usageKey, coursewareId, pageDatabaseId, objectHash: packageHash,
      objectKind: "h5_package", candidateKey, role, kind: "h5",
      launchQuery: {}, coursewareIdParam: null,
    });
    candidates.set(candidateKey, { candidateKey, objectHash: packageHash, kind: "h5", role });
    return usageKey;
  };

  const sortedCourses = [...catalog.courses].sort((left, right) => {
    const grade = GRADE.get(left.grade) - GRADE.get(right.grade);
    return grade || left.lessonIndex - right.lessonIndex;
  });
  for (const catalogCourse of sortedCourses) {
    const grade = GRADE.get(catalogCourse.grade);
    const course = await readJson(resolveInside(siteRoot, catalogCourse.dataPath));
    const verificationPath = path.join(sourcePackageRoot, "offline-verification", `lesson-${course.coursewareId}.json`);
    const verification = await readJson(verificationPath);
    if (verification.status !== "complete"
        || verification.counts?.remoteRequests !== 0
        || verification.counts?.localMissing !== 0
        || verification.counts?.fatalConsoleErrors !== 0) {
      fail(`lecture ${course.coursewareId} failed offline verification`);
    }
    lectures.push({
      coursewareId: course.coursewareId,
      mathinProductCode: `${config.productPrefix}-${String(grade).padStart(2, "0")}-${config.termCode}`,
      lessonIndex: catalogCourse.lessonIndex,
      lessonName: catalogCourse.lessonName,
      pageCount: catalogCourse.pageCount,
      documentAdapter: "source-runtime-v1",
      sourceSystem: "aixuexi_bsk",
      sourcePackageKey: options.packageKey,
      sourcePackageManifestSha256: packageManifestSha256,
      sourcePackageLabels: { year: 2026, level: config.level, edition: config.edition, subject: "数学", term: config.term },
      sourcePackageScope: { grades: config.grades, term: config.term, level: config.level, placeholders: "source_catalog_only" },
      sourcePackageCounts: { lectureCount: config.lectureCount, pageCount: config.pageCount },
      sourceRuntimePackageHash: runtimePackageHash,
      sourceProductCode: catalogCourse.productCode,
      offlineStatus: verification.status,
      verificationSha256: textFileSha256(verificationPath),
    });

    const rows = [];
    for (let index = 0; index < course.pages.length; index += 1) {
      const pageMeta = course.pages[index];
      const nextPage = course.pages[index + 1] ?? null;
      const sourcePage = await readJson(resolveInside(siteRoot, pageMeta.dataPath));
      if (sourcePage.layout?.adapter !== "aixuexi_page_v1"
          || sourcePage.layout?.projectionVersion !== SOURCE_PROJECTION_VERSION
          || sourcePage.reviewState?.mappingStatus !== "mapped") {
        fail(`${course.coursewareId}/${pageMeta.pageDatabaseId} is not a mapped projection v${SOURCE_PROJECTION_VERSION} page`);
      }
      assertSourceCanvas(sourcePage.layout, `${course.coursewareId}/${pageMeta.pageDatabaseId}`);
      const resources = new Map(
        (sourcePage.assets?.resources ?? []).map((resource) => [resource.resourceRefId, resource]),
      );
      const resourceRefByUrl = new Map();
      for (const resource of [...resources.values()].sort((left, right) => left.resourceRefId - right.resourceRefId)) {
        for (const url of [resource.sourceUrl, resource.normalizedUrl, resource.finalUrl]) {
          if (typeof url === "string" && /^https?:\/\//i.test(url) && !resourceRefByUrl.has(url)) {
            resourceRefByUrl.set(url, resource.resourceRefId);
          }
        }
      }
      const keyByRef = new Map();
      const bindingForRef = (resourceRefId) => {
        if (resourceRefId === null || resourceRefId === undefined) return null;
        if (!keyByRef.has(resourceRefId)) {
          const resource = resources.get(resourceRefId);
          if (!resource || resource.kind === "script" || resource.kind === "html") {
            fail(`${course.coursewareId}/${pageMeta.pageDatabaseId} has an unsupported runtime resource ${resourceRefId}`);
          }
          keyByRef.set(resourceRefId, addUsage({
            coursewareId: course.coursewareId,
            pageDatabaseId: pageMeta.pageDatabaseId,
            resource,
            role: resource.role || "source",
          }));
        }
        return keyByRef.get(resourceRefId);
      };
      for (const resource of [...resources.values()].sort((left, right) => left.resourceRefId - right.resourceRefId)) {
        if (resource.kind !== "script" && resource.kind !== "html") bindingForRef(resource.resourceRefId);
      }

      const runtimeBindingKey = addPackageUsage({
        coursewareId: course.coursewareId,
        pageDatabaseId: pageMeta.pageDatabaseId,
        packageHash: runtimePackageHash,
        role: "aixuexi_source_runtime",
      });

      const routeBindings = new Map();
      const bindRoute = (routePath, bindingKey) => {
        if (routeBindings.has(routePath)) fail(`${course.coursewareId}/${pageMeta.pageDatabaseId} duplicates route ${routePath}`);
        routeBindings.set(routePath, bindingKey);
      };
      const portableLayout = structuredClone(sourcePage.layout);
      for (const node of portableLayout.nodes) {
        if (typeof node.html === "string") {
          node.html = preserveSourceMarkup(
            node.html,
            bindingForRef,
            `${course.coursewareId}/${pageMeta.pageDatabaseId}/${node.id}`,
            resourceRefByUrl,
          );
        }
        if (node.trueOrFalse) {
          node.trueOrFalse.contentHtml = preserveSourceMarkup(
            node.trueOrFalse.contentHtml,
            bindingForRef,
            `${course.coursewareId}/${pageMeta.pageDatabaseId}/${node.id}/true-or-false`,
            resourceRefByUrl,
          );
          node.trueOrFalse.options = node.trueOrFalse.options.map((option, optionIndex) => ({
            ...option,
            html: preserveSourceMarkup(
              option.html,
              bindingForRef,
              `${course.coursewareId}/${pageMeta.pageDatabaseId}/${node.id}/option-${optionIndex}`,
              resourceRefByUrl,
            ),
          }));
        }
        if (node.topicClassification) {
          node.topicClassification.stageHtml = preserveSourceMarkup(
            node.topicClassification.stageHtml,
            bindingForRef,
            `${course.coursewareId}/${pageMeta.pageDatabaseId}/${node.id}/topic-classification`,
            resourceRefByUrl,
          );
        }
        if (node.kind === "embedded_h5" && node.embeddedH5) {
          const packageHash = node.embeddedH5.packageHash;
          const patchedRoot = path.join(sourceRoot, "store", "h5", "packages", packageHash, "patched");
          const originalRoot = path.join(sourceRoot, "store", "h5", "packages", packageHash, "original");
          let sourceDirectory;
          try {
            sourceDirectory = (await stat(patchedRoot)).isDirectory() ? patchedRoot : originalRoot;
          } catch {
            sourceDirectory = originalRoot;
          }
          await addH5Package({
            packageHash,
            entryPath: node.embeddedH5.entryPackagePath,
            sourceDirectory,
            source: { kind: "aixuexi_embedded_h5", packageKey: options.packageKey },
          });
          const bindingKey = addPackageUsage({
            coursewareId: course.coursewareId,
            pageDatabaseId: pageMeta.pageDatabaseId,
            packageHash,
            role: "embedded_h5",
            discriminator: node.id,
          });
          bindRoute(
            sourceRuntimeRoutePath(
              "/api/aixuexi-embedded-h5",
              packageHash,
              node.embeddedH5.entryPackagePath,
            ),
            bindingKey,
          );
        }
      }

      let topicInteraction = null;
      if (sourcePage.topicInteraction?.status === "capture_required") {
        topicInteraction = {
          status: "capture_required",
          topicId: sourcePage.topicInteraction.topicId,
          entryKind: sourcePage.topicInteraction.entryKind,
        };
      } else if (sourcePage.topicInteraction) {
        if (sourcePage.topicInteraction.status !== "offline") {
          fail(`${course.coursewareId}/${pageMeta.pageDatabaseId} has unknown topic status ${sourcePage.topicInteraction.status}`);
        }
        const h5 = await buildTopicPackage({
          sourcePackageRoot,
          outputRoot,
          topic: sourcePage.topicInteraction,
          stageH5: options.stageH5,
        });
        h5Manifests.set(h5.packageHash, h5);
        const usageKey = addPackageUsage({
          coursewareId: course.coursewareId,
          pageDatabaseId: pageMeta.pageDatabaseId,
          role: "topic_interaction",
          packageHash: h5.packageHash,
          discriminator: sourcePage.topicInteraction.topicId,
        });
        topicInteraction = {
          status: "offline",
          topicId: sourcePage.topicInteraction.topicId,
          entryKind: sourcePage.topicInteraction.entryKind,
          launchPath: sourcePage.topicInteraction.launchPath,
        };
        bindRoute(
          sourceRuntimeRoutePath(
            "/api/aixuexi-topic",
            course.coursewareId,
            pageMeta.pageDatabaseId,
            sourcePage.topicInteraction.launchPath,
          ),
          usageKey,
        );
      }

      const sourceItv = sourcePage.itvInteraction;
      if (sourceItv && sourceItv.projectionVersion !== SOURCE_ITV_PROJECTION_VERSION) {
        fail(`${course.coursewareId}/${pageMeta.pageDatabaseId} carries ITV projection v${sourceItv.projectionVersion}`);
      }
      const itvInteraction = sourceItv ? structuredClone(sourceItv) : null;
      for (const event of itvInteraction?.events ?? []) {
        for (const widget of event.stage?.widgets ?? []) {
          if (typeof widget.html === "string") {
            widget.html = preserveSourceMarkup(
              widget.html,
              bindingForRef,
              `${course.coursewareId}/ITV/${event.eventIndex}/${widget.id}`,
              resourceRefByUrl,
            );
          }
        }
      }

      const portableMetadata = structuredClone(sourcePage.metadata);
      delete portableMetadata.sourceObjectRelativePath;
      const portablePage = {
        schemaVersion: sourcePage.schemaVersion,
        sourceSystem: sourcePage.sourceSystem,
        packageKey: sourcePage.packageKey,
        coursewareId: sourcePage.coursewareId,
        pageDatabaseId: sourcePage.pageDatabaseId,
        normalized: structuredClone(sourcePage.normalized),
        metadata: structuredClone(portableMetadata),
        assets: {
          resources: [...resources.values()].map((resource) => ({
            resourceRefId: resource.resourceRefId,
            jsonPath: resource.jsonPath,
            nodeType: resource.nodeType,
            role: resource.role,
            kind: resource.kind,
            mime: resource.mime,
            objectSha256: resource.objectSha256,
            byteCount: resource.byteCount,
            availableLocally: resource.availableLocally,
            storageMode: resource.storageMode,
            validationStatus: resource.validationStatus,
          })),
        },
        layout: portableLayout,
        topicInteraction,
        itvInteraction,
      };
      const doc = {
        docVersion: SOURCE_RUNTIME_PAGE_DOC_VERSION,
        source: {
          sourceSystem: "aixuexi_bsk",
          packageKey: options.packageKey,
          coursewareId: course.coursewareId,
          pageDatabaseId: pageMeta.pageDatabaseId,
          sourceSnapshotId: sourcePage.metadata.sourceSnapshotId,
          sourceContentHash: sourcePage.metadata.sourceSha256,
          pageName: sourcePage.normalized.name,
          groupName: sourcePage.normalized.groupName ?? null,
        },
        viewport: {
          width: SOURCE_PRESENTATION_WIDTH,
          height: SOURCE_PRESENTATION_HEIGHT,
        },
        runtime: {
          protocol: SOURCE_RUNTIME_PROTOCOL,
          bindingKey: runtimeBindingKey,
          packageHash: runtimePackageHash,
          entryPath: "index.html",
          sourceFingerprint: portableViewer.sourceFingerprint,
        },
        payload: {
          format: "aixuexi-viewer-page-v1",
          data: portablePage,
        },
        bindings: {
          resources: Object.fromEntries(
            [...keyByRef.entries()]
              .sort(([left], [right]) => left - right)
              .map(([resourceRefId, bindingKey]) => [String(resourceRefId), bindingKey]),
          ),
          routes: [...routeBindings.entries()]
            .sort(([left], [right]) => left.localeCompare(right, "en"))
            .map(([routePath, bindingKey]) => ({ path: routePath, bindingKey })),
        },
        behavior: {
          advanceOnCanvasClick: Boolean(nextPage && nextPage.name === pageMeta.name),
        },
      };
      rows.push({
        coursewareId: course.coursewareId,
        pageIndex: pageMeta.pageIndex,
        pageDatabaseId: pageMeta.pageDatabaseId,
        sourcePageId: `page-db:${pageMeta.pageDatabaseId}`,
        name: pageMeta.name,
        thumbnailBindingKey: null,
        doc,
      });
    }
    pagesByLecture.set(course.coursewareId, rows);
  }

  const writeRecords = [];
  const writeTracked = async (relativePath, content) => {
    const target = resolveInside(outputRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    writeRecords.push({
      path: relativePath,
      sha256: sha256(Buffer.from(content, "utf8")),
      byteCount: Buffer.byteLength(content),
    });
  };
  const ndjson = (rows) => `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  await writeTracked("lectures.ndjson", ndjson(lectures));
  await writeTracked("asset-objects.ndjson", ndjson([...objects.values()].sort((a, b) => a.objectHash.localeCompare(b.objectHash))));
  await writeTracked("candidates.ndjson", ndjson([...candidates.values()].sort((a, b) => a.candidateKey.localeCompare(b.candidateKey))));
  await writeTracked("usages.ndjson", ndjson([...usages.values()].sort((a, b) => a.usageKey.localeCompare(b.usageKey))));
  for (const [coursewareId, pages] of pagesByLecture) {
    await writeTracked(`page-docs/${coursewareId}.ndjson`, ndjson(pages));
  }
  for (const [hash, manifest] of h5Manifests) {
    await writeTracked(`h5-manifests/${hash}.json`, JSON.stringify(manifest));
  }
  await writeFile(path.join(outputRoot, "manifest.json"), JSON.stringify({
    schemaVersion: "mathin-package-export-v1",
    exportId: `aixuexi-${options.packageKey}-source-runtime-v1`,
    files: writeRecords.sort((a, b) => a.path.localeCompare(b.path, "en")),
  }, null, 2), "utf8");

  return {
    outputRoot,
    sourceRoot,
    packageKey: options.packageKey,
    lectures: lectures.length,
    pages: [...pagesByLecture.values()].reduce((sum, rows) => sum + rows.length, 0),
    usages: usages.size,
    objects: objects.size,
    h5Packages: h5Manifests.size,
    h5Files: [...h5Manifests.values()].reduce((sum, manifest) => sum + manifest.files.length, 0),
    h5Staged: options.stageH5,
  };
}

async function main() {
  const summary = await buildAixuexiPackage(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
