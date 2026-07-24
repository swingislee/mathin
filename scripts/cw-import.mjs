import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import sanitizeHtml from "sanitize-html";

const PACKAGE_SCHEMA_VERSION = "mathin-package-export-v1";
const PAGE_DOC_VERSION = "page-doc-v1";
const HASH = /^[0-9a-f]{64}$/;
const ASSET_KINDS = new Set(["image", "video", "audio", "svg", "h5"]);
const DEFAULT_SSH_HOST = "xiaomi";
const RESUMABLE_UPLOAD_BYTES = 6 * 1024 * 1024;
const storageDirectoryCache = new Map();

// 白名单按 exportId 2490b13a 全量包的标签/属性清单对齐（镜像端已做保留呈现属性的
// 黑名单消毒，doc 带 sanitized: true）。这里只做无损门禁：消毒结果与原文不一致即失败，
// 文档永远原样入库——绝不静默改写已过导出侧 audit 的内容。
const COURSEWARE_MARKUP_OPTIONS = {
  allowedTags: [
    "div", "span", "br", "img", "sup", "sub", "ul", "ol", "li",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "col", "colgroup",
    "svg", "g", "defs", "path", "text", "tspan", "title", "use", "foreignObject",
    "rect", "circle", "ellipse", "line", "polyline", "polygon", "marker",
    "linearGradient", "radialGradient", "stop", "clipPath", "pattern", "mask",
    "tal-readonly",
  ],
  allowedAttributes: {
    "*": [
      "class", "style", "id", "role", "aria-*", "data-*", "contenteditable", "spellcheck",
      "xmlns", "xmlns:xlink", "viewBox", "width", "height", "x", "y", "d", "fill", "stroke",
      "stroke-width", "transform", "focusable", "alt", "src", "xlink:href", "title",
      "font-family", "font-size", "font-weight", "font-style", "text-anchor", "text-rendering",
      "text-decoration", "dominant-baseline", "letter-spacing", "dx", "dy",
      "opacity", "fill-opacity", "fill-rule", "stroke-opacity", "stroke-dasharray",
      "stroke-linecap", "stroke-linejoin", "clip-path", "clip-rule", "display", "version",
      "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "points",
      "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform",
      "preserveAspectRatio", "refX", "refY", "orient", "markerWidth", "markerHeight",
      "marker-start", "marker-mid", "marker-end",
      "border", "cellpadding", "cellspacing", "align", "valign", "colspan", "rowspan",
      "span", "nowrap", "size", "draggable",
      "data", "text-id", "edit-key", "originsrc", "original-src", "ori-data",
      "original-width", "original-height", "res_perstans_id",
    ],
  },
  allowedSchemes: ["http", "https", "data", "asset"],
  allowedSchemesByTag: { img: ["http", "https", "data", "asset" ], use: ["asset"] },
  allowProtocolRelative: false,
  parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
};

function fail(message) {
  throw new Error(`CW_IMPORT: ${message}`);
}

function assertHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) fail(`${label} must be a lowercase SHA-256 hash`);
  return value;
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function parseJsonLine(line, file, lineNo) {
  try {
    return JSON.parse(line);
  } catch {
    fail(`${file}:${lineNo} is not valid JSON`);
  }
}

async function readNdjson(root, relativePath) {
  const text = await readFile(resolveInside(root, relativePath), "utf8");
  if (!text.trim()) return [];
  return text.trim().split(/\r?\n/).map((line, index) => parseJsonLine(line, relativePath, index + 1));
}

export function resolveInside(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) fail("empty relative path");
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.split("/").some((segment) => segment === ".." || segment.length === 0)) {
    fail(`unsafe relative path: ${relativePath}`);
  }
  const base = path.resolve(root);
  const resolved = path.resolve(base, ...normalized.split("/"));
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) fail(`path escapes root: ${relativePath}`);
  return resolved;
}

async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

async function assertFileHash(root, manifestFiles, relativePath) {
  const expected = manifestFiles.get(relativePath);
  if (!expected) fail(`manifest does not list ${relativePath}`);
  const file = resolveInside(root, relativePath);
  const actual = await sha256File(file);
  if (actual !== expected.sha256) fail(`manifest hash mismatch for ${relativePath}`);
}

function validateLaunchQuery(value, label) {
  const launch = assertObject(value, label);
  const query = assertObject(launch.query, `${label}.query`);
  if (!(typeof launch.coursewareIdParam === "string" || launch.coursewareIdParam === null)) {
    fail(`${label}.coursewareIdParam must be string|null`);
  }
  for (const [key, values] of Object.entries(query)) {
    assertString(key, `${label}.query key`);
    if (!Array.isArray(values) || values.some((item) => typeof item !== "string")) {
      fail(`${label}.query.${key} must be a string array`);
    }
  }
  return launch;
}

const MARKUP_TAG_PATTERN = /<([a-zA-Z][a-zA-Z0-9:-]*)/g;
// 只统计带非空值的属性：sanitize-html 会丢弃空值属性（class=""）、重排 style 串，
// 这两类归一化不构成内容损失，不应触发门禁。
const MARKUP_NON_EMPTY_ATTR_PATTERN = /\s([a-zA-Z][a-zA-Z0-9:_-]*)=("|')(?!\2)/g;

// 门禁两侧都先过一遍「放行一切」的恒等消毒：属性值里的未转义 <（如 data-latex="10<y<20"）
// 与实体转义差异在两侧同时归一，剩下的差异只可能来自真实白名单丢弃。
const MARKUP_IDENTITY_OPTIONS = {
  allowedTags: false,
  allowedAttributes: false,
  allowVulnerableTags: true,
  allowedSchemesAppliedToAttributes: [],
  allowProtocolRelative: true,
  parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
};

function markupInventory(markup) {
  const counts = new Map();
  for (const match of markup.matchAll(MARKUP_TAG_PATTERN)) {
    const token = `<${match[1]}>`;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  for (const match of markup.matchAll(MARKUP_NON_EMPTY_ATTR_PATTERN)) {
    const token = `[${match[1]}]`;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function assertMarkupLossless(markup, label) {
  const before = markupInventory(sanitizeHtml(markup, MARKUP_IDENTITY_OPTIONS));
  const after = markupInventory(sanitizeHtml(markup, COURSEWARE_MARKUP_OPTIONS));
  const lost = [];
  for (const [token, count] of before) {
    if ((after.get(token) ?? 0) < count) lost.push(token);
  }
  if (lost.length > 0) {
    fail(`${label} sanitize would drop ${lost.join(", ")} — documents are stored verbatim; extend the allowlist deliberately or reject the source`);
  }
}

export function assertPageDocMarkupSafe(doc, label) {
  const walk = (nodes) => {
    if (!Array.isArray(nodes)) fail("page doc nodes must be an array");
    for (const node of nodes) {
      assertObject(node, "page doc node");
      if (node.content && typeof node.content === "object") {
        if (typeof node.content.html === "string") assertMarkupLossless(node.content.html, `${label} html`);
        if (typeof node.content.svg === "string") assertMarkupLossless(node.content.svg, `${label} svg`);
      }
      walk(node.children);
    }
  };
  walk(doc.nodes);
}

function validatePageDoc(doc, label) {
  const value = assertObject(doc, label);
  if (value.docVersion !== PAGE_DOC_VERSION) fail(`${label}.docVersion must be ${PAGE_DOC_VERSION}`);
  assertString(value.sourceCoursewareId, `${label}.sourceCoursewareId`);
  if (!(typeof value.sourcePageId === "string" || value.sourcePageId === null)) fail(`${label}.sourcePageId must be string|null`);
  if (!Number.isInteger(value.sourcePageDatabaseId) || value.sourcePageDatabaseId <= 0) fail(`${label}.sourcePageDatabaseId must be positive integer`);
  if (!Number.isInteger(value.sourceSnapshotId) || value.sourceSnapshotId <= 0) fail(`${label}.sourceSnapshotId must be positive integer`);
  assertHash(value.sourceContentHash, `${label}.sourceContentHash`);
  const canvas = assertObject(value.canvas, `${label}.canvas`);
  if (!Number.isFinite(canvas.width) || canvas.width <= 0 || !Number.isFinite(canvas.height) || canvas.height <= 0) {
    fail(`${label}.canvas dimensions must be positive finite numbers`);
  }
  if (!(canvas.backgroundBindingKey === null || HASH.test(canvas.backgroundBindingKey))) fail(`${label}.canvas.backgroundBindingKey invalid`);
  if (!Array.isArray(value.interactions)) fail(`${label}.interactions must be an array`);
  for (const interaction of value.interactions) {
    assertObject(interaction, `${label}.interaction`);
    if (!(interaction.audioBindingKey === null || HASH.test(interaction.audioBindingKey))) fail(`${label}.interaction.audioBindingKey invalid`);
  }
  const bindingKeys = new Set();
  if (canvas.backgroundBindingKey) bindingKeys.add(canvas.backgroundBindingKey);
  const walk = (nodes) => {
    if (!Array.isArray(nodes)) fail(`${label}.nodes must be an array`);
    for (const node of nodes) {
      assertObject(node, `${label}.node`);
      if (!Array.isArray(node.resources) || !Array.isArray(node.children)) fail(`${label}.node resource/children array missing`);
      for (const resource of node.resources) {
        assertObject(resource, `${label}.resource`);
        assertHash(resource.bindingKey, `${label}.resource.bindingKey`);
        assertString(resource.bindingPath, `${label}.resource.bindingPath`);
        assertString(resource.role, `${label}.resource.role`);
        if (!ASSET_KINDS.has(resource.kind)) fail(`${label}.resource.kind invalid`);
        bindingKeys.add(resource.bindingKey);
      }
      walk(node.children);
    }
  };
  walk(value.nodes);
  for (const interaction of value.interactions) if (interaction.audioBindingKey) bindingKeys.add(interaction.audioBindingKey);
  return bindingKeys;
}

function normalizeLecture(row) {
  const lecture = assertObject(row, "lecture row");
  return {
    coursewareId: assertString(lecture.coursewareId, "lecture.coursewareId"),
    mathinProductCode: assertString(lecture.mathinProductCode, "lecture.mathinProductCode"),
    lessonIndex: lecture.lessonIndex,
    lessonName: typeof lecture.lessonName === "string" ? lecture.lessonName : "",
    pageCount: lecture.pageCount,
  };
}

function sqlText(value) {
  return `convert_from(decode('${Buffer.from(String(value), "utf8").toString("base64")}', 'base64'), 'utf8')`;
}

function sqlJson(value) {
  return `${sqlText(JSON.stringify(value))}::jsonb`;
}

function values(rows, map) {
  if (rows.length === 0) fail("cannot generate an empty VALUES block");
  return rows.map((row) => `(${map(row).join(", ")})`).join(",\n");
}

function storagePathForObject(object) {
  return object.kind === "h5" ? `packages/${object.objectHash}` : `sha256/${object.objectHash.slice(0, 2)}/${object.objectHash}`;
}

/**
 * Storage API rejects some raw Unicode object keys. Keep the H5 package's
 * logical filenames untouched (the HTML relies on them), but store each path
 * segment under its deterministic percent-encoded key. The H5 shim applies
 * the same mapping when resolving browser requests back to Storage.
 */
function h5StorageSegment(segment) {
  return /[^\x20-\x7E]/.test(segment) ? `u_${encodeURIComponent(segment).replaceAll("%", "_")}` : segment;
}

export function h5StoragePath(packageHash, packagePath) {
  return `packages/${packageHash}/${packagePath.split("/").map(h5StorageSegment).join("/")}`;
}

export async function loadImportPlan({ packageRoot, coursewareId }) {
  const manifest = JSON.parse(await readFile(resolveInside(packageRoot, "manifest.json"), "utf8"));
  if (manifest?.schemaVersion !== PACKAGE_SCHEMA_VERSION) fail(`unsupported package schema ${manifest?.schemaVersion ?? "<missing>"}`);
  assertString(manifest.exportId, "manifest.exportId");
  if (!Array.isArray(manifest.files)) fail("manifest.files must be an array");
  const manifestFiles = new Map();
  for (const entry of manifest.files) {
    assertObject(entry, "manifest file");
    const relativePath = assertString(entry.path, "manifest file path");
    manifestFiles.set(relativePath, { sha256: assertHash(entry.sha256, `manifest ${relativePath} hash`) });
  }

  const coreFiles = ["lectures.ndjson", "asset-objects.ndjson", "candidates.ndjson", "usages.ndjson", `page-docs/${coursewareId}.ndjson`];
  for (const file of coreFiles) await assertFileHash(packageRoot, manifestFiles, file);

  const lectureRows = await readNdjson(packageRoot, "lectures.ndjson");
  const lecture = lectureRows.map(normalizeLecture).find((item) => item.coursewareId === coursewareId);
  if (!lecture) fail(`courseware ${coursewareId} is absent from lectures.ndjson`);
  if (!Number.isInteger(lecture.lessonIndex) || lecture.lessonIndex <= 0) fail("lecture.lessonIndex must be a positive integer");

  const pageRows = await readNdjson(packageRoot, `page-docs/${coursewareId}.ndjson`);
  if (pageRows.length !== lecture.pageCount) fail(`page count mismatch: lecture=${lecture.pageCount}, rows=${pageRows.length}`);
  const usageRows = (await readNdjson(packageRoot, "usages.ndjson")).filter((row) => row.coursewareId === coursewareId);
  const adaptByPage = new Map();
  if (manifestFiles.has("adaptations.ndjson")) {
    await assertFileHash(packageRoot, manifestFiles, "adaptations.ndjson");
    for (const row of (await readNdjson(packageRoot, "adaptations.ndjson")).filter((item) => item.coursewareId === coursewareId)) {
      if (!Number.isInteger(row.pageDatabaseId) || !["A", "B", "C", "D", "E", "F"].includes(row.adaptClass) || typeof row.reason !== "string") {
        fail("invalid 4:3 adaptation classification");
      }
      adaptByPage.set(row.pageDatabaseId, { adaptClass: row.adaptClass, adaptReason: row.reason, adaptReport: row });
    }
  }
  if (usageRows.length === 0) fail("sample lecture has no usages");
  const usageByKey = new Map();
  const usagesByPage = new Map();
  for (const row of usageRows) {
    const usage = assertObject(row, "usage row");
    const usageKey = assertHash(usage.usageKey, "usage.usageKey");
    if (usageByKey.has(usageKey)) fail(`duplicate usage key ${usageKey}`);
    assertHash(usage.objectHash, "usage.objectHash");
    assertHash(usage.candidateKey, "usage.candidateKey");
    if (!ASSET_KINDS.has(usage.kind)) fail(`usage kind invalid: ${usage.kind}`);
    if (!(usage.objectKind === "cas" || usage.objectKind === "h5_package")) fail(`usage objectKind invalid: ${usage.objectKind}`);
    if (!Number.isInteger(usage.pageDatabaseId) || usage.pageDatabaseId <= 0) fail("usage.pageDatabaseId invalid");
    if (usage.objectKind === "h5_package") {
      if (usage.kind !== "h5") fail("h5 package usage must have kind=h5");
      validateLaunchQuery({ query: usage.launchQuery ?? {}, coursewareIdParam: usage.coursewareIdParam ?? null }, "usage launch query");
    }
    usageByKey.set(usageKey, usage);
    const list = usagesByPage.get(usage.pageDatabaseId) ?? [];
    list.push(usage);
    usagesByPage.set(usage.pageDatabaseId, list);
  }

  const candidateRows = await readNdjson(packageRoot, "candidates.ndjson");
  const candidateByKey = new Map();
  for (const row of candidateRows) {
    const candidate = assertObject(row, "candidate row");
    const key = assertHash(candidate.candidateKey, "candidate.candidateKey");
    candidateByKey.set(key, candidate);
  }

  const h5Hashes = [...new Set(usageRows.filter((row) => row.objectKind === "h5_package").map((row) => row.objectHash))];
  const h5Manifests = new Map();
  for (const hash of h5Hashes) {
    const relativePath = `h5-manifests/${hash}.json`;
    await assertFileHash(packageRoot, manifestFiles, relativePath);
    const h5 = JSON.parse(await readFile(resolveInside(packageRoot, relativePath), "utf8"));
    if (h5?.schemaVersion !== "mathin-h5-manifest-v1" || h5.packageHash !== hash || !Array.isArray(h5.files)) {
      fail(`invalid H5 manifest for ${hash}`);
    }
    assertString(h5.entryPath, `H5 ${hash} entryPath`);
    if (!Number.isInteger(h5.byteCount) || h5.byteCount < 0) fail(`H5 ${hash} byteCount invalid`);
    for (const file of h5.files) {
      assertObject(file, `H5 ${hash} file`);
      assertString(file.packagePath, `H5 ${hash} packagePath`);
      assertHash(file.sha256, `H5 ${hash} file hash`);
      if (!Number.isInteger(file.byteCount) || file.byteCount < 0) fail(`H5 ${hash} file byteCount invalid`);
      assertString(file.mime, `H5 ${hash} file mime`);
      resolveInside("/cw-import-path-check", file.packagePath);
    }
    h5Manifests.set(hash, h5);
  }

  const usedObjectHashes = new Set(usageRows.filter((row) => row.objectKind === "cas").map((row) => row.objectHash));
  const objectRows = await readNdjson(packageRoot, "asset-objects.ndjson");
  const objects = new Map();
  for (const row of objectRows) {
    const object = assertObject(row, "asset object row");
    const hash = assertHash(object.objectHash, "asset object hash");
    if (!usedObjectHashes.has(hash)) continue;
    if (!ASSET_KINDS.has(object.kind) || object.kind === "h5") fail(`invalid CAS object kind for ${hash}`);
    assertString(object.mime, `asset ${hash} mime`);
    assertString(object.storeRelativePath, `asset ${hash} store path`);
    if (!Number.isInteger(object.byteCount) || object.byteCount < 0) fail(`asset ${hash} byteCount invalid`);
    resolveInside("/cw-import-path-check", object.storeRelativePath);
    objects.set(hash, { ...object, storagePath: storagePathForObject(object) });
  }
  if (objects.size !== usedObjectHashes.size) fail("asset-objects.ndjson is missing a used CAS object");
  for (const [hash, h5] of h5Manifests) {
    objects.set(hash, {
      objectHash: hash,
      mime: "application/x-mathin-h5-package",
      byteCount: h5.byteCount,
      kind: "h5",
      storeRelativePath: null,
      storagePath: storagePathForObject({ objectHash: hash, kind: "h5" }),
    });
  }

  const assets = new Map();
  for (const usage of usageRows) {
    const candidate = candidateByKey.get(usage.candidateKey);
    if (!candidate) fail(`usage ${usage.usageKey} references missing candidate ${usage.candidateKey}`);
    if (candidate.objectHash !== usage.objectHash || candidate.kind !== usage.kind || candidate.role !== usage.role) {
      fail(`candidate contract mismatch for usage ${usage.usageKey}`);
    }
    assets.set(usage.candidateKey, {
      candidateKey: usage.candidateKey,
      objectHash: usage.objectHash,
      kind: usage.kind,
      role: usage.role,
    });
  }

  const pages = [];
  const pageIds = new Set();
  for (const row of pageRows) {
    const page = assertObject(row, "page row");
    if (page.coursewareId !== coursewareId) fail("page row courseware mismatch");
    if (!Number.isInteger(page.pageIndex) || page.pageIndex <= 0 || pageIds.has(page.pageIndex)) fail("pageIndex must be unique positive integer");
    pageIds.add(page.pageIndex);
    if (!Number.isInteger(page.pageDatabaseId) || page.pageDatabaseId <= 0) fail("pageDatabaseId invalid");
    const doc = page.doc;
    assertPageDocMarkupSafe(assertObject(doc, `page ${page.pageIndex} doc`), `page ${page.pageIndex}`);
    const docBindingKeys = validatePageDoc(doc, `page ${page.pageIndex} doc`);
    if (doc.sourceCoursewareId !== coursewareId || doc.sourcePageDatabaseId !== page.pageDatabaseId) fail(`page ${page.pageIndex} provenance mismatch`);
    const pageUsages = usagesByPage.get(page.pageDatabaseId) ?? [];
    const expectedKeys = new Set(pageUsages.map((usage) => usage.usageKey));
    if (page.thumbnailBindingKey !== null) {
      assertHash(page.thumbnailBindingKey, `page ${page.pageIndex} thumbnailBindingKey`);
      docBindingKeys.add(page.thumbnailBindingKey);
    }
    if (docBindingKeys.size !== expectedKeys.size || [...docBindingKeys].some((key) => !expectedKeys.has(key))) {
      fail(`page ${page.pageIndex} document/binding reconciliation failed`);
    }
    pages.push({
      pageNo: page.pageIndex,
      title: typeof page.name === "string" ? page.name : "",
      sourcePageId: doc.sourcePageId,
      sourcePageDatabaseId: page.pageDatabaseId,
      doc,
      ...(adaptByPage.get(page.pageDatabaseId) ?? { adaptClass: null, adaptReason: "", adaptReport: null }),
    });
  }
  pages.sort((left, right) => left.pageNo - right.pageNo);

  const bindings = usageRows.map((usage) => ({
    pageNo: pages.find((page) => page.sourcePageDatabaseId === usage.pageDatabaseId)?.pageNo,
    bindingKey: usage.usageKey,
    role: usage.role,
    kind: usage.kind,
    candidateKey: usage.candidateKey,
    launchQuery: usage.objectKind === "h5_package"
      ? { query: usage.launchQuery ?? {}, coursewareIdParam: usage.coursewareIdParam ?? null }
      : null,
  }));
  if (bindings.some((binding) => !binding.pageNo)) fail("usage references a page absent from page-docs");

  return {
    exportId: manifest.exportId,
    packageRoot: path.resolve(packageRoot),
    manifestFiles,
    lecture,
    pages,
    usages: usageRows,
    bindings,
    objects: [...objects.values()].sort((left, right) => left.objectHash.localeCompare(right.objectHash)),
    assets: [...assets.values()].sort((left, right) => left.candidateKey.localeCompare(right.candidateKey)),
    h5Manifests,
  };
}

export function buildImportSql(plan) {
  const objectValues = values(plan.objects, (object) => [
    sqlText(object.objectHash), sqlText(object.mime), String(object.byteCount), sqlText(object.kind), sqlText(object.storagePath),
  ]);
  const assetValues = values(plan.assets, (asset) => [
    sqlText(asset.candidateKey), sqlText(asset.kind), sqlText(asset.role), sqlText(asset.objectHash),
  ]);
  const pageValues = values(plan.pages, (page) => [
    String(page.pageNo), sqlText(page.title), sqlText(plan.lecture.coursewareId),
    page.sourcePageId === null ? "NULL" : sqlText(page.sourcePageId), sqlJson(page.doc),
    page.adaptClass === null ? "NULL" : sqlText(page.adaptClass), sqlText(page.adaptReason), page.adaptReport === null ? "NULL" : sqlJson(page.adaptReport),
  ]);
  const bindingValues = values(plan.bindings, (binding) => [
    String(binding.pageNo), sqlText(binding.bindingKey), sqlText(binding.role), sqlText(binding.kind),
    sqlText(binding.candidateKey), binding.launchQuery === null ? "NULL" : sqlJson(binding.launchQuery),
  ]);
  const importNote = `P6-3 import baseline ${plan.exportId}`;

  return `begin;
create temporary table cw_import_context (lecture_id uuid primary key) on commit drop;
insert into cw_import_context (lecture_id)
select lecture.id
  from public.course_lectures lecture
  join public.courses course on course.id = lecture.course_id
 where course.product_code = ${sqlText(plan.lecture.mathinProductCode)}
   and lecture.no = ${plan.lecture.lessonIndex}
 for update;
do $$ begin
  if (select count(*) from cw_import_context) <> 1 then
    raise exception 'CW_IMPORT_LECTURE_MAPPING_MISSING_OR_AMBIGUOUS';
  end if;
end $$;

create temporary table cw_import_objects (
  object_hash text primary key, mime text not null, byte_count bigint not null, kind text not null, storage_path text not null
) on commit drop;
insert into cw_import_objects (object_hash, mime, byte_count, kind, storage_path) values
${objectValues};
create temporary table cw_import_assets (
  candidate_key text primary key, kind text not null, role text not null, object_hash text not null
) on commit drop;
insert into cw_import_assets (candidate_key, kind, role, object_hash) values
${assetValues};
create temporary table cw_import_pages (
  page_no int primary key, title text not null, source_courseware_id text not null, source_page_id text, doc jsonb not null,
  adapt_class text, adapt_reason text not null, adapt_report jsonb
) on commit drop;
insert into cw_import_pages (page_no, title, source_courseware_id, source_page_id, doc, adapt_class, adapt_reason, adapt_report) values
${pageValues};
create temporary table cw_import_bindings (
  page_no int not null, binding_key text not null, role text not null, kind text not null, candidate_key text not null, launch_query jsonb,
  primary key (page_no, binding_key)
) on commit drop;
insert into cw_import_bindings (page_no, binding_key, role, kind, candidate_key, launch_query) values
${bindingValues};

do $$ begin
  if exists (
    select 1 from cw_import_objects input
    join public.cw_asset_objects object on object.sha256 = input.object_hash
    where object.mime <> input.mime or object.byte_count <> input.byte_count
       or object.kind <> input.kind or object.storage_path <> input.storage_path
  ) then raise exception 'CW_IMPORT_OBJECT_METADATA_MISMATCH'; end if;
  if exists (
    select 1 from cw_import_assets input
    join public.cw_shared_assets asset on asset.candidate_key = input.candidate_key
    where asset.kind <> input.kind or asset.role <> input.role
  ) then raise exception 'CW_IMPORT_SHARED_ASSET_MISMATCH'; end if;
  if exists (
    select 1 from cw_import_context context
    join public.cw_page_docs page on page.lecture_id = context.lecture_id
    join cw_import_pages input on input.page_no = page.page_no
    where page.source_courseware_id is distinct from input.source_courseware_id
       or page.source_page_id is distinct from input.source_page_id
  ) then raise exception 'CW_IMPORT_PAGE_IDENTITY_MISMATCH'; end if;
end $$;

create temporary table cw_import_inserted_objects (object_hash text primary key) on commit drop;
with inserted as (
  insert into public.cw_asset_objects (sha256, mime, byte_count, kind, storage_path)
  select object_hash, mime, byte_count, kind, storage_path from cw_import_objects
  on conflict (sha256) do nothing
  returning sha256
)
insert into cw_import_inserted_objects select sha256 from inserted;

create temporary table cw_import_inserted_assets (candidate_key text primary key) on commit drop;
with inserted as (
  insert into public.cw_shared_assets (kind, role, candidate_key)
  select kind, role, candidate_key from cw_import_assets
  on conflict (candidate_key) do nothing
  returning candidate_key
)
insert into cw_import_inserted_assets select candidate_key from inserted;

do $$ begin
  if exists (
    select 1 from cw_import_assets input
    join public.cw_shared_assets asset on asset.candidate_key = input.candidate_key
    join public.cw_asset_revisions revision on revision.shared_asset_id = asset.id and revision.revision_no = 1
    join public.cw_asset_objects object on object.id = revision.object_id
    where object.sha256 <> input.object_hash
  ) then raise exception 'CW_IMPORT_SOURCE_REVISION_MISMATCH'; end if;
end $$;
create temporary table cw_import_inserted_asset_revisions (shared_asset_id uuid primary key) on commit drop;
with inserted as (
  insert into public.cw_asset_revisions (shared_asset_id, revision_no, object_id, variant, note)
  select asset.id, 1, object.id, 'source', ${sqlText(importNote)}
    from cw_import_assets input
    join public.cw_shared_assets asset on asset.candidate_key = input.candidate_key
    join public.cw_asset_objects object on object.sha256 = input.object_hash
   where not exists (
     select 1 from public.cw_asset_revisions revision
      where revision.shared_asset_id = asset.id and revision.revision_no = 1
   )
  returning shared_asset_id
)
insert into cw_import_inserted_asset_revisions select shared_asset_id from inserted;
update public.cw_shared_assets asset
   set published_revision_id = coalesce(asset.published_revision_id, revision.id)
  from cw_import_assets input, public.cw_asset_revisions revision
 where asset.candidate_key = input.candidate_key
   and revision.shared_asset_id = asset.id
   and revision.revision_no = 1;
insert into public.cw_asset_variant_heads(shared_asset_id,track,published_revision_id)
select asset.id,'native-16x9',revision.id
from cw_import_assets input join public.cw_shared_assets asset on asset.candidate_key=input.candidate_key
join public.cw_asset_revisions revision on revision.shared_asset_id=asset.id and revision.revision_no=1
on conflict(shared_asset_id,track) do update set published_revision_id=coalesce(public.cw_asset_variant_heads.published_revision_id,excluded.published_revision_id),updated_at=now();

create temporary table cw_import_inserted_pages (page_no int primary key) on commit drop;
with inserted as (
  insert into public.cw_page_docs (lecture_id, page_no, title, source_courseware_id, source_page_id, adapt_class, adapt_reason)
  select context.lecture_id, input.page_no, input.title, input.source_courseware_id, input.source_page_id, input.adapt_class, input.adapt_reason
    from cw_import_context context
    cross join cw_import_pages input
  where not exists (
     select 1 from public.cw_page_docs page
      where page.lecture_id = context.lecture_id and page.page_no = input.page_no
   )
  returning page_no
)
insert into cw_import_inserted_pages select page_no from inserted;

-- 新导入包的分类报告只回填尚未被教研改动的页面；保护规则与 baseline doc 一致。
update public.cw_page_docs page
   set adapt_class = input.adapt_class, adapt_reason = input.adapt_reason
  from cw_import_context context
  join cw_import_pages input on true
 where page.lecture_id = context.lecture_id
   and page.page_no = input.page_no
   and not exists (
     select 1 from public.cw_page_revisions revision
      where revision.page_doc_id = page.id and revision.origin <> 'import'
   );

create temporary table cw_import_protected_pages (page_no int primary key) on commit drop;
insert into cw_import_protected_pages
select page.page_no
  from public.cw_page_docs page
  join cw_import_context context on context.lecture_id = page.lecture_id
 where exists (
   select 1 from public.cw_page_revisions revision
    where revision.page_doc_id = page.id and revision.origin <> 'import'
 );
create temporary table cw_import_baseline_drift_pages (page_no int primary key) on commit drop;
insert into cw_import_baseline_drift_pages
select page.page_no
  from public.cw_page_docs page
  join cw_import_context context on context.lecture_id = page.lecture_id
  join cw_import_pages input on input.page_no = page.page_no
  join public.cw_page_revisions revision on revision.page_doc_id = page.id and revision.revision_no = 1
 where revision.doc is distinct from input.doc;

create temporary table cw_import_inserted_page_revisions (page_no int primary key) on commit drop;
with inserted as (
  insert into public.cw_page_revisions (page_doc_id, revision_no, doc, origin, note, track)
  select page.id, 1, input.doc, 'import', ${sqlText(importNote)}, 'native-16x9'
    from cw_import_context context
    join public.cw_page_docs page on page.lecture_id = context.lecture_id
    join cw_import_pages input on input.page_no = page.page_no
   where not exists (
     select 1 from public.cw_page_revisions revision
      where revision.page_doc_id = page.id and revision.revision_no = 1
   )
  returning page_doc_id
)
insert into cw_import_inserted_page_revisions
select page.page_no from inserted join public.cw_page_docs page on page.id = inserted.page_doc_id;
update public.cw_page_docs page
   set current_revision_id = revision.id
  from cw_import_context context, public.cw_page_revisions revision
 where page.lecture_id = context.lecture_id
   and revision.page_doc_id = page.id
   and revision.revision_no = 1
   and page.current_revision_id is null
   and page.draft_revision_id is null;
insert into public.cw_page_track_heads(page_doc_id,track,current_revision_id)
select page.id,'native-16x9',revision.id
from cw_import_context context join public.cw_page_docs page on page.lecture_id=context.lecture_id
join public.cw_page_revisions revision on revision.page_doc_id=page.id and revision.revision_no=1
on conflict(page_doc_id,track) do nothing;

create temporary table cw_import_binding_conflicts (binding_key text primary key) on commit drop;
insert into cw_import_binding_conflicts
select binding.binding_key
  from cw_import_context context
  join public.cw_page_docs page on page.lecture_id = context.lecture_id
  join cw_import_bindings input on input.page_no = page.page_no
  join public.cw_page_asset_bindings binding on binding.page_doc_id = page.id and binding.binding_key = input.binding_key and binding.track='native-16x9'
  join public.cw_shared_assets asset on asset.id = binding.shared_asset_id
 where binding.role <> input.role
    or binding.kind <> input.kind
    or asset.candidate_key <> input.candidate_key
    or binding.launch_query is distinct from input.launch_query;
create temporary table cw_import_inserted_bindings (binding_key text primary key) on commit drop;
with inserted as (
  insert into public.cw_page_asset_bindings (page_doc_id, binding_key, role, kind, shared_asset_id, launch_query, track)
  select page.id, input.binding_key, input.role, input.kind, asset.id, input.launch_query, 'native-16x9'
    from cw_import_context context
    join public.cw_page_docs page on page.lecture_id = context.lecture_id
    join cw_import_bindings input on input.page_no = page.page_no
    join public.cw_shared_assets asset on asset.candidate_key = input.candidate_key
   where not exists (
     select 1 from public.cw_page_asset_bindings binding
      where binding.page_doc_id = page.id and binding.binding_key = input.binding_key and binding.track='native-16x9'
   )
  returning binding_key
)
insert into cw_import_inserted_bindings select binding_key from inserted;

create temporary table cw_import_template (value jsonb not null) on commit drop;
insert into cw_import_template (value)
select jsonb_agg(jsonb_build_object('id', page.id::text, 'type', 'doc', 'docId', page.id::text, 'title', page.title) order by page.page_no)
  from cw_import_context context
  join public.cw_page_docs page on page.lecture_id = context.lecture_id and page.deleted_at is null;
create temporary table cw_import_template_updated (updated boolean not null) on commit drop;
with updated as (
  update public.course_lectures lecture
     set courseware_template = template.value
    from cw_import_context context
    cross join cw_import_template template
   where lecture.id = context.lecture_id
     and lecture.courseware_template = '[]'::jsonb
  returning 1
)
insert into cw_import_template_updated select exists(select 1 from updated);

do $$ begin
  if not exists (select 1 from public.cw_lecture_releases release join cw_import_context context on context.lecture_id = release.lecture_id where release.track='native-16x9') then
    if exists (
      select 1 from public.cw_page_docs page join cw_import_context context on context.lecture_id = page.lecture_id
       where page.deleted_at is null and (page.current_revision_id is null or page.draft_revision_id is not null)
    ) then raise exception 'CW_IMPORT_RELEASE_PAGE_NOT_READY'; end if;
    if exists (
      select 1 from public.cw_page_asset_bindings binding
      join public.cw_page_docs page on page.id = binding.page_doc_id
      join cw_import_context context on context.lecture_id = page.lecture_id
      join public.cw_shared_assets asset on asset.id = binding.shared_asset_id
      where page.deleted_at is null and binding.track='native-16x9' and coalesce(binding.pinned_revision_id, asset.published_revision_id) is null
    ) then raise exception 'CW_IMPORT_RELEASE_UNRESOLVED_ASSET'; end if;
  end if;
end $$;
create temporary table cw_import_inserted_release (id uuid primary key) on commit drop;
with snapshot as (
  select jsonb_agg(jsonb_build_object(
    'pageDocId', page.id,
    'revisionId', page.current_revision_id,
    'bindings', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'bindingKey', binding.binding_key,
        'assetRevisionId', coalesce(binding.pinned_revision_id, asset.published_revision_id),
        'launchQuery', binding.launch_query
      )) order by binding.binding_key)
        from public.cw_page_asset_bindings binding
        join public.cw_shared_assets asset on asset.id = binding.shared_asset_id
       where binding.page_doc_id = page.id and binding.track='native-16x9'
    ), '[]'::jsonb)
  ) order by page.page_no) as value
    from public.cw_page_docs page
    join cw_import_context context on context.lecture_id = page.lecture_id
   where page.deleted_at is null
), inserted as (
  insert into public.cw_lecture_releases (lecture_id, release_no, note, snapshot, track)
  select context.lecture_id, 1, ${sqlText(importNote)}, snapshot.value, 'native-16x9'
    from cw_import_context context cross join snapshot
   where not exists (
     select 1 from public.cw_lecture_releases release where release.lecture_id = context.lecture_id and release.track='native-16x9'
   )
  returning id
)
insert into cw_import_inserted_release select id from inserted;
update public.course_lectures lecture
   set current_release_id = release.id
  from cw_import_context context
  join cw_import_inserted_release release on true
 where lecture.id = context.lecture_id;
insert into public.cw_lecture_track_heads(lecture_id,track,current_release_id)
select context.lecture_id,'native-16x9',release.id from cw_import_context context join cw_import_inserted_release release on true
on conflict(lecture_id,track) do update set current_release_id=excluded.current_release_id,updated_at=now();

select jsonb_build_object(
  'lectureId', (select lecture_id from cw_import_context),
  'objects', jsonb_build_object('expected', (select count(*) from cw_import_objects), 'inserted', (select count(*) from cw_import_inserted_objects), 'existing', (select count(*) from cw_import_objects) - (select count(*) from cw_import_inserted_objects)),
  'sharedAssets', jsonb_build_object('expected', (select count(*) from cw_import_assets), 'inserted', (select count(*) from cw_import_inserted_assets), 'existing', (select count(*) from cw_import_assets) - (select count(*) from cw_import_inserted_assets)),
  'assetRevisions', jsonb_build_object('inserted', (select count(*) from cw_import_inserted_asset_revisions)),
  'pages', jsonb_build_object('expected', (select count(*) from cw_import_pages), 'inserted', (select count(*) from cw_import_inserted_pages), 'existing', (select count(*) from cw_import_pages) - (select count(*) from cw_import_inserted_pages), 'protected', (select count(*) from cw_import_protected_pages), 'baselineDrift', (select count(*) from cw_import_baseline_drift_pages)),
  'bindings', jsonb_build_object('expected', (select count(*) from cw_import_bindings), 'inserted', (select count(*) from cw_import_inserted_bindings), 'existing', (select count(*) from cw_import_bindings) - (select count(*) from cw_import_inserted_bindings), 'conflicts', (select count(*) from cw_import_binding_conflicts)),
  'templateUpdated', (select updated from cw_import_template_updated),
  'releaseInserted', exists(select 1 from cw_import_inserted_release),
  'releaseId', (select id from cw_import_inserted_release limit 1)
)::text;
commit;`;
}

function runRemoteSql(sql, sshHost) {
  const result = spawnSync(
    "ssh",
    [sshHost, "docker exec -i supabase-db psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, shell: false },
  );

  if (result.error) fail(`cannot start SSH psql: ${result.error.message}`);
  if (result.status !== 0) fail(`remote SQL failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  return result.stdout.trim();
}

function buildPreflightSql(plan) {
  return `with matches as (
  select lecture.id, lecture.current_release_id, lecture.courseware_template
    from public.course_lectures lecture
    join public.courses course on course.id = lecture.course_id
   where course.product_code = ${sqlText(plan.lecture.mathinProductCode)}
     and lecture.no = ${plan.lecture.lessonIndex}
)
select jsonb_build_object(
  'matches', (select count(*) from matches),
  'lectureId', (select id::text from matches limit 1),
  'currentReleaseId', (select current_release_id::text from matches limit 1),
  'templatePageCount', (select jsonb_array_length(courseware_template) from matches limit 1)
)::text;`;
}

function readEnvFile(text) {
  const parsed = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    parsed[key] = value;
  }
  return parsed;
}

async function loadLocalEnv(cwd) {
  try {
    return readEnvFile(await readFile(path.join(cwd, ".env.local"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function alreadyExists(error) {
  const detail = `${error?.message ?? ""} ${error?.error ?? ""} ${error?.statusCode ?? ""}`.toLowerCase();
  return error?.statusCode === "409" || error?.statusCode === 409 || detail.includes("already exists") || detail.includes("duplicate");
}

function transientStorageFailure(error) {
  const detail = `${error?.message ?? ""} ${error?.error ?? ""} ${error?.statusCode ?? ""}`.toLowerCase();
  return error?.statusCode === "502" || error?.statusCode === 502
    || error?.statusCode === "504" || error?.statusCode === 504
    || detail.includes("timing out") || detail.includes("timeout") || detail.includes("upstream server")
    || detail.includes("fetch failed") || detail.includes("econnreset") || detail.includes("socket");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function storageObjectExists(client, bucket, remotePath) {
  const separator = remotePath.lastIndexOf("/");
  const folder = separator < 0 ? "" : remotePath.slice(0, separator);
  const name = separator < 0 ? remotePath : remotePath.slice(separator + 1);
  const cacheKey = `${bucket}/${folder}`;
  const cached = storageDirectoryCache.get(cacheKey);
  if (cached) return cached.has(name);

  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const { data, error } = await client.storage.from(bucket).list(folder, { limit: 1000 });
      if (!error) {
        const names = new Set((data ?? []).map((entry) => entry.name));
        storageDirectoryCache.set(cacheKey, names);
        return names.has(name);
      }
      lastError = error;
    } catch (error) {
      lastError = error;
    }
    if (transientStorageFailure(lastError) && attempt < 3) {
      await wait(500 * (attempt + 1));
      continue;
    }
    fail(`storage existence check failed for ${bucket}/${remotePath}: ${lastError?.message ?? "unknown error"}`);
  }
  fail(`storage existence check exhausted retries for ${bucket}/${remotePath}`);
}

/** 供同样写入 CAS 的增量管线复用：先查存在性、瞬态失败重试，大对象走 TUS。 */
export async function uploadOne(client, uploadConfig, bucket, remotePath, file, mime, cacheControl) {
  if (await storageObjectExists(client, bucket, remotePath)) return "existing";
  const info = await stat(file);
  if (info.size > RESUMABLE_UPLOAD_BYTES) {
    return uploadResumable({
      ...uploadConfig,
      bucket,
      remotePath,
      file,
      mime,
      cacheControl,
      byteCount: info.size,
    });
  }
  const body = await readFile(file);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { error } = await client.storage.from(bucket).upload(remotePath, body, {
      contentType: mime,
      cacheControl,
      upsert: false,
    });
    if (!error) return "uploaded";
    if (alreadyExists(error)) return "existing";
    if (transientStorageFailure(error) && attempt < 3) {
      await wait(500 * (attempt + 1));
      continue;
    }
    fail(`storage upload failed for ${bucket}/${remotePath}: ${error.message}`);
  }
  fail(`storage upload exhausted retries for ${bucket}/${remotePath}`);
}

function tusMetadata(values) {
  return Object.entries(values)
    .map(([key, value]) => `${key} ${Buffer.from(String(value), "utf8").toString("base64")}`)
    .join(",");
}

async function responseError(response) {
  const body = await response.text();
  return { statusCode: response.status, message: body || response.statusText };
}

function resolveResumableUploadUrl(location, endpoint) {
  const uploadUrl = new URL(location, endpoint);
  if (process.env.CW_STORAGE_RESUMABLE_REWRITE_ORIGIN === "1") {
    const endpointUrl = new URL(endpoint);
    uploadUrl.protocol = endpointUrl.protocol;
    uploadUrl.host = endpointUrl.host;
  }
  return uploadUrl.toString();
}

export async function uploadResumable({ url, key, bucket, remotePath, file, mime, cacheControl, byteCount }) {
  const endpoint = `${url.replace(/\/$/, "")}/storage/v1/upload/resumable`;
  const create = await fetch(endpoint, {
    method: "POST",
    headers: {
      // 当前自托管项目的 SUPABASE_SECRET_KEY 是 sb_secret_ 不透明 API key，而非 JWT。
      // TUS 端点会把 Authorization 当 JWT 解析，故只交给 Kong 的 apikey 认证。
      apikey: key,
      "tus-resumable": "1.0.0",
      "upload-length": String(byteCount),
      "upload-metadata": tusMetadata({ bucketName: bucket, objectName: remotePath, contentType: mime, cacheControl }),
      "x-upsert": "false",
    },
  });
  if (!create.ok) {
    const error = await responseError(create);
    if (alreadyExists(error)) return "existing";
    fail(`resumable upload creation failed for ${bucket}/${remotePath}: ${error.message}`);
  }
  const location = create.headers.get("location");
  if (!location) fail(`resumable upload did not return a location for ${bucket}/${remotePath}`);
  const uploadUrl = resolveResumableUploadUrl(location, endpoint);
  const handle = await open(file, "r");
  try {
    let offset = 0;
    while (offset < byteCount) {
      const size = Math.min(RESUMABLE_UPLOAD_BYTES, byteCount - offset);
      const chunk = Buffer.allocUnsafe(size);
      const { bytesRead } = await handle.read(chunk, 0, size, offset);
      if (bytesRead !== size) fail(`resumable upload read truncated for ${bucket}/${remotePath}`);
      const patch = await fetch(uploadUrl, {
        method: "PATCH",
        headers: {
          apikey: key,
          "tus-resumable": "1.0.0",
          "upload-offset": String(offset),
          "content-type": "application/offset+octet-stream",
        },
        body: chunk,
      });
      if (!patch.ok) {
        const error = await responseError(patch);
        if (alreadyExists(error)) return "existing";
        fail(`resumable upload chunk failed for ${bucket}/${remotePath}: ${error.message}`);
      }
      const nextOffset = Number(patch.headers.get("upload-offset"));
      if (nextOffset !== offset + size) fail(`resumable upload offset mismatch for ${bucket}/${remotePath}`);
      offset = nextOffset;
    }
  } finally {
    await handle.close();
  }
  return "uploaded";
}

async function verifyLocalFile(file, expectedHash, expectedByteCount, label) {
  const info = await stat(file);
  if (info.size !== expectedByteCount) fail(`${label} byte count mismatch`);
  if (await sha256File(file) !== expectedHash) fail(`${label} SHA-256 mismatch`);
}

async function uploadPlan(plan, storeRoot, client, uploadConfig) {
  const result = {
    cwObjects: { uploaded: 0, existing: 0 },
    cwH5: { uploaded: 0, existing: 0, manifestsUploaded: 0, manifestsExisting: 0 },
  };
  const normalObjects = plan.objects.filter((object) => object.kind !== "h5");
  for (const [index, object] of normalObjects.entries()) {
    if (index === 0 || (index + 1) % 25 === 0 || index + 1 === normalObjects.length) {
      process.stderr.write(`CW_IMPORT: cw-objects ${index + 1}/${normalObjects.length}\n`);
    }
    const file = resolveInside(storeRoot, object.storeRelativePath);
    await verifyLocalFile(file, object.objectHash, object.byteCount, `CAS ${object.objectHash}`);
    const state = await uploadOne(client, uploadConfig, "cw-objects", object.storagePath, file, object.mime, "31536000");
    result.cwObjects[state] += 1;
  }
  const h5Packages = [...plan.h5Manifests];
  for (const [packageIndex, [hash, manifest]] of h5Packages.entries()) {
    process.stderr.write(`CW_IMPORT: cw-h5 package ${packageIndex + 1}/${h5Packages.length}\n`);
    const manifestFile = resolveInside(plan.packageRoot, `h5-manifests/${hash}.json`);
    const manifestState = await uploadOne(client, uploadConfig, "cw-h5", `packages/${hash}/__mathin_manifest.json`, manifestFile, "application/json", "31536000");
    result.cwH5[`manifests${manifestState[0].toUpperCase()}${manifestState.slice(1)}`] += 1;
    for (const file of manifest.files) {
      const source = resolveInside(storeRoot, `h5/packages/${hash}/patched/${file.packagePath}`);
      await verifyLocalFile(source, file.sha256, file.byteCount, `H5 ${hash}/${file.packagePath}`);
      const state = await uploadOne(client, uploadConfig, "cw-h5", h5StoragePath(hash, file.packagePath), source, file.mime, "31536000");
      result.cwH5[state] += 1;
    }
  }
  return result;
}

export function parseArgs(argv) {
  const options = { dryRun: false, sshHost: process.env.CW_IMPORT_SSH_HOST ?? DEFAULT_SSH_HOST };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--dry-run") { options.dryRun = true; continue; }
    if (arg === "--package-root" || arg === "--store-root" || arg === "--courseware-id" || arg === "--ssh-host") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${arg} requires a value`);
      options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
      continue;
    }
    fail(`unknown argument ${arg}`);
  }
  options.packageRoot ??= process.env.CW_PACKAGE_ROOT;
  options.storeRoot ??= process.env.CW_STORE_ROOT;
  if (!options.packageRoot || !options.storeRoot || !options.coursewareId) {
    fail("usage: pnpm cw:import -- --package-root <dir> --store-root <dir> --courseware-id <id> [--dry-run] [--ssh-host xiaomi]");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const plan = await loadImportPlan({ packageRoot: options.packageRoot, coursewareId: options.coursewareId });
  const preflight = JSON.parse(runRemoteSql(buildPreflightSql(plan), options.sshHost));
  if (preflight.matches !== 1) fail(`target lecture mapping returned ${preflight.matches} rows`);
  const summary = {
    exportId: plan.exportId,
    coursewareId: plan.lecture.coursewareId,
    mathinProductCode: plan.lecture.mathinProductCode,
    lessonIndex: plan.lecture.lessonIndex,
    expected: {
      pages: plan.pages.length,
      usages: plan.usages.length,
      objects: plan.objects.length,
      sharedAssets: plan.assets.length,
      h5Packages: plan.h5Manifests.size,
      h5Files: [...plan.h5Manifests.values()].reduce((total, manifest) => total + manifest.files.length, 0),
    },
    preflight,
  };
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ dryRun: true, ...summary }, null, 2)}\n`);
    return;
  }
  const localEnv = await loadLocalEnv(process.cwd());
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? localEnv.NEXT_PUBLIC_SUPABASE_URL;
  const resumableUrl = process.env.CW_STORAGE_RESUMABLE_URL ?? localEnv.CW_STORAGE_RESUMABLE_URL ?? url;
  const key = process.env.SUPABASE_SECRET_KEY ?? localEnv.SUPABASE_SECRET_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required for Storage upload");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const storage = await uploadPlan(plan, path.resolve(options.storeRoot), client, { url: resumableUrl, key });
  const database = JSON.parse(runRemoteSql(buildImportSql(plan), options.sshHost));
  process.stdout.write(`${JSON.stringify({ ...summary, storage, database }, null, 2)}\n`);
  const problems = [];
  if (database.bindings.conflicts > 0) problems.push(`${database.bindings.conflicts} binding conflicts`);
  if (database.pages.baselineDrift > 0) problems.push(`${database.pages.baselineDrift} pages drifted from the imported baseline`);
  if (problems.length > 0) fail(`reconciliation reported ${problems.join(" and ")} — inspect before re-running`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
