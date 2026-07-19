import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { pageDocSchema, type PageDoc } from "@/features/courseware-doc/schema";
import { buildH5EntryUrl, type H5LaunchQuery, type ResolvedBindingUrls } from "@/features/courseware-doc/resolve";

const SIGNED_URL_TTL_SECONDS = 60 * 60;
export const COURSEWARE_TRACKS = ["native-16x9", "adapted-4x3"] as const;
export type CoursewareTrack = (typeof COURSEWARE_TRACKS)[number];

export function parseCoursewareTrack(value: string | string[] | undefined): CoursewareTrack {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "adapted-4x3" ? "adapted-4x3" : "native-16x9";
}

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

const assetLibraryFiltersSchema = z.object({
  query: z.string().trim().max(200).catch(""),
  kind: z.enum(["image", "video", "audio", "svg", "h5"]).nullable().catch(null),
  role: z.string().trim().min(1).max(100).nullable().catch(null),
  minUsage: z.coerce.number().int().min(0).max(1_000_000).catch(0),
  page: z.coerce.number().int().min(1).max(1_000).catch(1),
});

export type AssetLibraryFilters = z.infer<typeof assetLibraryFiltersSchema>;

export function parseAssetLibraryFilters(input: {
  query?: string | string[];
  kind?: string | string[];
  role?: string | string[];
  minUsage?: string | string[];
  page?: string | string[];
}): AssetLibraryFilters {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  return assetLibraryFiltersSchema.parse({
    query: first(input.query) ?? "",
    kind: first(input.kind) || null,
    role: first(input.role) || null,
    minUsage: first(input.minUsage) ?? "0",
    page: first(input.page) ?? "1",
  });
}

export interface SharedAssetLibraryItem {
  id: string;
  name: string;
  kind: string;
  role: string;
  publishedRevisionId: string;
  publishedRevisionNo: number;
  sha256: string;
  mime: string;
  byteCount: number;
  width: number;
  height: number;
  usageCount: number;
  courseCount: number;
  lectureCount: number;
  updatedAt: string;
}

const ASSET_LIBRARY_PAGE_SIZE = 100;

/** 资源库按服务端筛选和分页，避免全量迁入后一次把数万 semantic asset 下发给浏览器。 */
export async function loadCoursewareSharedAssets(filters: AssetLibraryFilters) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_cw_shared_assets", {
    p_query: filters.query,
    p_kind: filters.kind ?? undefined,
    p_role: filters.role ?? undefined,
    p_min_usage: filters.minUsage,
    p_limit: ASSET_LIBRARY_PAGE_SIZE + 1,
    p_offset: (filters.page - 1) * ASSET_LIBRARY_PAGE_SIZE,
  });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return {
    items: rows.slice(0, ASSET_LIBRARY_PAGE_SIZE).map((asset): SharedAssetLibraryItem => ({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      role: asset.role,
      publishedRevisionId: asset.published_revision_id,
      publishedRevisionNo: asset.published_revision_no,
      sha256: asset.object_sha256,
      mime: asset.mime,
      byteCount: asset.byte_count,
      width: asset.width,
      height: asset.height,
      usageCount: asset.usage_count,
      courseCount: asset.course_count,
      lectureCount: asset.lecture_count,
      updatedAt: asset.updated_at,
    })),
    hasNextPage: rows.length > ASSET_LIBRARY_PAGE_SIZE,
    pageSize: ASSET_LIBRARY_PAGE_SIZE,
  };
}

export interface SharedAssetUsage {
  bindingId: string;
  bindingKey: string;
  pageDocId: string;
  pageNo: number;
  pageTitle: string;
  lectureId: string;
  lectureNo: number;
  lectureName: string;
  courseId: string;
  courseTitle: string;
  productCode: string;
  pinnedRevisionId: string | null;
  resolvedRevisionId: string;
  frozenSessionCount: number;
}

export interface SharedAssetReplacementBatch {
  id: string;
  mode: "publish_pointer" | "branch_rebind";
  selectedUsageCount: number;
  status: "applied" | "rolled_back";
  note: string;
  createdAt: string;
  rolledBackAt: string | null;
}

export interface CoursewareSharedAssetDetail {
  asset: {
    id: string;
    name: string;
    role: string;
    publishedRevisionId: string;
    publishedRevisionNo: number;
    sha256: string;
    mime: string;
    byteCount: number;
    width: number;
    height: number;
    previewUrl: string | null;
  };
  usages: SharedAssetUsage[];
  batches: SharedAssetReplacementBatch[];
}

/** 资源详情的使用位置、冻结标记和审计历史。页面级 pinned binding 只展示，不能进入批量选择。 */
export async function loadCoursewareSharedAssetDetail(assetId: string): Promise<CoursewareSharedAssetDetail | null> {
  const parsedAssetId = z.uuid().safeParse(assetId);
  if (!parsedAssetId.success) return null;
  assetId = parsedAssetId.data;
  const supabase = await createClient();
  const { data: asset, error: assetError } = await supabase
    .from("cw_shared_assets")
    .select("id, name, kind, role, published_revision_id")
    .eq("id", assetId)
    .maybeSingle();
  if (assetError) throw new Error(assetError.message);
  if (!asset || asset.kind !== "image" || !asset.published_revision_id) return null;

  const { data: revision, error: revisionError } = await supabase
    .from("cw_asset_revisions")
    .select("id, revision_no, object_id")
    .eq("id", asset.published_revision_id)
    .maybeSingle();
  if (revisionError) throw new Error(revisionError.message);
  if (!revision) throw new Error("ASSET_PUBLISHED_REVISION_MISSING");

  const [{ data: object, error: objectError }, { data: usageRows, error: usagesError }, { data: batchRows, error: batchesError }] = await Promise.all([
    supabase.from("cw_asset_objects").select("sha256, mime, byte_count, width, height, storage_path").eq("id", revision.object_id).maybeSingle(),
    supabase.rpc("list_cw_shared_asset_usages", { p_shared_asset_id: assetId }),
    supabase
      .from("cw_replacement_batches")
      .select("id, mode, selected_usage_count, status, note, created_at, rolled_back_at")
      .or(`source_shared_asset_id.eq.${assetId},target_shared_asset_id.eq.${assetId}`)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (objectError) throw new Error(objectError.message);
  if (usagesError) throw new Error(usagesError.message);
  if (batchesError) throw new Error(batchesError.message);
  if (!object) throw new Error("ASSET_OBJECT_MISSING");

  const { data: signed, error: signedError } = await supabase.storage.from("cw-objects").createSignedUrl(object.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signedError) throw new Error(signedError.message);
  return {
    asset: {
      id: asset.id,
      name: asset.name,
      role: asset.role,
      publishedRevisionId: revision.id,
      publishedRevisionNo: revision.revision_no,
      sha256: object.sha256,
      mime: object.mime,
      byteCount: object.byte_count,
      width: object.width ?? 0,
      height: object.height ?? 0,
      previewUrl: signed?.signedUrl ?? null,
    },
    usages: (usageRows ?? []).map((usage): SharedAssetUsage => ({
      bindingId: usage.binding_id,
      bindingKey: usage.binding_key,
      pageDocId: usage.page_doc_id,
      pageNo: usage.page_no,
      pageTitle: usage.page_title,
      lectureId: usage.lecture_id,
      lectureNo: usage.lecture_no,
      lectureName: usage.lecture_name,
      courseId: usage.course_id,
      courseTitle: usage.course_title,
      productCode: usage.product_code,
      pinnedRevisionId: usage.pinned_revision_id,
      resolvedRevisionId: usage.resolved_revision_id,
      frozenSessionCount: usage.frozen_session_count,
    })),
    batches: (batchRows ?? []).map((batch): SharedAssetReplacementBatch => ({
      id: batch.id,
      mode: batch.mode as SharedAssetReplacementBatch["mode"],
      selectedUsageCount: batch.selected_usage_count,
      status: batch.status as SharedAssetReplacementBatch["status"],
      note: batch.note,
      createdAt: batch.created_at,
      rolledBackAt: batch.rolled_back_at,
    })),
  };
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

export interface CoursewarePreviewPageMeta {
  pageDocId: string;
  pageNo: number;
  title: string;
  aspect: string;
}

export interface CoursewareLecturePreview {
  lecture: { id: string; no: number; name: string; courseId: string };
  release: { id: string; releaseNo: number; publishedAt: string };
  /** 导航只需轻量元数据；不把整讲 page-doc 下发或解析。 */
  pages: CoursewarePreviewPageMeta[];
  page: CoursewarePreviewPage;
  pageIndex: number;
  /** bindingKey → URL(staff 自签 signed URL;H5 为垫片入口 URL,已拼 launch query) */
  bindingUrls: ResolvedBindingUrls;
}

export interface StudioPageSummary {
  id: string;
  pageNo: number;
  title: string;
  aspect: string;
  draftRevisionId: string | null;
  currentRevisionId: string | null;
  adaptClass: "A" | "B" | "C" | "D" | "E" | "F" | null;
}

export interface StudioRevision {
  id: string;
  revisionNo: number;
  origin: string;
  track: CoursewareTrack;
  note: string;
  createdAt: string;
  createdBy: string | null;
  doc: PageDoc;
}

export interface StudioRelease {
  id: string;
  releaseNo: number;
  note: string;
  publishedAt: string;
  publishedBy: string | null;
}

export interface StudioImageAssetUsage {
  sharedAssetId: string;
  name: string;
  useCount: number;
}

/** 编辑器壳数据：草稿优先，其余页面走当前 release/current revision。 */
export async function loadCoursewareStudioPage(lectureId: string, pageDocId: string, track: CoursewareTrack) {
  const supabase = await createClient();
  const { data: lecture, error: lectureError } = await supabase
    .from("course_lectures")
    .select("id, no, name, course_id")
    .eq("id", lectureId)
    .maybeSingle();
  if (lectureError) throw new Error(lectureError.message);
  if (!lecture) return null;

  const { data: pages, error: pagesError } = await supabase
    .from("cw_page_docs")
    .select("id, page_no, title, aspect, draft_revision_id, current_revision_id, adapt_class")
    .eq("lecture_id", lectureId)
    .is("deleted_at", null)
    .order("page_no");
  if (pagesError) throw new Error(pagesError.message);
  const pageIds = (pages ?? []).map((page) => page.id);
  const { data: trackHeads, error: trackHeadsError } = pageIds.length
    ? await supabase.from("cw_page_track_heads").select("page_doc_id,draft_revision_id,current_revision_id").eq("track", track).in("page_doc_id", pageIds)
    : { data: [], error: null };
  if (trackHeadsError) throw new Error(trackHeadsError.message);
  const headByPage = new Map((trackHeads ?? []).map((head) => [head.page_doc_id, head]));
  const typedPages: StudioPageSummary[] = (pages ?? []).flatMap((page) => {
    const head = headByPage.get(page.id);
    if (!head) return [];
    return [{
    id: page.id,
    pageNo: page.page_no,
    title: page.title,
    aspect: track === "adapted-4x3" ? "4:3" : "16:9",
    draftRevisionId: head.draft_revision_id,
    currentRevisionId: head.current_revision_id,
    adaptClass: page.adapt_class as StudioPageSummary["adaptClass"],
  }];
  });
  const page = typedPages.find((item) => item.id === pageDocId);
  if (!page) return null;
  const baseRevisionId = page.draftRevisionId ?? page.currentRevisionId;
  if (!baseRevisionId) throw new Error("PAGE_HAS_NO_BASE_REVISION");

  const [{ data: revisionRows, error: revisionError }, { data: releases, error: releaseError }] = await Promise.all([
    supabase
      .from("cw_page_revisions")
      .select("id, revision_no, origin, note, created_at, created_by, doc, track")
      .eq("page_doc_id", pageDocId)
      .order("revision_no", { ascending: false }),
    supabase
      .from("cw_lecture_releases")
      .select("id, release_no, note, published_at, published_by")
      .eq("lecture_id", lectureId)
      .eq("track", track)
      .order("release_no", { ascending: false }),
  ]);
  if (revisionError) throw new Error(revisionError.message);
  if (releaseError) throw new Error(releaseError.message);
  const revisions: StudioRevision[] = (revisionRows ?? []).filter((revision) => revision.track === track || revision.id === baseRevisionId).map((revision) => ({
    id: revision.id,
    revisionNo: revision.revision_no,
    origin: revision.origin,
    track: revision.track as CoursewareTrack,
    note: revision.note,
    createdAt: revision.created_at,
    createdBy: revision.created_by,
    doc: pageDocSchema.parse(revision.doc),
  }));
  const activeRevision = revisions.find((revision) => revision.id === baseRevisionId);
  if (!activeRevision) throw new Error("PAGE_REVISION_MISSING");
  const releaseHistory: StudioRelease[] = (releases ?? []).map((release) => ({
    id: release.id,
    releaseNo: release.release_no,
    note: release.note,
    publishedAt: release.published_at,
    publishedBy: release.published_by,
  }));
  const [bindingUrls, imageAssetUsage] = await Promise.all([
    resolveEditorBindingUrls(supabase, pageDocId, track),
    loadImageAssetUsage(supabase, pageDocId, track),
  ]);
  const { data: copyTargets, error: copyTargetsError } = await supabase
    .from("course_lectures")
    .select("id, no, name")
    .eq("course_id", lecture.course_id)
    .order("no");
  if (copyTargetsError) throw new Error(copyTargetsError.message);
  return {
    lecture: { id: lecture.id, no: lecture.no, name: lecture.name, courseId: lecture.course_id },
    track,
    pages: typedPages,
    page,
    activeRevision,
    revisions,
    releaseHistory,
    bindingUrls,
    imageAssetUsage,
    copyTargets: (copyTargets ?? []).map((item) => ({ id: item.id, no: item.no, name: item.name })),
  };
}

/** 图片替换前显式展示共享资产及其当前页级引用数，避免误以为会改动所有页面。 */
async function loadImageAssetUsage(supabase: Supabase, pageDocId: string, track: CoursewareTrack): Promise<Record<string, StudioImageAssetUsage>> {
  const { data: pageBindings, error: pageBindingsError } = await supabase
    .from("cw_page_asset_bindings")
    .select("binding_key, shared_asset_id")
    .eq("page_doc_id", pageDocId)
    .eq("track", track)
    .eq("kind", "image");
  if (pageBindingsError) throw new Error(pageBindingsError.message);
  const sharedAssetIds = [...new Set((pageBindings ?? []).map((binding) => binding.shared_asset_id))];
  if (sharedAssetIds.length === 0) return {};

  const [{ data: allBindings, error: allBindingsError }, { data: assets, error: assetsError }] = await Promise.all([
    supabase.from("cw_page_asset_bindings").select("shared_asset_id").eq("track", track).in("shared_asset_id", sharedAssetIds),
    supabase.from("cw_shared_assets").select("id, name").in("id", sharedAssetIds),
  ]);
  if (allBindingsError) throw new Error(allBindingsError.message);
  if (assetsError) throw new Error(assetsError.message);
  const useCountByAsset = new Map<string, number>();
  for (const binding of allBindings ?? []) {
    useCountByAsset.set(binding.shared_asset_id, (useCountByAsset.get(binding.shared_asset_id) ?? 0) + 1);
  }
  const assetNameById = new Map((assets ?? []).map((asset) => [asset.id, asset.name]));
  return Object.fromEntries((pageBindings ?? []).map((binding) => [binding.binding_key, {
    sharedAssetId: binding.shared_asset_id,
    name: assetNameById.get(binding.shared_asset_id) ?? binding.shared_asset_id,
    useCount: useCountByAsset.get(binding.shared_asset_id) ?? 0,
  }]));
}

/** 草稿预览按当前 binding 指针解析；发布后 release 再把版本精确 pin 进快照。 */
async function resolveEditorBindingUrls(supabase: Supabase, pageDocId: string, track: CoursewareTrack): Promise<ResolvedBindingUrls> {
  const { data: bindings, error: bindingError } = await supabase
    .from("cw_page_asset_bindings")
    .select("binding_key, kind, launch_query, pinned_revision_id, shared_asset_id")
    .eq("page_doc_id", pageDocId)
    .eq("track", track);
  if (bindingError) throw new Error(bindingError.message);
  if (!bindings?.length) return {};
  const sharedIds = [...new Set(bindings.map((binding) => binding.shared_asset_id))];
  const [{ data: assets, error: assetError }, { data: variantHeads, error: variantError }] = await Promise.all([
    supabase.from("cw_shared_assets").select("id, published_revision_id").in("id", sharedIds),
    supabase.from("cw_asset_variant_heads").select("shared_asset_id,draft_revision_id,published_revision_id").eq("track", track).in("shared_asset_id", sharedIds),
  ]);
  if (assetError) throw new Error(assetError.message);
  if (variantError) throw new Error(variantError.message);
  const publishedByAsset = new Map((assets ?? []).map((asset) => [asset.id, asset.published_revision_id]));
  const variantByAsset = new Map((variantHeads ?? []).map((head) => [head.shared_asset_id, head.draft_revision_id ?? head.published_revision_id]));
  const entries = bindings.map((binding) => ({
    pageDocId,
    revisionId: "00000000-0000-0000-0000-000000000000",
    bindings: [{ bindingKey: binding.binding_key, assetRevisionId: binding.pinned_revision_id ?? variantByAsset.get(binding.shared_asset_id) ?? publishedByAsset.get(binding.shared_asset_id) }],
  })).filter((entry) => entry.bindings[0].assetRevisionId);
  return resolveSnapshotBindingUrls(
    supabase,
    entries as z.infer<typeof releaseSnapshotSchema>,
    bindings.map((binding) => ({ binding_key: binding.binding_key, kind: binding.kind, launch_query: binding.launch_query })),
  );
}

/**
 * 只读预览数据:讲的 current release 快照 → 页 doc(过冻结 schema)+ 全部绑定的 URL。
 * 渲染的是已发布状态,不是草稿——预览即验收视角(docs/plan/16 P6-4)。
 */
export async function loadLecturePreview(lectureId: string, track: CoursewareTrack, requestedPageIndex?: number): Promise<CoursewareLecturePreview | null> {
  const supabase = await createClient();
  const { data: lecture, error: lectureError } = await supabase
    .from("course_lectures")
    .select("id, no, name, course_id")
    .eq("id", lectureId)
    .maybeSingle();
  if (lectureError) throw new Error(lectureError.message);
  if (!lecture) return null;

  const { data: releaseHead, error: releaseHeadError } = await supabase
    .from("cw_lecture_track_heads")
    .select("current_release_id")
    .eq("lecture_id", lectureId)
    .eq("track", track)
    .maybeSingle();
  if (releaseHeadError) throw new Error(releaseHeadError.message);
  if (!releaseHead?.current_release_id) return null;

  const { data: release, error: releaseError } = await supabase
    .from("cw_lecture_releases")
    .select("id, release_no, published_at, snapshot")
    .eq("id", releaseHead.current_release_id)
    .maybeSingle();
  if (releaseError) throw new Error(releaseError.message);
  if (!release) return null;

  const snapshot = releaseSnapshotSchema.parse(release.snapshot);
  const pageDocIds = snapshot.map((entry) => entry.pageDocId);
  const { data: pageRows, error: pageRowsError } = await supabase
    .from("cw_page_docs")
    .select("id, page_no, title, aspect")
    .in("id", pageDocIds);
  if (pageRowsError) throw new Error(pageRowsError.message);

  const pageById = new Map((pageRows ?? []).map((page) => [page.id, page]));
  const pages: CoursewarePreviewPageMeta[] = snapshot.map((entry) => {
    const page = pageById.get(entry.pageDocId);
    if (!page) throw new Error(`RELEASE_SNAPSHOT_INCOMPLETE: ${entry.pageDocId}`);
    return {
      pageDocId: page.id,
      pageNo: page.page_no,
      title: page.title,
      aspect: track === "adapted-4x3" ? "4:3" : "16:9",
    };
  });
  pages.sort((a, b) => a.pageNo - b.pageNo);

  const pageIndex = Number.isInteger(requestedPageIndex)
    ? Math.min(Math.max(requestedPageIndex!, 1), pages.length)
    : 1;
  const pageMeta = pages[pageIndex - 1];
  if (!pageMeta) throw new Error("RELEASE_HAS_NO_PAGES");
  const snapshotEntry = snapshot.find((entry) => entry.pageDocId === pageMeta.pageDocId);
  if (!snapshotEntry) throw new Error(`RELEASE_SNAPSHOT_INCOMPLETE: ${pageMeta.pageDocId}`);

  const [{ data: revision, error: revisionError }, { data: bindingRows, error: bindingRowsError }] = await Promise.all([
    supabase.from("cw_page_revisions").select("id, doc").eq("id", snapshotEntry.revisionId).maybeSingle(),
    supabase.from("cw_page_asset_bindings").select("binding_key, kind, launch_query").eq("page_doc_id", pageMeta.pageDocId).eq("track", track),
  ]);
  if (revisionError) throw new Error(revisionError.message);
  if (!revision) throw new Error(`RELEASE_SNAPSHOT_INCOMPLETE: ${pageMeta.pageDocId}`);
  if (bindingRowsError) throw new Error(bindingRowsError.message);

  const bindingUrls = await resolveSnapshotBindingUrls(supabase, [snapshotEntry], bindingRows ?? []);
  return {
    lecture: { id: lecture.id, no: lecture.no, name: lecture.name, courseId: lecture.course_id },
    release: { id: release.id, releaseNo: release.release_no, publishedAt: release.published_at },
    pages,
    page: { ...pageMeta, doc: pageDocSchema.parse(revision.doc) },
    pageIndex,
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
  track: CoursewareTrack;
  releaseId: string | null;
  bindings: Array<{ pageDocId: string; bindingKey: string; objectHash: string }>;
}

/**
 * 开课冻结用:把讲次 current release 的快照物化为 courseware_resolved
 * (objectHash 清单)。freeze_session_courseware 对已发布讲次强制校验
 * releaseId 一致,课堂资产签发(list_session_resolved_assets)按 objectHash 取对象。
 */
export async function materializeSessionResolved(releaseId: string, track: CoursewareTrack): Promise<SessionResolvedMeta> {
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
  return { version: "cw-session-resolved-v1", track, releaseId, bindings };
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
