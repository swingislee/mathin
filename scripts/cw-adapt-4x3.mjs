/**
 * P6-6 真 4:3 增强轨（按讲执行）。
 *
 * 输入：镜像仓 Mathin v2 发布包中的 adaptations.ndjson + 原始 CAS store。
 * 输出：背景对象、自动类(A/B/C/E/F)的 page-doc-v1 草稿；--apply 时才
 * 上传 cw-objects 并经单个 SSH psql 事务写入资源 revision / 审校闸门 / 草稿。
 * D 类永远只进审校队列，绝不由本脚本静默改写。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadImportPlan, resolveInside, uploadOne } from "./cw-import.mjs";

const AUTOMATIC_CLASSES = new Set(["A", "B", "C", "E", "F"]);
const DEFAULT_SSH_HOST = "xiaomi";

function fail(message) { throw new Error(`CW_ADAPT_4X3: ${message}`); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function sqlText(value) { return `convert_from(decode('${Buffer.from(String(value), "utf8").toString("base64")}', 'base64'), 'utf8')`; }
function sqlJson(value) { return `${sqlText(JSON.stringify(value))}::jsonb`; }
function sqlValues(rows, map) { return rows.map((row) => `(${map(row).join(", ")})`).join(",\n"); }

function derive43Doc(doc, affine, nodeTransformScope = "all") {
  const scaleX = affine?.scaleX ?? affine?.scale;
  const scaleY = affine?.scaleY ?? affine?.scale;
  if (!Number.isFinite(scaleX) || scaleX <= 0 || !Number.isFinite(scaleY) || scaleY <= 0 || !Number.isFinite(affine?.translateX) || !Number.isFinite(affine?.translateY)) {
    fail("classification has an invalid affine transform");
  }
  const point = (x, y) => [x * scaleX + affine.translateX, y * scaleY + affine.translateY];
  if (!["all", "root", "frame"].includes(nodeTransformScope)) fail("classification has an invalid node transform scope");
  if (nodeTransformScope === "frame") {
    const template = doc.nodes[0];
    if (!template) fail("content-frame classification requires at least one node");
    // F 类只让背景占满 4:3。内容节点保留原本 1280×720 的局部坐标，放进
    // 居中的 0.75 比例坐标层；这抵消 4:3 舞台自身的放大，不会裁剪长标题。
    const frame = {
      ...template,
      id: "mathin-adapt-4x3-content-frame",
      nodePath: "$.mathinAdapt43ContentFrame",
      sourceType: "mathin:adapt-4x3-content-frame",
      sourceResourceId: null,
      adapter: "group",
      name: null,
      supported: true,
      visible: true,
      interactive: false,
      zIndex: 0,
      order: 0,
      crop: null,
      transform: { x: 0, y: 90, width: 1280, height: 720, rotation: 0, scaleX: 0.75, scaleY: 0.75, anchorX: 0, anchorY: 0, opacity: 1, flipX: false, flipY: false, clip: false },
      resources: [],
      content: null,
      children: doc.nodes,
    };
    return { ...doc, canvas: { ...doc.canvas, width: 960, height: 720 }, nodes: [frame] };
  }
  const node = (item, depth) => {
    const transform = depth === 0 || nodeTransformScope === "all"
      ? (() => { const [x, y] = point(item.transform.x, item.transform.y); return { ...item.transform, x, y, width: item.transform.width * scaleX, height: item.transform.height * scaleY }; })()
      : item.transform;
    return {
      ...item,
      transform,
      children: item.children.map((child) => node(child, depth + 1)),
    };
  };
  return {
    ...doc,
    canvas: { ...doc.canvas, width: 960, height: 720 },
    nodes: doc.nodes.map((item) => node(item, 0)),
    interactions: doc.interactions.map((interaction) => {
      if (!interaction.path) return interaction;
      const points = [];
      for (let index = 0; index < interaction.path.points.length; index += 2) points.push(...point(interaction.path.points[index], interaction.path.points[index + 1]));
      return { ...interaction, path: { ...interaction.path, points } };
    }),
  };
}

async function readAdaptations(packageRoot, coursewareId) {
  const file = resolveInside(packageRoot, "adaptations.ndjson");
  const text = await readFile(file, "utf8");
  const rows = text.trim() ? text.trim().split(/\r?\n/).map((line) => JSON.parse(line)) : [];
  const byPageId = new Map();
  for (const row of rows.filter((item) => item.coursewareId === coursewareId)) {
    if (!Number.isInteger(row.pageDatabaseId) || !Number.isInteger(row.pageIndex) || !["A", "B", "C", "D", "E", "F"].includes(row.adaptClass)) {
      fail("adaptations.ndjson contains an invalid classification row");
    }
    if (byPageId.has(row.pageDatabaseId)) fail(`duplicate classification for page ${row.pageDatabaseId}`);
    const crop = row.backgroundCrop ?? { x: 0, y: 0 };
    if (!Number.isInteger(crop.x) || !Number.isInteger(crop.y) || crop.x < 0 || crop.x > 320 || crop.y !== 0) {
      fail("adaptations.ndjson contains an invalid background crop");
    }
    const nodeTransformScope = row.nodeTransformScope ?? "all";
    if (!["all", "root", "frame"].includes(nodeTransformScope)) fail("adaptations.ndjson contains an invalid node transform scope");
    byPageId.set(row.pageDatabaseId, { ...row, backgroundCrop: crop, nodeTransformScope });
  }
  return byPageId;
}

function runMagick(args, bin) {
  const result = spawnSync(bin, args, { encoding: "utf8", shell: false });
  if (result.error) fail(`cannot start ImageMagick (${bin}): ${result.error.message}`);
  if (result.status !== 0) fail(`ImageMagick failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
}

async function deriveBackground(source, output, mime, magick, crop) {
  await mkdir(path.dirname(output), { recursive: true });
  // 先归一到 1280×720，再按分类指定的 960×720 原点裁切。默认是左侧 (0,0)，
  // F 类中心标题页为 (160,0)，以保留背景与标题共同的视觉中线。
  // 不在这里尝试"聪明"重构内容图，复杂背景必须在确认队列里退回人工重制。
  // PNG tIME/text chunks are written with the current clock by ImageMagick unless
  // explicitly excluded.  CAS identity must be a pure function of the source,
  // not of the execution time, so strip metadata and pin the output encoding.
  runMagick([
    source,
    "-resize", "1280x720!",
    "-crop", `960x720+${crop.x}+${crop.y}`, "+repage",
    "-strip",
    "-define", "png:exclude-chunk=date,time",
    "-define", "png:compression-level=9",
    output,
  ], magick);
  const bytes = await readFile(output);
  const extension = mime === "image/jpeg" ? ".jpg" : mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : mime === "image/gif" ? ".gif" : null;
  if (!extension) fail(`background MIME is not an image supported by ImageMagick: ${mime}`);
  return { hash: sha256(bytes), byteCount: bytes.length, mime, extension };
}

export async function buildAdaptPlan({ packageRoot, storeRoot, coursewareId, outputRoot, buildAssets, magickBin = process.env.CW_MAGICK_BIN ?? "magick" }) {
  const plan = await loadImportPlan({ packageRoot, coursewareId });
  const classifications = await readAdaptations(plan.packageRoot, plan.lecture.coursewareId);
  if (classifications.size !== plan.pages.length) fail(`classification/page mismatch: ${classifications.size}/${plan.pages.length}`);
  const usageByPageAndKey = new Map(plan.usages.map((usage) => [`${usage.pageDatabaseId}/${usage.usageKey}`, usage]));
  const objectByHash = new Map(plan.objects.map((object) => [object.objectHash, object]));
  const derivedBySourceHash = new Map();
  const pages = [];
  for (const page of plan.pages) {
    const classification = classifications.get(page.sourcePageDatabaseId);
    if (!classification) fail(`classification missing for page ${page.sourcePageDatabaseId}`);
    if (!AUTOMATIC_CLASSES.has(classification.adaptClass)) continue;
    const sourceKey = page.doc.canvas.backgroundBindingKey;
    const backgroundUsage = sourceKey ? usageByPageAndKey.get(`${page.sourcePageDatabaseId}/${sourceKey}`) : null;
    let background = null;
    if (backgroundUsage) {
      const sourceObject = objectByHash.get(backgroundUsage.objectHash);
      if (!sourceObject || sourceObject.kind !== "image") fail(`page ${page.pageNo} background does not resolve to an image object`);
      const crop = classification.backgroundCrop;
      const derivativeKey = `${sourceObject.objectHash}/${crop.x}/${crop.y}`;
      if (!derivedBySourceHash.has(derivativeKey)) {
        const source = resolveInside(storeRoot, sourceObject.storeRelativePath);
        if (!(await stat(source)).isFile()) fail(`background source is not a file: ${source}`);
        if (!buildAssets) {
          derivedBySourceHash.set(derivativeKey, { sourceHash: sourceObject.objectHash, mime: sourceObject.mime, cropX: crop.x, cropY: crop.y, pending: true });
        } else {
          const temporary = path.join(outputRoot, "work", `${sourceObject.objectHash}-${crop.x}-${crop.y}.${sourceObject.mime.split("/")[1] ?? "img"}`);
          const result = await deriveBackground(source, temporary, sourceObject.mime, magickBin, crop);
          const storagePath = `sha256/${result.hash.slice(0, 2)}/${result.hash}`;
          const destination = path.join(outputRoot, ...storagePath.split("/"));
          await mkdir(path.dirname(destination), { recursive: true });
          const content = await readFile(temporary);
          await (await import("node:fs/promises")).writeFile(destination, content);
          derivedBySourceHash.set(derivativeKey, { sourceHash: sourceObject.objectHash, derivedHash: result.hash, byteCount: result.byteCount, mime: result.mime, storagePath, cropX: crop.x, cropY: crop.y, outputFile: destination });
        }
      }
      background = derivedBySourceHash.get(derivativeKey);
    }
    pages.push({
      pageNo: page.pageNo,
      sourcePageDatabaseId: page.sourcePageDatabaseId,
      adaptClass: classification.adaptClass,
      affine: classification.affine,
      doc: derive43Doc(page.doc, classification.affine, classification.nodeTransformScope),
      backgroundBindingKey: sourceKey,
      backgroundSourceHash: backgroundUsage?.objectHash ?? null,
      backgroundDerivedHash: background?.derivedHash ?? null,
    });
  }
  return { plan, classifications: [...classifications.values()], pages, objects: [...derivedBySourceHash.values()] };
}

function buildApplySql(adapt) {
  const { plan, pages, objects, classifications } = adapt;
  if (pages.length === 0) fail("no automatic A/B/C/E/F pages in selected lecture");
  if (objects.some((item) => !item.derivedHash)) fail("cannot apply a plan whose background assets were not built");
  const pageValues = sqlValues(pages, (page) => [String(page.pageNo), sqlText(page.adaptClass), sqlJson(page.doc), page.backgroundBindingKey ? sqlText(page.backgroundBindingKey) : "NULL", page.backgroundSourceHash ? sqlText(page.backgroundSourceHash) : "NULL", page.backgroundDerivedHash ? sqlText(page.backgroundDerivedHash) : "NULL"]);
  const classificationValues = sqlValues(classifications, (classification) => [String(classification.pageIndex), sqlText(classification.adaptClass), sqlText(classification.reason)]);
  const objectValues = objects.filter((item) => item.derivedHash).length
    ? sqlValues(objects.filter((item) => item.derivedHash), (item) => [sqlText(item.sourceHash), sqlText(item.derivedHash), sqlText(item.mime), String(item.byteCount), sqlText(item.storagePath), String(item.cropX), String(item.cropY)])
    : "(NULL, NULL, NULL, NULL, NULL, NULL, NULL)";
  return `begin;
create temporary table cw_adapt_context(lecture_id uuid primary key) on commit drop;
insert into cw_adapt_context
select lecture.id from public.course_lectures lecture join public.courses course on course.id=lecture.course_id
where course.product_code=${sqlText(plan.lecture.mathinProductCode)} and lecture.no=${plan.lecture.lessonIndex} for update;
do $$ begin if (select count(*) from cw_adapt_context) <> 1 then raise exception 'CW_ADAPT_LECTURE_MAPPING_MISSING_OR_AMBIGUOUS'; end if; end $$;
create temporary table cw_adapt_classifications(page_no int primary key, adapt_class text not null, adapt_reason text not null) on commit drop;
insert into cw_adapt_classifications values ${classificationValues};
do $$ begin
 if (select count(*) from cw_adapt_classifications) <> (select count(*) from public.cw_page_docs page join cw_adapt_context context on page.lecture_id=context.lecture_id where page.deleted_at is null)
 then raise exception 'CW_ADAPT_CLASSIFICATION_PAGE_MISMATCH'; end if;
end $$;
update public.cw_page_docs page set adapt_class=classification.adapt_class, adapt_reason=classification.adapt_reason
from cw_adapt_context context join cw_adapt_classifications classification on true
where page.lecture_id=context.lecture_id and page.page_no=classification.page_no and page.deleted_at is null;
insert into public.cw_page_track_heads(page_doc_id,track,draft_revision_id,current_revision_id)
select page.id,'adapted-4x3',native.draft_revision_id,native.current_revision_id
from cw_adapt_context context join public.cw_page_docs page on page.lecture_id=context.lecture_id and page.deleted_at is null
join public.cw_page_track_heads native on native.page_doc_id=page.id and native.track='native-16x9'
on conflict(page_doc_id,track) do nothing;
create temporary table cw_adapt_input(page_no int primary key, adapt_class text not null, doc jsonb not null, background_binding_key text, source_object_hash text, derived_object_hash text) on commit drop;
insert into cw_adapt_input values ${pageValues};
insert into public.cw_page_asset_bindings(page_doc_id,binding_key,role,kind,shared_asset_id,pinned_revision_id,launch_query,track)
select binding.page_doc_id,binding.binding_key,binding.role,binding.kind,binding.shared_asset_id,binding.pinned_revision_id,binding.launch_query,'adapted-4x3'
from cw_adapt_context context join public.cw_page_docs page on page.lecture_id=context.lecture_id and page.deleted_at is null
join public.cw_page_asset_bindings binding on binding.page_doc_id=page.id and binding.track='native-16x9'
on conflict(page_doc_id,binding_key,track) do nothing;
create temporary table cw_adapt_objects(source_hash text not null, derived_hash text primary key, mime text not null, byte_count bigint not null, storage_path text not null, crop_x int not null, crop_y int not null) on commit drop;
insert into cw_adapt_objects values ${objectValues};
delete from cw_adapt_objects where source_hash is null;
do $$ begin
 if exists (
   select 1 from cw_adapt_input input join cw_adapt_context context on true join public.cw_page_docs page on page.lecture_id=context.lecture_id and page.page_no=input.page_no
   join public.cw_page_track_heads head on head.page_doc_id=page.id and head.track='native-16x9'
   join public.cw_page_revisions base on base.id=coalesce(head.draft_revision_id,head.current_revision_id)
   where base.origin <> 'import'
 ) then raise exception 'CW_ADAPT_PAGE_NOT_IMPORT_BASELINE'; end if;
end $$;
insert into public.cw_asset_objects(sha256,mime,byte_count,kind,storage_path)
select derived_hash,mime,byte_count,'image',storage_path from cw_adapt_objects
on conflict(sha256) do nothing;
create temporary table cw_adapt_background_map(page_doc_id uuid primary key, binding_id uuid not null, source_revision_id uuid not null, shared_asset_id uuid not null, derived_object_hash text not null, derived_revision_id uuid) on commit drop;
insert into cw_adapt_background_map(page_doc_id,binding_id,source_revision_id,shared_asset_id,derived_object_hash)
-- 输入包里的 source_object_hash 是原始 16:9 背景的稳定身份。不得以 binding 当前
-- pin 为来源：重跑时它已指向 mathin-4x3 revision，会把派生背景再裁一遍。
select page.id,binding.id,source_revision.id,asset.id,input.derived_object_hash
from cw_adapt_input input join cw_adapt_context context on true join public.cw_page_docs page on page.lecture_id=context.lecture_id and page.page_no=input.page_no
join public.cw_page_asset_bindings binding on binding.page_doc_id=page.id and binding.binding_key=input.background_binding_key and binding.track='native-16x9'
join public.cw_shared_assets asset on asset.id=binding.shared_asset_id
join public.cw_asset_revisions source_revision on source_revision.shared_asset_id=asset.id
join public.cw_asset_objects source_object on source_object.id=source_revision.object_id and source_object.sha256=input.source_object_hash
where input.derived_object_hash is not null;
insert into public.cw_asset_revisions(shared_asset_id,revision_no,object_id,derived_from_revision_id,variant,note)
select candidate.shared_asset_id,(select coalesce(max(revision_no),0)+1 from public.cw_asset_revisions r where r.shared_asset_id=candidate.shared_asset_id),object.id,candidate.source_revision_id,'mathin-4x3','P6-6 automatic left crop'
from (
  select distinct on (shared_asset_id,source_revision_id,derived_object_hash) shared_asset_id,source_revision_id,derived_object_hash
    from cw_adapt_background_map
   order by shared_asset_id,source_revision_id,derived_object_hash
) candidate join public.cw_asset_objects object on object.sha256=candidate.derived_object_hash
where not exists (select 1 from public.cw_asset_revisions r join public.cw_asset_objects o on o.id=r.object_id where r.shared_asset_id=candidate.shared_asset_id and r.derived_from_revision_id=candidate.source_revision_id and o.sha256=candidate.derived_object_hash);
update cw_adapt_background_map map set derived_revision_id=revision.id
from public.cw_asset_revisions revision join public.cw_asset_objects object on object.id=revision.object_id
where revision.shared_asset_id=map.shared_asset_id and revision.derived_from_revision_id=map.source_revision_id and object.sha256=map.derived_object_hash;
do $$ begin if exists(select 1 from cw_adapt_background_map where derived_revision_id is null) then raise exception 'CW_ADAPT_DERIVED_REVISION_MISSING'; end if; end $$;
insert into public.cw_adapt_backgrounds(source_asset_revision_id,derived_asset_revision_id,crop_x,crop_y)
select source_revision_id,derived_revision_id,object.crop_x,object.crop_y from cw_adapt_background_map map join cw_adapt_objects object on object.derived_hash=map.derived_object_hash
on conflict(derived_asset_revision_id) do nothing;
insert into public.cw_asset_variant_heads(shared_asset_id,track,draft_revision_id,published_revision_id)
select distinct on (shared_asset_id) shared_asset_id,'adapted-4x3',derived_revision_id,null
from cw_adapt_background_map order by shared_asset_id,derived_revision_id
on conflict(shared_asset_id,track) do update set draft_revision_id=excluded.draft_revision_id,updated_at=now();
insert into public.cw_page_asset_bindings(page_doc_id,binding_key,role,kind,shared_asset_id,pinned_revision_id,launch_query,track)
select binding.page_doc_id,binding.binding_key,binding.role,binding.kind,binding.shared_asset_id,map.derived_revision_id,binding.launch_query,'adapted-4x3'
from cw_adapt_background_map map join public.cw_page_asset_bindings binding on binding.id=map.binding_id
on conflict(page_doc_id,binding_key,track) do update set shared_asset_id=excluded.shared_asset_id,pinned_revision_id=excluded.pinned_revision_id,launch_query=excluded.launch_query;
create temporary table cw_adapt_inserted_pages(page_doc_id uuid primary key) on commit drop;
with inserted as (
 insert into public.cw_page_revisions(page_doc_id,revision_no,doc,origin,base_revision_id,note,track)
 select page.id,(select coalesce(max(revision_no),0)+1 from public.cw_page_revisions r where r.page_doc_id=page.id),input.doc,'adapt-4x3',base.id,'P6-6 automatic 4:3 derivation','adapted-4x3'
 from cw_adapt_input input join cw_adapt_context context on true join public.cw_page_docs page on page.lecture_id=context.lecture_id and page.page_no=input.page_no
 join public.cw_page_track_heads head on head.page_doc_id=page.id and head.track='native-16x9'
 join public.cw_page_revisions base on base.id=coalesce(head.draft_revision_id,head.current_revision_id)
 returning page_doc_id
) insert into cw_adapt_inserted_pages select page_doc_id from inserted;
insert into public.cw_page_track_heads(page_doc_id,track,draft_revision_id,current_revision_id)
select page.id,'adapted-4x3',revision.id,existing.current_revision_id
from cw_adapt_context context, cw_adapt_input input, public.cw_page_revisions revision
join public.cw_page_docs page on page.id=revision.page_doc_id
left join public.cw_page_track_heads existing on existing.page_doc_id=page.id and existing.track='adapted-4x3'
where page.lecture_id=context.lecture_id and page.page_no=input.page_no
  and revision.page_doc_id=page.id and revision.origin='adapt-4x3'
  and revision.revision_no=(select max(r.revision_no) from public.cw_page_revisions r where r.page_doc_id=page.id)
on conflict(page_doc_id,track) do update set draft_revision_id=excluded.draft_revision_id,updated_at=now();
select jsonb_build_object('lectureId',(select lecture_id from cw_adapt_context),'pages',jsonb_build_object('expected',(select count(*) from cw_adapt_input),'inserted',(select count(*) from cw_adapt_inserted_pages)),'backgrounds',jsonb_build_object('expected',(select count(*) from cw_adapt_background_map),'pending',(select count(*) from public.cw_adapt_backgrounds a join cw_adapt_background_map m on m.derived_revision_id=a.derived_asset_revision_id where a.status='pending')),'objects',jsonb_build_object('expected',(select count(*) from cw_adapt_objects),'present',(select count(*) from cw_adapt_objects input join public.cw_asset_objects object on object.sha256=input.derived_hash)))::text;
commit;`;
}

function runRemoteSql(sql, sshHost) {
  const result = spawnSync("ssh", [sshHost, "docker exec -i supabase-db psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: false });
  if (result.error) fail(`cannot start SSH psql: ${result.error.message}`);
  if (result.status !== 0) fail(`remote SQL failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  return result.stdout.trim();
}

async function readLocalEnv() {
  try {
    const text = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
    return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
      const i = line.indexOf("="); return i > 0 && !line.trimStart().startsWith("#") ? [[line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")]] : [];
    }));
  } catch { return {}; }
}

async function uploadDerivedObjects(objects, url, key) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = { uploaded: 0, existing: 0 };
  for (const object of objects) {
    // 与基线导入共享同一可恢复上传原语，避免单个上游超时让整讲适配重头再来。
    const state = await uploadOne(
      client,
      { url: process.env.CW_STORAGE_RESUMABLE_URL ?? url, key },
      "cw-objects",
      object.storagePath,
      object.outputFile,
      object.mime,
      "31536000",
    );
    result[state] += 1;
  }
  return result;
}

export function parseArgs(argv) {
  const options = { dryRun: false, apply: false, sshHost: process.env.CW_ADAPT_SSH_HOST ?? DEFAULT_SSH_HOST };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--dry-run") { options.dryRun = true; continue; }
    if (arg === "--apply") { options.apply = true; continue; }
    if (["--package-root", "--store-root", "--courseware-id", "--output-root", "--ssh-host"].includes(arg)) {
      const value = argv[++i]; if (!value || value.startsWith("--")) fail(`${arg} requires a value`);
      options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value; continue;
    }
    fail(`unknown argument ${arg}`);
  }
  options.packageRoot ??= process.env.CW_PACKAGE_ROOT; options.storeRoot ??= process.env.CW_STORE_ROOT;
  if (!options.packageRoot || !options.storeRoot || !options.coursewareId) fail("usage: pnpm cw:adapt-4x3 -- --package-root <dir> --store-root <dir> --courseware-id <id> [--output-root <dir>] [--dry-run] [--apply]");
  if ((options.apply || !options.dryRun) && !options.outputRoot) fail("--output-root is required when deriving assets");
  if (options.apply && options.dryRun) fail("--apply cannot be combined with --dry-run");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const adapt = await buildAdaptPlan({ packageRoot: options.packageRoot, storeRoot: options.storeRoot, coursewareId: options.coursewareId, outputRoot: options.outputRoot ?? path.join(process.cwd(), ".tmp", "cw-adapt-4x3"), buildAssets: !options.dryRun });
  const summary = { exportId: adapt.plan.exportId, coursewareId: adapt.plan.lecture.coursewareId, automaticPages: adapt.pages.length, classifications: Object.fromEntries(["A", "B", "C", "D", "E", "F"].map((key) => [key, adapt.classifications.filter((item) => item.adaptClass === key).length])), derivedBackgrounds: adapt.objects.length };
  if (options.dryRun) { process.stdout.write(`${JSON.stringify({ dryRun: true, ...summary }, null, 2)}\n`); return; }
  if (!options.apply) { process.stdout.write(`${JSON.stringify({ built: true, ...summary }, null, 2)}\n`); return; }
  const env = await readLocalEnv(); const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SECRET_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required for --apply");
  const storage = await uploadDerivedObjects(adapt.objects, url, key);
  const database = JSON.parse(runRemoteSql(buildApplySql(adapt), options.sshHost));
  if (database.pages.inserted !== database.pages.expected || database.objects.present !== database.objects.expected) fail("database reconciliation failed");
  process.stdout.write(`${JSON.stringify({ ...summary, storage, database }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
