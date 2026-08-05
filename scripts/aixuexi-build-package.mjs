import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sanitizeHtml from "sanitize-html";
import { textFileSha256 } from "./lib/text-hash.mjs";

const PACKAGE_KEY = "2026-gplus-sujiao-math";
const HASH = /^[0-9a-f]{64}$/;
const GRADE = new Map([["三年级", 3], ["四年级", 4], ["五年级", 5], ["六年级", 6]]);
const PRODUCT_CODE = new Map([
  [3, "AXX26G-SJ-03-AUT"],
  [4, "AXX26G-SJ-04-AUT"],
  [5, "AXX26G-SJ-05-AUT"],
  [6, "AXX26G-SJ-06-AUT"],
]);
const TEXT_EXTENSIONS = new Set([".css", ".html", ".htm", ".js", ".json", ".mjs", ".svg", ".txt"]);

/**
 * 爱学习内容母版是 1200×900（正好 4:3），坐标 1:1，不做任何纵向压缩。
 * 源播放器自己把它 contain 进 1200×675 的 16:9 画框（0.75 缩放 + 左右各 150 留白），
 * 这条规则由 layout.presentation 携带，供 16:9 轨还原源站所见。
 */
const SOURCE_PROJECTION_VERSION = 11;
const SOURCE_ITV_PROJECTION_VERSION = 4;
const SOURCE_CANVAS_WIDTH = 1200;
const SOURCE_CANVAS_HEIGHT = 900;
const PRESENTATION_WIDTH = 1200;
const PRESENTATION_HEIGHT = 675;
const PRESENTATION_CONTENT_SCALE = 0.75;
const PRESENTATION_OFFSET_X = 150;

function fail(message) {
  throw new Error(`AIXUEXI_BUILD: ${message}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
    "div", "p", "span", "br", "img", "b", "i", "em", "strong", "sub", "sup", "hr", "u",
    "figure", "svg", "path", "g", "defs", "marker", "line", "polyline", "polygon", "circle",
    "ellipse", "rect", "text", "tspan", "clipPath", "foreignObject", "table", "tbody", "thead",
    "tr", "td", "th", "ol", "ul", "li", "math", "mrow", "mi", "mn", "mo", "mfrac", "msup", "msub",
  ],
  allowedAttributes: {
    "*": [
      "style", "class", "id", "src", "alt", "width", "height", "viewBox", "xmlns",
      "fill", "fill-opacity", "fill-rule", "clip-rule", "stroke", "stroke-width",
      "stroke-dasharray", "stroke-linejoin", "stroke-linecap", "stroke-opacity",
      "stroke-miterlimit", "vector-effect", "pointer-events", "transform", "d",
      "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "points",
      "marker-end", "marker-start", "markerUnits", "refX", "refY", "orient",
      "markerWidth", "markerHeight", "preserveAspectRatio", "text-anchor",
      "dominant-baseline", "font-family", "font-size", "clip-path", "overflow",
      "colspan", "rowspan", "role", "data-shadow-text", "data-shadow-path",
      "data-role", "data-kit", "data-tk-img-key", "data-placeholder-type",
      "data-size-scale", "data-child-index", "version", "baseProfile",
    ],
  },
  allowedSchemes: ["asset", "data"],
  allowProtocolRelative: false,
  parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
};

function sanitizeMarkup(raw, bindingForResource, label) {
  const localized = String(raw ?? "").replace(/asset:\/\/resource\/(\d+)/g, (_all, rawId) => {
    const key = bindingForResource(Number(rawId));
    if (!key) fail(`${label} references missing resource ${rawId}`);
    return `asset://binding/${key}`;
  });
  if (/(?:expression\s*\(|javascript:|-moz-binding|@import)/i.test(localized)) {
    fail(`${label} contains unsafe CSS/script syntax`);
  }
  const sanitized = sanitizeHtml(localized, MARKUP_OPTIONS);
  if (/asset:\/\/resource\//.test(sanitized)) fail(`${label} retains a local resource id`);
  if (/(?:src|href)\s*=\s*["']https?:\/\/|url\(\s*["']?https?:\/\//i.test(sanitized)) {
    fail(`${label} retains an external URL`);
  }
  return sanitized;
}

function parseArgs(argv) {
  const options = {
    packageKey: PACKAGE_KEY,
    stageH5: true,
    sourceRoot: path.resolve(process.cwd(), "..", "2026-07_mofaxiao_courseware"),
    outputRoot: path.resolve(process.cwd(), ".tmp", "aixuexi-import", PACKAGE_KEY),
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
  options.outputRoot = path.resolve(options.outputRoot);
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

function assertSourceScope(siteManifest, catalog) {
  if (siteManifest.sourceSystem !== "aixuexi_bsk") fail("unexpected source system");
  if (siteManifest.courseCount !== 52 || siteManifest.pageCount !== 1525) {
    fail(`unexpected source counts: ${siteManifest.courseCount} lectures / ${siteManifest.pageCount} pages`);
  }
  if (catalog.courseCount !== 52 || catalog.courses?.length !== 52) fail("catalog must contain 52 lectures");
  for (const course of catalog.courses) {
    // catalog.status 复制自目录快照的年级覆盖状态（partial = 该次采集未覆盖全部年级），
    // 不描述讲次本身。讲次准入门槛压在每讲 offline-verification 的 complete + 三项零计数上。
    if (!GRADE.has(course.grade) || course.term !== "秋季" || course.level !== "能力强化 G+"
        || !["complete", "partial"].includes(course.status)) {
      fail(`lecture ${course.coursewareId} is outside the approved 3-6 / Autumn / G+ scope`);
    }
    if ([7, 15].includes(course.lessonIndex)) fail("missing lesson slots must not be fabricated");
  }
}

function assertSourceCanvas(layout, label) {
  const { canvas, presentation } = layout;
  if (canvas?.width !== SOURCE_CANVAS_WIDTH || canvas?.height !== SOURCE_CANVAS_HEIGHT
      || canvas?.sourceWidth !== SOURCE_CANVAS_WIDTH || canvas?.sourceHeight !== SOURCE_CANVAS_HEIGHT
      || canvas?.coordinateScaleX !== 1 || canvas?.coordinateScaleY !== 1) {
    fail(`${label} does not use the unscaled ${SOURCE_CANVAS_WIDTH}x${SOURCE_CANVAS_HEIGHT} master canvas`);
  }
  if (presentation?.width !== PRESENTATION_WIDTH || presentation?.height !== PRESENTATION_HEIGHT
      || presentation?.contentScale !== PRESENTATION_CONTENT_SCALE
      || presentation?.offsetX !== PRESENTATION_OFFSET_X
      || !Number.isFinite(presentation?.offsetY)) {
    fail(`${label} carries an unexpected source presentation rule`);
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
    shapeTextFit: behaviors.shapeTextFit
      ? { minFontSize: behaviors.shapeTextFit.minFontSize }
      : null,
  };
}

export async function buildAixuexiPackage(options) {
  const sourceRoot = path.resolve(options.sourceRoot);
  const outputRoot = path.resolve(options.outputRoot);
  const sourcePackageRoot = path.join(sourceRoot, "exports", "packages", options.packageKey);
  const siteRoot = path.join(sourcePackageRoot, "site");
  const [siteManifest, catalog] = await Promise.all([
    readJson(path.join(siteRoot, "manifest.json")),
    readJson(path.join(siteRoot, "catalog.json")),
  ]);
  assertSourceScope(siteManifest, catalog);

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

  const addUsage = ({ coursewareId, pageDatabaseId, resource, role }) => {
    if (!resource || !HASH.test(resource.objectSha256 ?? "")) {
      fail(`${coursewareId}/${pageDatabaseId} has an unresolved ${role} resource`);
    }
    if (!["image", "video", "audio", "svg"].includes(resource.kind)) {
      fail(`${coursewareId}/${pageDatabaseId} uses unsupported ${resource.kind} resource ${resource.resourceRefId}`);
    }
    const usageKey = domainHash(
      "aixuexi-usage-v1", coursewareId, String(pageDatabaseId),
      String(resource.resourceRefId), role, resource.objectSha256,
    );
    const candidateKey = domainHash("aixuexi-candidate-v1", resource.kind, role, resource.objectSha256);
    usages.set(usageKey, {
      usageKey, coursewareId, pageDatabaseId, objectHash: resource.objectSha256,
      objectKind: "cas", candidateKey, role, kind: resource.kind,
    });
    candidates.set(candidateKey, {
      candidateKey, objectHash: resource.objectSha256, kind: resource.kind, role,
    });
    objects.set(resource.objectSha256, {
      objectHash: resource.objectSha256,
      mime: resource.mime,
      byteCount: resource.byteCount,
      storeRelativePath: `store/${resource.objectRelativePath}`,
      storeScope: "source",
      kind: resource.kind,
    });
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
      mathinProductCode: PRODUCT_CODE.get(grade),
      lessonIndex: catalogCourse.lessonIndex,
      lessonName: catalogCourse.lessonName,
      pageCount: catalogCourse.pageCount,
      documentAdapter: "aixuexi-page-v1",
      sourceSystem: "aixuexi_bsk",
      sourcePackageKey: options.packageKey,
      sourcePackageManifestSha256: packageManifestSha256,
      sourcePackageLabels: { year: 2026, level: "G+", edition: "苏教版", subject: "数学", term: "秋季" },
      sourcePackageScope: { grades: [3, 4, 5, 6], term: "秋季", level: "G+", missingLessonNumbers: [7, 15] },
      sourcePackageCounts: { lectureCount: 52, pageCount: 1525 },
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

      const nodes = sourcePage.layout.nodes.map((node) => {
        const roleFor = (resourceRefId) => {
          if (node.kind === "background") return "background";
          if (node.kind === "itv_video") return "itv_video";
          return resources.get(resourceRefId)?.role || "source";
        };
        const resourceBindingKeys = [...new Set((node.resourceRefIds ?? []).map((id) => bindingForRef(id, roleFor(id))))];
        const resourceBindingKey = node.resourceRefId === undefined
          ? null
          : bindingForRef(node.resourceRefId, roleFor(node.resourceRefId));
        return {
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
          known: node.known,
          html: typeof node.html === "string"
            ? sanitizeMarkup(node.html, defaultBindingForRef, `${course.coursewareId}/${pageMeta.pageDatabaseId}/${node.id}`)
            : null,
          resourceBindingKey,
          resourceBindingKeys,
          warnings: node.warnings ?? [],
        };
      });

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
          width: SOURCE_CANVAS_WIDTH,
          height: SOURCE_CANVAS_HEIGHT,
          widgetOffsetX: canvas.widgetOffsetX,
          backgroundBindingKey: bindingForRef(canvas.backgroundResourceRefId, "background"),
        },
        presentation: {
          width: PRESENTATION_WIDTH,
          height: PRESENTATION_HEIGHT,
          contentScale: PRESENTATION_CONTENT_SCALE,
          offsetX: PRESENTATION_OFFSET_X,
          offsetY: presentation.offsetY,
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
    exportId: `aixuexi-${options.packageKey}-projection-v5`,
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
