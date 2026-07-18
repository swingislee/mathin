import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { pageDocSchema, type PageDoc } from "@/features/courseware-doc/schema";
import { buildH5EntryUrl, type H5LaunchQuery, type ResolvedBindingUrls } from "@/features/courseware-doc/resolve";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** 中台只读预览的准入权限:任一 courseware.* 键即可浏览(写路径各自再校验)。 */
export const COURSEWARE_STUDIO_PERMS = [
  "courseware.page.edit",
  "courseware.release.publish",
  "courseware.asset.manage",
] as const;

type Supabase = Awaited<ReturnType<typeof createClient>>;

const releaseSnapshotSchema = z.array(
  z.object({
    pageDocId: z.uuid(),
    revisionId: z.uuid(),
    bindings: z.array(z.object({ bindingKey: z.string(), assetRevisionId: z.uuid() })),
  }),
);

const launchQuerySchema = z.object({
  query: z.record(z.string(), z.array(z.string())),
  coursewareIdParam: z.string().nullable(),
});

const h5ManifestSchema = z.object({ entryPath: z.string().min(1) }).loose();

export interface CoursewareCourseSummary {
  id: string;
  title: string;
  productCode: string | null;
  grade: number;
  term: number;
  classType: string;
  lectureCount: number;
  releasedCount: number;
}

/** 课程网格:全部课程 + 各自讲次数/已发布 release 数(72 门课,内存聚合)。 */
export async function loadCoursewareCourses(): Promise<CoursewareCourseSummary[]> {
  const supabase = await createClient();
  const [{ data: courses, error: coursesError }, { data: lectures, error: lecturesError }] = await Promise.all([
    supabase.from("courses").select("id, title, product_code, grade, term, class_type").order("product_code"),
    supabase.from("course_lectures").select("course_id, current_release_id"),
  ]);
  if (coursesError) throw new Error(coursesError.message);
  if (lecturesError) throw new Error(lecturesError.message);

  const lectureStats = new Map<string, { lectureCount: number; releasedCount: number }>();
  for (const lecture of lectures ?? []) {
    const stats = lectureStats.get(lecture.course_id) ?? { lectureCount: 0, releasedCount: 0 };
    stats.lectureCount += 1;
    if (lecture.current_release_id) stats.releasedCount += 1;
    lectureStats.set(lecture.course_id, stats);
  }
  return (courses ?? []).map((course) => ({
    id: course.id,
    title: course.title,
    productCode: course.product_code,
    grade: course.grade,
    term: course.term,
    classType: course.class_type,
    ...(lectureStats.get(course.id) ?? { lectureCount: 0, releasedCount: 0 }),
  }));
}

export interface CoursewareLectureSummary {
  id: string;
  no: number;
  name: string;
  released: boolean;
  releaseNo: number | null;
  publishedAt: string | null;
  pageCount: number;
}

/** 讲次列表 + release 状态。 */
export async function loadCoursewareLectures(courseId: string) {
  const supabase = await createClient();
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id, title, product_code")
    .eq("id", courseId)
    .maybeSingle();
  if (courseError) throw new Error(courseError.message);
  if (!course) return null;

  const { data: lectures, error: lecturesError } = await supabase
    .from("course_lectures")
    .select("id, no, name, current_release_id")
    .eq("course_id", courseId)
    .order("no");
  if (lecturesError) throw new Error(lecturesError.message);

  const releaseIds = (lectures ?? []).flatMap((lecture) => lecture.current_release_id ?? []);
  const [releases, pageCounts] = await Promise.all([
    releaseIds.length
      ? supabase.from("cw_lecture_releases").select("id, release_no, published_at").in("id", releaseIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("cw_page_docs")
      .select("lecture_id")
      .in("lecture_id", (lectures ?? []).map((lecture) => lecture.id))
      .is("deleted_at", null),
  ]);
  if (releases.error) throw new Error(releases.error.message);
  if (pageCounts.error) throw new Error(pageCounts.error.message);

  const releaseById = new Map((releases.data ?? []).map((release) => [release.id, release]));
  const pagesByLecture = new Map<string, number>();
  for (const row of pageCounts.data ?? []) {
    pagesByLecture.set(row.lecture_id, (pagesByLecture.get(row.lecture_id) ?? 0) + 1);
  }
  const summaries: CoursewareLectureSummary[] = (lectures ?? []).map((lecture) => {
    const release = lecture.current_release_id ? releaseById.get(lecture.current_release_id) : undefined;
    return {
      id: lecture.id,
      no: lecture.no,
      name: lecture.name,
      released: Boolean(release),
      releaseNo: release?.release_no ?? null,
      publishedAt: release?.published_at ?? null,
      pageCount: pagesByLecture.get(lecture.id) ?? 0,
    };
  });
  return { course, lectures: summaries };
}

export interface CoursewarePreviewPage {
  pageDocId: string;
  pageNo: number;
  title: string;
  aspect: string;
  doc: PageDoc;
}

export interface CoursewareLecturePreview {
  lecture: { id: string; no: number; name: string; courseId: string };
  release: { id: string; releaseNo: number; publishedAt: string };
  pages: CoursewarePreviewPage[];
  /** bindingKey → URL(staff 自签 signed URL;H5 为垫片入口 URL,已拼 launch query) */
  bindingUrls: ResolvedBindingUrls;
}

/**
 * 只读预览数据:讲的 current release 快照 → 页 doc(过冻结 schema)+ 全部绑定的 URL。
 * 渲染的是已发布状态,不是草稿——预览即验收视角(docs/plan/16 P6-4)。
 */
export async function loadLecturePreview(lectureId: string): Promise<CoursewareLecturePreview | null> {
  const supabase = await createClient();
  const { data: lecture, error: lectureError } = await supabase
    .from("course_lectures")
    .select("id, no, name, course_id, current_release_id")
    .eq("id", lectureId)
    .maybeSingle();
  if (lectureError) throw new Error(lectureError.message);
  if (!lecture?.current_release_id) return null;

  const { data: release, error: releaseError } = await supabase
    .from("cw_lecture_releases")
    .select("id, release_no, published_at, snapshot")
    .eq("id", lecture.current_release_id)
    .maybeSingle();
  if (releaseError) throw new Error(releaseError.message);
  if (!release) return null;

  const snapshot = releaseSnapshotSchema.parse(release.snapshot);
  const pageDocIds = snapshot.map((entry) => entry.pageDocId);
  const revisionIds = snapshot.map((entry) => entry.revisionId);

  const [pageRows, revisionRows, bindingRows] = await Promise.all([
    supabase.from("cw_page_docs").select("id, page_no, title, aspect").in("id", pageDocIds),
    supabase.from("cw_page_revisions").select("id, page_doc_id, doc").in("id", revisionIds),
    supabase.from("cw_page_asset_bindings").select("binding_key, kind, launch_query").in("page_doc_id", pageDocIds),
  ]);
  if (pageRows.error) throw new Error(pageRows.error.message);
  if (revisionRows.error) throw new Error(revisionRows.error.message);
  if (bindingRows.error) throw new Error(bindingRows.error.message);

  const pageById = new Map((pageRows.data ?? []).map((page) => [page.id, page]));
  const revisionById = new Map((revisionRows.data ?? []).map((revision) => [revision.id, revision]));
  const pages: CoursewarePreviewPage[] = snapshot.map((entry) => {
    const page = pageById.get(entry.pageDocId);
    const revision = revisionById.get(entry.revisionId);
    if (!page || !revision) throw new Error(`RELEASE_SNAPSHOT_INCOMPLETE: ${entry.pageDocId}`);
    return {
      pageDocId: page.id,
      pageNo: page.page_no,
      title: page.title,
      aspect: page.aspect,
      doc: pageDocSchema.parse(revision.doc),
    };
  });
  pages.sort((a, b) => a.pageNo - b.pageNo);

  const bindingUrls = await resolveSnapshotBindingUrls(supabase, snapshot, bindingRows.data ?? []);
  return {
    lecture: { id: lecture.id, no: lecture.no, name: lecture.name, courseId: lecture.course_id },
    release: { id: release.id, releaseNo: release.release_no, publishedAt: release.published_at },
    pages,
    bindingUrls,
  };
}

async function resolveSnapshotBindingUrls(
  supabase: Supabase,
  snapshot: z.infer<typeof releaseSnapshotSchema>,
  bindingRows: Array<{ binding_key: string; kind: string; launch_query: unknown }>,
): Promise<ResolvedBindingUrls> {
  const revisionByBindingKey = new Map<string, string>();
  for (const entry of snapshot) {
    for (const binding of entry.bindings) revisionByBindingKey.set(binding.bindingKey, binding.assetRevisionId);
  }
  const assetRevisionIds = [...new Set(revisionByBindingKey.values())];
  if (assetRevisionIds.length === 0) return {};

  const { data: revisions, error } = await supabase
    .from("cw_asset_revisions")
    .select("id, object:cw_asset_objects!cw_asset_revisions_object_id_fkey(sha256, storage_path, kind)")
    .in("id", assetRevisionIds);
  if (error) throw new Error(error.message);
  const objectByRevisionId = new Map((revisions ?? []).map((revision) => [revision.id, revision.object]));

  const launchQueryByBindingKey = new Map<string, H5LaunchQuery | null>();
  const kindByBindingKey = new Map<string, string>();
  for (const row of bindingRows) {
    kindByBindingKey.set(row.binding_key, row.kind);
    launchQueryByBindingKey.set(
      row.binding_key,
      row.launch_query === null ? null : launchQuerySchema.parse(row.launch_query),
    );
  }

  const casPaths = new Set<string>();
  for (const [bindingKey, revisionId] of revisionByBindingKey) {
    const object = objectByRevisionId.get(revisionId);
    if (!object) throw new Error(`RELEASE_ASSET_REVISION_MISSING: ${revisionId}`);
    if (kindByBindingKey.get(bindingKey) !== "h5") casPaths.add(object.storage_path);
  }
  const signedByPath = await signCasPaths(supabase, [...casPaths]);
  const entryPathByHash = new Map<string, string>();

  const urls: Record<string, string> = {};
  for (const [bindingKey, revisionId] of revisionByBindingKey) {
    const object = objectByRevisionId.get(revisionId);
    if (!object) continue;
    if (kindByBindingKey.get(bindingKey) === "h5") {
      let entryPath = entryPathByHash.get(object.sha256);
      if (!entryPath) {
        entryPath = await fetchH5EntryPath(object.sha256);
        entryPathByHash.set(object.sha256, entryPath);
      }
      urls[bindingKey] = buildH5EntryUrl(object.sha256, entryPath, launchQueryByBindingKey.get(bindingKey) ?? null);
    } else {
      const signedUrl = signedByPath.get(object.storage_path);
      if (!signedUrl) throw new Error(`SIGNED_URL_MISSING: ${object.storage_path}`);
      urls[bindingKey] = signedUrl;
    }
  }
  return urls;
}

export interface SessionResolvedMeta {
  version: "cw-session-resolved-v1";
  releaseId: string | null;
  bindings: Array<{ pageDocId: string; bindingKey: string; objectHash: string }>;
}

/**
 * 开课冻结用:把讲次 current release 的快照物化为 courseware_resolved
 * (objectHash 清单)。freeze_session_courseware 对已发布讲次强制校验
 * releaseId 一致,课堂资产签发(list_session_resolved_assets)按 objectHash 取对象。
 */
export async function materializeSessionResolved(releaseId: string): Promise<SessionResolvedMeta> {
  const supabase = await createClient();
  const { data: release, error } = await supabase
    .from("cw_lecture_releases")
    .select("id, snapshot")
    .eq("id", releaseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!release) throw new Error(`RELEASE_NOT_FOUND: ${releaseId}`);

  const snapshot = releaseSnapshotSchema.parse(release.snapshot);
  const assetRevisionIds = [...new Set(snapshot.flatMap((entry) => entry.bindings.map((binding) => binding.assetRevisionId)))];
  const hashByRevisionId = new Map<string, string>();
  if (assetRevisionIds.length > 0) {
    const { data: revisions, error: revisionError } = await supabase
      .from("cw_asset_revisions")
      .select("id, object:cw_asset_objects!cw_asset_revisions_object_id_fkey(sha256)")
      .in("id", assetRevisionIds);
    if (revisionError) throw new Error(revisionError.message);
    for (const revision of revisions ?? []) {
      if (revision.object?.sha256) hashByRevisionId.set(revision.id, revision.object.sha256);
    }
  }
  const bindings = snapshot.flatMap((entry) =>
    entry.bindings.map((binding) => {
      const objectHash = hashByRevisionId.get(binding.assetRevisionId);
      if (!objectHash) throw new Error(`RELEASE_ASSET_REVISION_MISSING: ${binding.assetRevisionId}`);
      return { pageDocId: entry.pageDocId, bindingKey: binding.bindingKey, objectHash };
    }),
  );
  return { version: "cw-session-resolved-v1", releaseId, bindings };
}

/** staff 直读 = 用户自身 token 批签 signed URL,RLS select 策略即签名授权(D3 拍板第 4 项);不走 service key。 */
async function signCasPaths(supabase: Supabase, paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data, error } = await supabase.storage.from("cw-objects").createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);
  const byPath = new Map<string, string>();
  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) byPath.set(item.path, item.signedUrl);
  }
  return byPath;
}

/** H5 包入口取自公开桶内 __mathin_manifest.json 的 entryPath,不硬编码 index.html(D3)。 */
async function fetchH5EntryPath(packageHash: string): Promise<string> {
  const base = getSupabaseConfig().url.replace(/\/$/, "");
  const response = await fetch(
    `${base}/storage/v1/object/public/cw-h5/packages/${packageHash}/__mathin_manifest.json`,
    { cache: "force-cache" },
  );
  if (!response.ok) throw new Error(`H5_MANIFEST_MISSING: ${packageHash}`);
  return h5ManifestSchema.parse(await response.json()).entryPath;
}
