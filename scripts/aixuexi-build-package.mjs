import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sanitizeHtml from "sanitize-html";
import { textFileSha256 } from "./lib/text-hash.mjs";

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
  }],
  ["2026-xplus-sujiao-math", {
    lectureCount: 84, pageCount: 2767, grades: [1, 2, 3, 4, 5, 6],
    level: "X+", sourceLevel: "能力提高 X+", edition: "苏教版", productPrefix: "AXX26X-SJ",
  }],
  ["2026-aplus-quanguo-math", {
    lectureCount: 30, pageCount: 1034, grades: [1, 2],
    level: "A+", sourceLevel: "思维突破 A+", edition: "全国版", productPrefix: "AXX26A-QG",
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

function fail(message) {
  throw new Error(`AIXUEXI_BUILD: ${message}`);
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
 * 允许清单按「移植过来的呈现规则实际选择到的标签/属性」定档，不是按源站原样放行。
 * `u` 承载 stagedReveal 的填空揭示，`role`/`data-shadow-text` 是 tk-answer-moden25 按钮与
 * interact-plus 描边文字的 CSS 命中点，删掉任何一个都会静默丢一类呈现。
 */
const MARKUP_OPTIONS = {
  allowedTags: [
    "a", "div", "p", "span", "br", "img", "b", "i", "em", "strong", "sub", "sup", "hr", "u",
    "figure", "svg", "path", "g", "defs", "marker", "line", "polyline", "polygon", "circle",
    "ellipse", "rect", "text", "tspan", "clipPath", "foreignObject", "table", "tbody", "thead",
    "tr", "td", "th", "ol", "ul", "li", "math", "mrow", "mi", "mn", "mo", "mfrac", "msup", "msub",
    "font", "ruby", "rt", "style", "title", "video",
  ],
  // 来源 review export 已完成节点级消毒；这里保留源 CSS/player 选择器依赖的完整
  // data-/SVG/MathML 属性，并在 sanitizeMarkup 中额外拒绝事件处理器与外部 URL。
  allowedAttributes: { "*": ["*"] },
  allowedSchemes: ["asset", "data"],
  allowProtocolRelative: false,
  allowVulnerableTags: true,
  parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
};

function sanitizeMarkup(raw, bindingForResource, label) {
  const localized = String(raw ?? "").replace(/asset:\/\/resource\/(\d+)/g, (_all, rawId) => {
    const key = bindingForResource(Number(rawId));
    if (!key) fail(`${label} references missing resource ${rawId}`);
    return `asset://binding/${key}`;
  });
  if (/(?:expression\s*\(|javascript:|-moz-binding|@import|\son[a-z]+\s*=)/i.test(localized)) {
    fail(`${label} contains unsafe CSS/script syntax`);
  }
  const sanitized = sanitizeHtml(localized, MARKUP_OPTIONS);
  if (/asset:\/\/resource\//.test(sanitized)) fail(`${label} retains a local resource id`);
  if (/(?<![A-Za-z0-9_-])(?:src|href)\s*=\s*["']https?:\/\/|url\(\s*["']?https?:\/\//i.test(sanitized)) {
    fail(`${label} retains an external URL`);
  }
  return sanitized;
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
    if (!config.grades.includes(grade) || course.term !== "秋季" || course.level !== config.sourceLevel
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

function projectBehaviors(behaviors, label) {
  const scroll = (value, extraKey) => {
    if (value === null || value === undefined) return null;
    if (value.enabled !== true) fail(`${label} has a disabled scroll behavior with a body`);
    const projected = {
      top: value.top,
      height: value.height,
      [extraKey]: value[extraKey],
    };
    for (const [key, item] of Object.entries(projected)) {
      if (!Number.isFinite(item)) fail(`${label} scroll behavior has a non-finite ${key}`);
    }
    return projected;
  };
  return {
    splitQuestionScroll: scroll(behaviors.splitQuestionScroll, "contentHeight"),
    singleQuestionScroll: scroll(behaviors.singleQuestionScroll, "clampWidth"),
    stagedReveal: {
      underlineCount: behaviors.stagedReveal?.underlineCount ?? 0,
      summaryWidgetCount: behaviors.stagedReveal?.summaryWidgetCount ?? 0,
    },
    widgetReveal: { steps: behaviors.widgetReveal?.steps ?? 0 },
    shapeTextFit: behaviors.shapeTextFit
      ? { minFontSize: behaviors.shapeTextFit.minFontSize }
      : null,
  };
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
  if (playerRuntime.schemaVersion !== 3 || playerRuntime.packageKey !== options.packageKey
      || playerRuntime.derivationVersion !== 3
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
  const sourceCss = await readFile(path.join(siteRoot, "slide-runtime.css"), "utf8");
  const runtimeAssetMatches = [...sourceCss.matchAll(/\/api\/slide-(?:asset|font)\/([0-9a-f]{64})(\.[A-Za-z0-9]+)?/g)];
  const runtimeAssets = [...new Map(runtimeAssetMatches.map((match) => [match[1], {
    objectHash: match[1], extension: match[2] ?? "",
  }])).values()];
  const runtimePackageHash = domainHash(
    "aixuexi-slide-runtime-v1", options.packageKey, slideRuntime.cssSha256,
    ...runtimeSourcePaths, ...runtimeAssets.map((item) => `${item.objectHash}${item.extension}`),
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
  for (const relativePath of runtimeSourcePaths) {
    const sourceFile = resolveInside(siteRoot, relativePath);
    if (relativePath === "slide-runtime.css") {
      const rewritten = sourceCss.replace(
        /\/api\/slide-(?:asset|font)\/([0-9a-f]{64})(\.[A-Za-z0-9]+)?/g,
        (_all, hash, extension = "") => `./runtime-assets/${hash}${extension}`,
      );
      await stageRuntimeFile(relativePath, sourceFile, rewritten);
    } else {
      await stageRuntimeFile(relativePath, sourceFile);
    }
  }
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
    entryPath: "slide-runtime.css",
    byteCount: runtimeFiles.reduce((sum, file) => sum + file.byteCount, 0),
    files: runtimeFiles.sort((left, right) => left.packagePath.localeCompare(right.packagePath, "en")),
    source: { kind: "aixuexi_slide_runtime", packageKey: options.packageKey, cssSha256: slideRuntime.cssSha256 },
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
      mathinProductCode: `${config.productPrefix}-${String(grade).padStart(2, "0")}-AUT`,
      lessonIndex: catalogCourse.lessonIndex,
      lessonName: catalogCourse.lessonName,
      pageCount: catalogCourse.pageCount,
      documentAdapter: "aixuexi-page-v1",
      sourceSystem: "aixuexi_bsk",
      sourcePackageKey: options.packageKey,
      sourcePackageManifestSha256: packageManifestSha256,
      sourcePackageLabels: { year: 2026, level: config.level, edition: config.edition, subject: "数学", term: "秋季" },
      sourcePackageScope: { grades: config.grades, term: "秋季", level: config.level, placeholders: "source_catalog_only" },
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
      const resources = new Map((sourcePage.assets?.resources ?? []).map((resource) => [resource.resourceRefId, resource]));
      const keyByRef = new Map();
      const bindingForRef = (resourceRefId, role) => {
        if (resourceRefId === null || resourceRefId === undefined) return null;
        const mapKey = `${resourceRefId}:${role ?? ""}`;
        if (!keyByRef.has(mapKey)) {
          const resource = resources.get(resourceRefId);
          keyByRef.set(mapKey, addUsage({
            coursewareId: course.coursewareId,
            pageDatabaseId: pageMeta.pageDatabaseId,
            resource,
            role: role || resource?.role || "source",
          }));
        }
        return keyByRef.get(mapKey);
      };
      const defaultBindingForRef = (resourceRefId) => {
        const resource = resources.get(resourceRefId);
        return bindingForRef(resourceRefId, resource?.role || "source");
      };

      const runtimeBindingKey = addPackageUsage({
        coursewareId: course.coursewareId,
        pageDatabaseId: pageMeta.pageDatabaseId,
        packageHash: runtimePackageHash,
        role: "aixuexi_source_runtime",
      });

      const projectResourceMap = (record, rolePrefix) => Object.fromEntries(
        Object.entries(record ?? {}).map(([key, value]) => [key, bindingForRef(value, `${rolePrefix}:${key}`)]),
      );

      const nodes = [];
      for (const node of sourcePage.layout.nodes) {
        const roleFor = (resourceRefId) => {
          if (node.kind === "background") return "background";
          if (node.kind === "itv_video") return "itv_video";
          return resources.get(resourceRefId)?.role || "source";
        };
        const resourceBindingKeys = [...new Set((node.resourceRefIds ?? []).map((id) => bindingForRef(id, roleFor(id))))];
        const resourceBindingKey = node.resourceRefId === undefined
          ? null
          : bindingForRef(node.resourceRefId, roleFor(node.resourceRefId));
        let embeddedH5 = null;
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
          embeddedH5 = {
            ...node.embeddedH5,
            bindingKey: addPackageUsage({
              coursewareId: course.coursewareId,
              pageDatabaseId: pageMeta.pageDatabaseId,
              packageHash,
              role: "embedded_h5",
              discriminator: node.id,
            }),
          };
        }
        nodes.push({
          id: node.id,
          sourcePath: node.sourcePath,
          sourceType: node.sourceType,
          kind: node.kind,
          title: node.title,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          zIndex: node.zIndex,
          rotation: node.rotation,
          transform: node.transform ?? "",
          transformOrigin: node.transformOrigin ?? "",
          known: node.known,
          html: typeof node.html === "string"
            ? sanitizeMarkup(node.html, defaultBindingForRef, `${course.coursewareId}/${pageMeta.pageDatabaseId}/${node.id}`)
            : null,
          resourceBindingKey,
          resourceBindingKeys,
          revealStep: node.revealStep ?? 0,
          animations: node.animations ?? [],
          questionTkRuntime: node.questionTkRuntime ?? null,
          embeddedH5,
          trueOrFalse: node.trueOrFalse ? {
            ...node.trueOrFalse,
            contentHtml: sanitizeMarkup(
              node.trueOrFalse.contentHtml,
              defaultBindingForRef,
              `${course.coursewareId}/${pageMeta.pageDatabaseId}/${node.id}/true-or-false`,
            ),
            options: node.trueOrFalse.options.map((option, optionIndex) => ({
              ...option,
              html: sanitizeMarkup(
                option.html,
                defaultBindingForRef,
                `${course.coursewareId}/${pageMeta.pageDatabaseId}/${node.id}/option-${optionIndex}`,
              ),
            })),
            assets: projectResourceMap(node.trueOrFalse.assets, "true_or_false"),
          } : null,
          topicClassification: node.topicClassification ? {
            ...node.topicClassification,
            stageHtml: sanitizeMarkup(
              node.topicClassification.stageHtml,
              defaultBindingForRef,
              `${course.coursewareId}/${pageMeta.pageDatabaseId}/${node.id}/topic-classification`,
            ),
            backgroundBindingKey: bindingForRef(
              node.topicClassification.backgroundResourceRefId,
              "topic_classification_background",
            ),
            assets: projectResourceMap(node.topicClassification.assets, "topic_classification"),
          } : null,
          warnings: node.warnings ?? [],
        });
      }

      let topicInteraction = null;
      if (sourcePage.topicInteraction?.status === "capture_required") {
        // 来源包的明确缺口：该页引用了 queryTopic 互动，但授权 HAR 未捕获到响应，
        // 因此没有离线包可发布。原样带出状态，让课堂/Studio 呈现「待补采」而不是假装无互动。
        topicInteraction = {
          status: "capture_required",
          topicId: sourcePage.topicInteraction.topicId,
          entryKind: sourcePage.topicInteraction.entryKind,
          bindingKey: null,
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
        const usageKey = domainHash(
          "aixuexi-topic-usage-v1", course.coursewareId,
          String(pageMeta.pageDatabaseId), sourcePage.topicInteraction.topicId, h5.packageHash,
        );
        const candidateKey = domainHash("aixuexi-topic-candidate-v1", h5.packageHash);
        usages.set(usageKey, {
          usageKey,
          coursewareId: course.coursewareId,
          pageDatabaseId: pageMeta.pageDatabaseId,
          objectHash: h5.packageHash,
          objectKind: "h5_package",
          candidateKey,
          role: "topic_interaction",
          kind: "h5",
          launchQuery: {},
          coursewareIdParam: null,
        });
        candidates.set(candidateKey, {
          candidateKey,
          objectHash: h5.packageHash,
          kind: "h5",
          role: "topic_interaction",
        });
        topicInteraction = {
          status: "offline",
          topicId: sourcePage.topicInteraction.topicId,
          entryKind: sourcePage.topicInteraction.entryKind,
          bindingKey: usageKey,
        };
      }

      const sourceItv = sourcePage.itvInteraction;
      if (sourceItv && sourceItv.projectionVersion !== SOURCE_ITV_PROJECTION_VERSION) {
        fail(`${course.coursewareId}/${pageMeta.pageDatabaseId} carries ITV projection v${sourceItv.projectionVersion}`);
      }
      const itvInteraction = sourceItv ? {
        schemaVersion: 1,
        projectionVersion: SOURCE_ITV_PROJECTION_VERSION,
        status: "offline",
        name: sourceItv.name,
        version: sourceItv.version,
        durationSeconds: sourceItv.durationSeconds,
        videoBindingKey: bindingForRef(sourceItv.videoResourceRefId, "itv_video"),
        posterBindingKey: bindingForRef(sourceItv.posterResourceRefId, "itv_poster"),
        lastFrameBindingKey: bindingForRef(sourceItv.lastFrameResourceRefId, "itv_last_frame"),
        eventCount: sourceItv.eventCount,
        events: sourceItv.events.map((event) => ({
          eventIndex: event.eventIndex,
          positionSeconds: event.positionSeconds,
          pause: event.pause,
          screenMode: event.screenMode,
          interactTimeSeconds: event.interactTimeSeconds,
          topicCode: event.topicCode,
          gameId: event.gameId,
          gameType: event.gameType,
          title: event.title,
          judgeType: event.judgeType,
          stage: {
            width: event.stage.width,
            height: event.stage.height,
            safeAreaOffsets: event.stage.safeAreaOffsets,
            widgets: event.stage.widgets.map((widget) => ({
              id: widget.id,
              type: widget.type,
              name: widget.name,
              x: widget.x,
              y: widget.y,
              width: widget.width,
              height: widget.height,
              zIndex: widget.zIndex,
              rotation: widget.rotation,
              opacity: widget.opacity,
              groupId: widget.groupId,
              html: typeof widget.html === "string"
                ? sanitizeMarkup(widget.html, defaultBindingForRef, `${course.coursewareId}/ITV/${event.eventIndex}/${widget.id}`)
                : null,
              resourceBindingKey: bindingForRef(widget.resourceRefId, "itv_widget"),
              stateBindingKeys: {
                selected: bindingForRef(widget.stateResourceRefIds?.selected, "itv_choice_selected"),
                right: bindingForRef(widget.stateResourceRefIds?.right, "itv_choice_right"),
                wrong: bindingForRef(widget.stateResourceRefIds?.wrong, "itv_choice_wrong"),
              },
              known: widget.known,
              warnings: widget.warnings ?? [],
            })),
            groups: event.stage.groups,
          },
          previewBindingKey: bindingForRef(event.previewResourceRefId, "itv_preview"),
          pauseFrameBindingKey: bindingForRef(event.pauseFrameResourceRefId, "itv_pause_frame"),
          warnings: event.warnings ?? [],
        })),
        warnings: sourceItv.warnings ?? [],
      } : null;

      const canvas = sourcePage.layout.canvas;
      const presentation = sourcePage.layout.presentation;
      const doc = {
        docVersion: "aixuexi-page-doc-v1",
        adapter: "aixuexi-page-v1",
        projectionVersion: SOURCE_PROJECTION_VERSION,
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
        canvas: {
          width: canvas.width,
          height: canvas.height,
          widgetOffsetX: canvas.widgetOffsetX,
          slideClass: canvas.slideClass ?? "",
          backgroundBindingKey: bindingForRef(canvas.backgroundResourceRefId, "background"),
        },
        playerStage: sourcePage.layout.playerStage,
        presentation: {
          width: presentation.width,
          height: presentation.height,
          contentScale: presentation.contentScale,
          offsetX: presentation.offsetX,
          offsetY: presentation.offsetY,
        },
        sourceRuntime: {
          runtimeBindingKey,
          slideStylesheetPath: "slide-runtime.css",
          itvStylesheetPath: "itv-runtime.css",
          lottieRuntimePath: lottieRuntimeResource ? "lottie.min.js" : null,
          lottieRuntimeSha256: lottieRuntimeResource?.objectSha256 ?? null,
          questionImageSizing: sourcePage.layout.sourceRuntime?.questionImageSizing ?? null,
          questionImageSizingInput: sourcePage.layout.sourceRuntime?.questionImageSizingInput ?? { imgs: {} },
        },
        behaviors: projectBehaviors(sourcePage.layout.behaviors, `${course.coursewareId}/${pageMeta.pageDatabaseId}`),
        sourceKind: sourcePage.layout.sourceKind,
        nodes,
        topicInteraction,
        itvInteraction,
        behavior: {
          advanceOnCanvasClick: Boolean(nextPage && nextPage.name === pageMeta.name),
        },
        warnings: sourcePage.layout.warnings ?? [],
      };
      const compatibilityReasons = [];
      if (canvas.width !== 1200 || canvas.height !== 900) compatibilityReasons.push("wide_canvas");
      if (nodes.some((node) => node.animations.length > 0)) compatibilityReasons.push("source_animation");
      if (nodes.some((node) => node.kind === "embedded_h5")) compatibilityReasons.push("embedded_h5");
      if (nodes.some((node) => ["true_or_false_game", "topic_classification_game"].includes(node.kind))) {
        compatibilityReasons.push("native_game");
      }
      doc.fourByThree = {
        mode: compatibilityReasons.length > 0 ? "source-player-compat" : "source-master",
        reasons: compatibilityReasons,
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
    exportId: `aixuexi-${options.packageKey}-projection-v31`,
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
