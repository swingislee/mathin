import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { collectPostgrestRowsInBatches } from "@/lib/supabase/postgrest-batches";
import {
  collectCoursewareDocBindingKeys,
  parseCoursewareDoc,
  scopeCoursewareDocBindings,
  type CoursewareDoc,
} from "@/features/courseware-doc/document";
import { buildH5EntryUrl, type H5LaunchQuery, type ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { PAGE_DOC_VERSION } from "@/features/courseware-doc/schema";

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
  "courseware.review",
] as const;

type Supabase = Awaited<ReturnType<typeof createClient>>;

const releaseSnapshotSchema = z.array(
  z.object({
    pageDocId: z.uuid(),
    revisionId: z.uuid(),
    bindings: z.array(z.object({ bindingKey: z.string(), assetRevisionId: z.uuid() })),

    learningCheckEnabled: z.boolean().default(false),
  }),
);

const releaseCoursewarePagesSchema = z.array(z.object({
  id: z.uuid(),
  type: z.literal("doc"),
  docId: z.uuid(),
  title: z.string().trim().min(1).max(100),
}).strict()).min(1).max(200);

const launchQuerySchema = z.object({
  query: z.record(z.string(), z.array(z.string())),
  coursewareIdParam: z.string().nullable(),
});

const h5ManifestSchema = z.object({ entryPath: z.string().min(1) }).loose();

export const COURSEWARE_TASK_TABS = ["incomplete", "recent", "publish"] as const;
export type CoursewareTaskTab = (typeof COURSEWARE_TASK_TABS)[number];

export function parseCoursewareTaskTab(value: string | string[] | undefined): CoursewareTaskTab {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "recent" || first === "publish" ? first : "incomplete";
}

export function parseCoursewareTaskQuery(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim().slice(0, 200) ?? "";
}

export interface CoursewareTaskItem {
  lectureId: string;
  familyId: string;
  familyTitle: string;
  courseId: string;
  courseTitle: string;
  productCode: string | null;
  lectureNo: number;
  lectureName: string;
  track: CoursewareTrack;
  pageCount: number;
  hasDraft: boolean;
  releaseNo: number | null;
  lastEditedAt: string | null;
  lastEditorName: string | null;
}

/** P4H-6 制作任务台：按讲次与轨道返回轻量队列，不下发 page doc 或资源 URL。 */
export async function loadCoursewareTaskQueue(tab: CoursewareTaskTab, query: string): Promise<CoursewareTaskItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_courseware_tasks", {
    p_tab: tab,
    p_query: query,
    p_limit: 60,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((item) => ({
    lectureId: item.lecture_id,
    familyId: item.family_id,
    familyTitle: item.family_title,
    courseId: item.course_id,
    courseTitle: item.course_title,
    productCode: item.product_code,
    lectureNo: item.lecture_no,
    lectureName: item.lecture_name,
    track: item.track as CoursewareTrack,
    pageCount: item.page_count,
    hasDraft: item.has_draft,
    releaseNo: item.release_no,
    lastEditedAt: item.last_edited_at,
    lastEditorName: item.last_editor_name,
  }));
}

const assetLibraryFiltersSchema = z.object({
  query: z.string().trim().max(200).catch(""),
  kind: z.enum(["image", "video", "audio", "svg", "h5"]).nullable().catch(null),
  role: z.string().trim().min(1).max(100).nullable().catch(null),
  track: z.enum(COURSEWARE_TRACKS).catch("native-16x9"),
  minUsage: z.coerce.number().int().min(0).max(1_000_000).catch(0),
  page: z.coerce.number().int().min(1).max(1_000).catch(1),
});

export type AssetLibraryFilters = z.infer<typeof assetLibraryFiltersSchema>;

export function parseAssetLibraryFilters(input: {
  query?: string | string[];
  kind?: string | string[];
  role?: string | string[];
  track?: string | string[];
  minUsage?: string | string[];
  page?: string | string[];
}): AssetLibraryFilters {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  return assetLibraryFiltersSchema.parse({
    query: first(input.query) ?? "",
    kind: first(input.kind) || null,
    role: first(input.role) || null,
    track: first(input.track) ?? "native-16x9",
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
  previewUrl: string | null;
}

export const ASSET_LIBRARY_PAGE_SIZE = 10;

/**
 * 资源库每次只取 10 条，并且只为这 10 条生成预览签名 URL。素材数量会持续增长，
 * 首屏不应因为后台还有更多资源而线性变慢。
 */
export async function loadCoursewareSharedAssets(filters: AssetLibraryFilters) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_cw_shared_assets", {
    p_query: filters.query,
    p_kind: filters.kind ?? undefined,
    p_role: filters.role ?? undefined,
    p_track: filters.track,
    p_min_usage: filters.minUsage,
    p_limit: ASSET_LIBRARY_PAGE_SIZE + 1,
    p_offset: (filters.page - 1) * ASSET_LIBRARY_PAGE_SIZE,
  });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const pageRows = rows.slice(0, ASSET_LIBRARY_PAGE_SIZE);
  const imageRevisionIds = pageRows
    .filter((asset) => asset.kind === "image" && asset.published_revision_id)
    .map((asset) => asset.published_revision_id);
  const previewByRevisionId = new Map<string, string>();
  if (imageRevisionIds.length > 0) {
    const revisions = await collectPostgrestRowsInBatches<string, { id: string; object_id: string }>(imageRevisionIds, (batch) => supabase
      .from("cw_asset_revisions")
      .select("id, object_id")
      .in("id", batch)
      .returns<Array<{ id: string; object_id: string }>>());
    const objectIds = revisions.map((revision) => revision.object_id);
    const objects = await collectPostgrestRowsInBatches<string, { id: string; storage_path: string }>(objectIds, (batch) => supabase
      .from("cw_asset_objects")
      .select("id, storage_path")
      .in("id", batch)
      .returns<Array<{ id: string; storage_path: string }>>());
    const objectById = new Map(objects.map((object) => [object.id, object.storage_path]));
    const paths = revisions.flatMap((revision) => {
      const path = objectById.get(revision.object_id);
      return path ? [path] : [];
    });
    const { data: signed, error: signedError } = paths.length > 0
      ? await supabase.storage.from("cw-objects").createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
      : { data: [], error: null };
    if (signedError) throw new Error(signedError.message);
    const signedByPath = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));
    for (const revision of revisions ?? []) {
      const path = objectById.get(revision.object_id);
      if (path && signedByPath.get(path)) previewByRevisionId.set(revision.id, signedByPath.get(path)!);
    }
  }
  return {
    items: pageRows.map((asset): SharedAssetLibraryItem => ({
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
      previewUrl: previewByRevisionId.get(asset.published_revision_id) ?? null,
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
  track: CoursewareTrack;
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
export async function loadCoursewareSharedAssetDetail(assetId: string, track: CoursewareTrack): Promise<CoursewareSharedAssetDetail | null> {
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
  if (!asset || asset.kind !== "image") return null;

  const [{ data: variant, error: variantError }, { data: usageRows, error: usagesError }, { data: batchRows, error: batchesError }] = await Promise.all([
    supabase
      .from("cw_asset_variant_heads")
      .select("draft_revision_id, published_revision_id")
      .eq("shared_asset_id", assetId)
      .eq("track", track)
      .maybeSingle(),
    supabase.rpc("list_cw_shared_asset_usages", { p_shared_asset_id: assetId, p_track: track }),
    supabase
      .from("cw_replacement_batches")
      .select("id, mode, selected_usage_count, status, note, created_at, rolled_back_at")
      .or(`source_shared_asset_id.eq.${assetId},target_shared_asset_id.eq.${assetId}`)
      .eq("track", track)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (variantError) throw new Error(variantError.message);
  if (usagesError) throw new Error(usagesError.message);
  if (batchesError) throw new Error(batchesError.message);

  const currentRevisionId = variant?.published_revision_id ?? variant?.draft_revision_id ?? asset.published_revision_id;
  if (!currentRevisionId) return null;
  const { data: revision, error: revisionError } = await supabase
    .from("cw_asset_revisions")
    .select("id, revision_no, object_id")
    .eq("id", currentRevisionId)
    .maybeSingle();
  if (revisionError) throw new Error(revisionError.message);
  if (!revision) throw new Error("ASSET_PUBLISHED_REVISION_MISSING");
  const { data: object, error: objectError } = await supabase
    .from("cw_asset_objects")
    .select("sha256, mime, byte_count, width, height, storage_path")
    .eq("id", revision.object_id)
    .maybeSingle();
  if (objectError) throw new Error(objectError.message);
  if (!object) throw new Error("ASSET_OBJECT_MISSING");

  const { data: signed, error: signedError } = await supabase.storage.from("cw-objects").createSignedUrl(object.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signedError) throw new Error(signedError.message);
  return {
    track,
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
export interface CoursewarePreviewPage {
  pageDocId: string;
  pageNo: number;
  title: string;
  aspect: string;
  doc: CoursewareDoc;
}

export interface CoursewarePreviewPageMeta {
  pageDocId: string;
  pageNo: number;
  title: string;
  aspect: string;
}

export interface CoursewareLecturePreview {
  track: CoursewareTrack;
  lecture: { id: string; no: number; name: string; courseId: string };
  release: { id: string; releaseNo: number; publishedAt: string };
  /** 导航只需轻量元数据；不把整讲 page-doc 下发或解析。 */
  pages: CoursewarePreviewPageMeta[];
  page: CoursewarePreviewPage;
  pageIndex: number;
  /** bindingKey → URL(staff 自签 signed URL;H5 为垫片入口 URL,已拼 launch query) */
  bindingUrls: ResolvedBindingUrls;
}

export interface CoursewarePreviewPagePayload {
  page: CoursewarePreviewPage;
  bindingUrls: ResolvedBindingUrls;
}

export interface CoursewareWorkbenchContext {
  family: { id: string; title: string };
  course: { id: string; title: string; productCode: string | null };
  lecture: { id: string; no: number; name: string; courseId: string };
  firstPageDocId: string | null;
}

/** 唯一 workbench 的最小壳数据：面包屑与默认页，不读取任何 page doc 或资产 URL。 */
export async function loadCoursewareWorkbenchContext(lectureId: string): Promise<CoursewareWorkbenchContext | null> {
  const parsedLectureId = z.uuid().safeParse(lectureId);
  if (!parsedLectureId.success) return null;
  const supabase = await createClient();
  const { data: lecture, error: lectureError } = await supabase
    .from("course_lectures")
    .select("id, no, name, course_id")
    .eq("id", parsedLectureId.data)
    .maybeSingle();
  if (lectureError) throw new Error(lectureError.message);
  if (!lecture) return null;

  const [{ data: course, error: courseError }, { data: pages, error: pagesError }] = await Promise.all([
    supabase.from("courses").select("id, title, product_code, family_id").eq("id", lecture.course_id).maybeSingle(),
    supabase
      .from("cw_page_docs")
      .select("id")
      .eq("lecture_id", lecture.id)
      .is("deleted_at", null)
      .order("page_no")
      .limit(1),
  ]);
  if (courseError) throw new Error(courseError.message);
  if (pagesError) throw new Error(pagesError.message);
  if (!course) return null;

  const { data: family, error: familyError } = await supabase
    .from("course_families")
    .select("id, title")
    .eq("id", course.family_id)
    .maybeSingle();
  if (familyError) throw new Error(familyError.message);
  if (!family) return null;

  return {
    family: { id: family.id, title: family.title },
    course: { id: course.id, title: course.title, productCode: course.product_code },
    lecture: { id: lecture.id, no: lecture.no, name: lecture.name, courseId: lecture.course_id },
    firstPageDocId: pages?.[0]?.id ?? null,
  };
}

export interface StudioPageSummary {
  id: string;
  pageNo: number;
  title: string;
  aspect: string;
  draftRevisionId: string | null;
  currentRevisionId: string | null;
  adaptClass: "A" | "B" | "C" | "D" | "E" | "F" | null;

  learningCheckEnabled: boolean;
  learningCheckFlagDirty: boolean;
}




export interface StudioRevision {
  id: string;
  revisionNo: number;
  origin: string;
  track: CoursewareTrack;
  layoutProfile: "legacy-16x9-import" | "legacy-4x3-adaptation" | "standard-4x3" | "wide-16x9-exception";
  note: string;
  createdAt: string;
  createdBy: string | null;
  doc: CoursewareDoc;
}

function aspectForLayoutProfile(layoutProfile: string | null | undefined, track: CoursewareTrack): string {
  if (layoutProfile === "standard-4x3" || layoutProfile === "legacy-4x3-adaptation") return "4:3";
  if (layoutProfile === "wide-16x9-exception") return "16:9";
  // Legacy imports intentionally let the adapted track reuse the immutable native revision.
  // Its delivery surface is nevertheless the 4:3 compatibility/source-master board.
  if (layoutProfile === "legacy-16x9-import") return track === "adapted-4x3" ? "4:3" : "16:9";
  return track === "adapted-4x3" ? "4:3" : "16:9";
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

export interface CoursewareStudioRenderPagePayload {
  revisionId: string;
  doc: CoursewareDoc;
  bindingUrls: ResolvedBindingUrls;
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
  const [trackHeads, learningCheckRows] = pageIds.length
    ? await Promise.all([
      collectPostgrestRowsInBatches<string, {
        page_doc_id: string;
        draft_revision_id: string | null;
        current_revision_id: string | null;
        draft_layout_profile: string | null;
        current_layout_profile: string | null;
      }>(pageIds, (batch) => supabase
        .from("cw_page_track_heads")
        .select("page_doc_id,draft_revision_id,current_revision_id,draft_layout_profile,current_layout_profile")
        .eq("track", track)
        .in("page_doc_id", batch)
        .returns<Array<{
          page_doc_id: string;
          draft_revision_id: string | null;
          current_revision_id: string | null;
          draft_layout_profile: string | null;
          current_layout_profile: string | null;
        }>>()),
      collectPostgrestRowsInBatches<string, {
        page_doc_id: string;
        draft_enabled: boolean;
        published_enabled: boolean;
      }>(pageIds, (batch) => supabase
        .from("cw_page_learning_check_flags")
        .select("page_doc_id,draft_enabled,published_enabled")
        .eq("track", track)
        .in("page_doc_id", batch)
        .returns<Array<{
          page_doc_id: string;
          draft_enabled: boolean;
          published_enabled: boolean;
        }>>()),
    ])
    : [[], []];
  const headByPage = new Map(trackHeads.map((head) => [head.page_doc_id, head]));
  const learningCheckByPage = new Map(learningCheckRows.map((metadata) => [metadata.page_doc_id, metadata]));
  const typedPages: StudioPageSummary[] = (pages ?? []).flatMap((page) => {
    const head = headByPage.get(page.id);
    if (!head) return [];
    const metadata = learningCheckByPage.get(page.id);
    return [{
    id: page.id,
    pageNo: page.page_no,
    title: page.title,
    aspect: aspectForLayoutProfile(head.draft_layout_profile ?? head.current_layout_profile, track),
    draftRevisionId: head.draft_revision_id,
    currentRevisionId: head.current_revision_id,
    adaptClass: page.adapt_class as StudioPageSummary["adaptClass"],

    learningCheckEnabled: metadata?.draft_enabled ?? metadata?.published_enabled ?? false,
    learningCheckFlagDirty: metadata?.draft_enabled !== null && metadata?.draft_enabled !== undefined,
  }];
  });
  const page = typedPages.find((item) => item.id === pageDocId);
  if (!page) return null;
  const baseRevisionId = page.draftRevisionId ?? page.currentRevisionId;
  if (!baseRevisionId) throw new Error("PAGE_HAS_NO_BASE_REVISION");

  const { data: revisionRows, error: revisionError } = await supabase
    .from("cw_page_revisions")
    .select("id, revision_no, origin, note, created_at, created_by, doc, track, doc_version, layout_profile")
    .eq("page_doc_id", pageDocId)
    .order("revision_no", { ascending: false });
  if (revisionError) throw new Error(revisionError.message);
  const revisions: StudioRevision[] = (revisionRows ?? []).filter((revision) =>
    revision.id === baseRevisionId
    || (revision.doc_version === "spatial-page-v1"
      ? revision.layout_profile === "standard-4x3" || track === "native-16x9"
      : revision.track === track),
  ).map((revision) => ({
    id: revision.id,
    revisionNo: revision.revision_no,
    origin: revision.origin,
    track: revision.track as CoursewareTrack,
    layoutProfile: revision.layout_profile as StudioRevision["layoutProfile"],
    note: revision.note,
    createdAt: revision.created_at,
    createdBy: revision.created_by,
    doc: parseCoursewareDoc(revision.doc),
  }));
  const activeRevision = revisions.find((revision) => revision.id === baseRevisionId);
  if (!activeRevision) throw new Error("PAGE_REVISION_MISSING");
  const common = {
    lecture: { id: lecture.id, no: lecture.no, name: lecture.name, courseId: lecture.course_id },
    track,
    pages: typedPages,
    page,
    activeRevision,
    revisions,
  };

  // Only page-doc-v1 enters CoursewarePageEditor. Source runtimes and other
  // dedicated renderers are read-only here, so editor-only usage/history/copy
  // queries would add latency without contributing anything to their output.
  if (activeRevision.doc.docVersion !== PAGE_DOC_VERSION) {
    return {
      ...common,
      releaseHistory: [],
      bindingUrls: await resolveEditorBindingUrls(
        supabase,
        pageDocId,
        track,
        collectCoursewareDocBindingKeys(activeRevision.doc) ?? undefined,
      ),
      imageAssetUsage: {},
      copyTargets: [],
    };
  }

  const [
    { data: releases, error: releaseError },
    bindingUrls,
    imageAssetUsage,
    { data: copyTargets, error: copyTargetsError },
  ] = await Promise.all([
    supabase
      .from("cw_lecture_releases")
      .select("id, release_no, note, published_at, published_by")
      .eq("lecture_id", lectureId)
      .eq("track", track)
      .order("release_no", { ascending: false }),
    resolveEditorBindingUrls(
      supabase,
      pageDocId,
      track,
      collectCoursewareDocBindingKeys(activeRevision.doc) ?? undefined,
    ),
    loadImageAssetUsage(supabase, pageDocId, track),
    supabase
      .from("course_lectures")
      .select("id, no, name")
      .eq("course_id", lecture.course_id)
      .order("no"),
  ]);
  if (releaseError) throw new Error(releaseError.message);
  if (copyTargetsError) throw new Error(copyTargetsError.message);
  return {
    ...common,
    releaseHistory: (releases ?? []).map((release): StudioRelease => ({
      id: release.id,
      releaseNo: release.release_no,
      note: release.note,
      publishedAt: release.published_at,
      publishedBy: release.published_by,
    })),
    bindingUrls,
    imageAssetUsage,
    copyTargets: (copyTargets ?? []).map((item) => ({ id: item.id, no: item.no, name: item.name })),
  };
}

/**
 * Studio 页内切换只读取目标 revision 与其绑定。
 *
 * 讲次、目录、全部 page heads 与权限已经由首个 Server Component 请求建立；
 * 翻页时重跑整条 workbench loader 只会卸载舞台并重复读取稳定数据。
 */
export async function loadCoursewareStudioRenderPage(
  pageDocId: string,
  revisionId: string,
  track: CoursewareTrack,
  client?: Supabase,
): Promise<CoursewareStudioRenderPagePayload> {
  const supabase = client ?? await createClient();
  const { data: revision, error: revisionError } = await supabase
    .from("cw_page_revisions")
    .select("id, doc")
    .eq("id", revisionId)
    .eq("page_doc_id", pageDocId)
    .maybeSingle();
  if (revisionError) throw new Error(revisionError.message);
  if (!revision) throw new Error("PAGE_REVISION_MISSING");
  const doc = parseCoursewareDoc(revision.doc);
  const bindingUrls = await resolveEditorBindingUrls(
    supabase,
    pageDocId,
    track,
    collectCoursewareDocBindingKeys(doc) ?? undefined,
  );
  return {
    revisionId: revision.id,
    doc,
    bindingUrls,
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

  const [allBindings, assets] = await Promise.all([
    collectPostgrestRowsInBatches<string, { shared_asset_id: string }>(sharedAssetIds, (batch) => supabase
      .from("cw_page_asset_bindings")
      .select("shared_asset_id")
      .eq("track", track)
      .in("shared_asset_id", batch)
      .returns<Array<{ shared_asset_id: string }>>()),
    collectPostgrestRowsInBatches<string, { id: string; name: string }>(sharedAssetIds, (batch) => supabase
      .from("cw_shared_assets")
      .select("id, name")
      .in("id", batch)
      .returns<Array<{ id: string; name: string }>>()),
  ]);
  const useCountByAsset = new Map<string, number>();
  for (const binding of allBindings) {
    useCountByAsset.set(binding.shared_asset_id, (useCountByAsset.get(binding.shared_asset_id) ?? 0) + 1);
  }
  const assetNameById = new Map(assets.map((asset) => [asset.id, asset.name]));
  return Object.fromEntries((pageBindings ?? []).map((binding) => [binding.binding_key, {
    sharedAssetId: binding.shared_asset_id,
    name: assetNameById.get(binding.shared_asset_id) ?? binding.shared_asset_id,
    useCount: useCountByAsset.get(binding.shared_asset_id) ?? 0,
  }]));
}

/** 草稿预览按当前 binding 指针解析；发布后 release 再把版本精确 pin 进快照。 */
async function resolveEditorBindingUrls(
  supabase: Supabase,
  pageDocId: string,
  track: CoursewareTrack,
  requiredBindingKeys?: ReadonlySet<string>,
): Promise<ResolvedBindingUrls> {
  if (requiredBindingKeys?.size === 0) return {};
  let bindingQuery = supabase
    .from("cw_page_asset_bindings")
    .select("binding_key, kind, launch_query, pinned_revision_id, shared_asset_id")
    .eq("page_doc_id", pageDocId)
    .eq("track", track);
  if (requiredBindingKeys) bindingQuery = bindingQuery.in("binding_key", [...requiredBindingKeys]);
  const { data: bindings, error: bindingError } = await bindingQuery;
  if (bindingError) throw new Error(bindingError.message);
  if (requiredBindingKeys) {
    const available = new Set((bindings ?? []).map((binding) => binding.binding_key));
    const missing = [...requiredBindingKeys].filter((bindingKey) => !available.has(bindingKey));
    if (missing.length > 0) throw new Error(`COURSEWARE_DOC_BINDING_MISSING: ${missing.join(",")}`);
  }
  if (!bindings?.length) return {};
  const sharedIds = [...new Set(bindings.map((binding) => binding.shared_asset_id))];
  const [assets, variantHeads] = await Promise.all([
    collectPostgrestRowsInBatches<string, { id: string; published_revision_id: string | null }>(sharedIds, (batch) => supabase
      .from("cw_shared_assets")
      .select("id, published_revision_id")
      .in("id", batch)
      .returns<Array<{ id: string; published_revision_id: string | null }>>()),
    collectPostgrestRowsInBatches<string, {
      shared_asset_id: string;
      draft_revision_id: string | null;
      published_revision_id: string | null;
    }>(sharedIds, (batch) => supabase
      .from("cw_asset_variant_heads")
      .select("shared_asset_id,draft_revision_id,published_revision_id")
      .eq("track", track)
      .in("shared_asset_id", batch)
      .returns<Array<{
        shared_asset_id: string;
        draft_revision_id: string | null;
        published_revision_id: string | null;
      }>>()),
  ]);
  const publishedByAsset = new Map(assets.map((asset) => [asset.id, asset.published_revision_id]));
  const variantByAsset = new Map(variantHeads.map((head) => [head.shared_asset_id, head.draft_revision_id ?? head.published_revision_id]));
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
export async function loadLecturePreview(
  lectureId: string,
  track: CoursewareTrack,
  requestedPage?: number | string,
): Promise<CoursewareLecturePreview | null> {
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
    .select("id, release_no, published_at, snapshot, courseware_pages")
    .eq("id", releaseHead.current_release_id)
    .maybeSingle();
  if (releaseError) throw new Error(releaseError.message);
  if (!release) return null;

  const snapshot = releaseSnapshotSchema.parse(release.snapshot);
  const releasePages = releaseCoursewarePagesSchema.parse(release.courseware_pages);
  if (releasePages.length !== snapshot.length) throw new Error("RELEASE_SNAPSHOT_INCOMPLETE");
  const revisionIds = snapshot.map((entry) => entry.revisionId);
  const revisionLayouts = await collectPostgrestRowsInBatches<string, { id: string; layout_profile: string }>(
    revisionIds,
    (batch) => supabase
      .from("cw_page_revisions")
      .select("id,layout_profile")
      .in("id", batch)
      .returns<Array<{ id: string; layout_profile: string }>>(),
  );
  const layoutByRevision = new Map(revisionLayouts.map((revision) => [revision.id, revision.layout_profile]));
  const pages: CoursewarePreviewPageMeta[] = snapshot.map((entry, index) => {
    const page = releasePages[index];
    if (!page || page.id !== entry.pageDocId || page.docId !== entry.pageDocId) {
      throw new Error(`RELEASE_SNAPSHOT_INCOMPLETE: ${entry.pageDocId}`);
    }
    return {
      pageDocId: page.id,
      pageNo: index + 1,
      title: page.title,
      aspect: aspectForLayoutProfile(layoutByRevision.get(entry.revisionId), track),
    };
  });

  const requestedPageIndex = typeof requestedPage === "string"
    ? pages.findIndex((page) => page.pageDocId === requestedPage) + 1
    : requestedPage;
  const pageIndex = Number.isInteger(requestedPageIndex) && requestedPageIndex! > 0
    ? Math.min(requestedPageIndex!, pages.length)
    : 1;
  const pageMeta = pages[pageIndex - 1];
  if (!pageMeta) throw new Error("RELEASE_HAS_NO_PAGES");
  const snapshotEntry = snapshot.find((entry) => entry.pageDocId === pageMeta.pageDocId);
  if (!snapshotEntry) throw new Error(`RELEASE_SNAPSHOT_INCOMPLETE: ${pageMeta.pageDocId}`);

  const loadedPage = await materializeLecturePreviewPage(supabase, track, pageMeta, snapshotEntry);
  return {
    track,
    lecture: { id: lecture.id, no: lecture.no, name: lecture.name, courseId: lecture.course_id },
    release: { id: release.id, releaseNo: release.release_no, publishedAt: release.published_at },
    pages,
    page: loadedPage.page,
    pageIndex,
    bindingUrls: loadedPage.bindingUrls,
  };
}

/**
 * Load one additional page from the immutable release already opened by a
 * preview. This deliberately skips lecture/head/catalog reads so client-side
 * page turns can fetch and cache only the missing page instead of rerendering
 * the entire route.
 */
export async function loadLecturePreviewPage(
  releaseId: string,
  track: CoursewareTrack,
  pageDocId: string,
  client?: Supabase,
): Promise<CoursewarePreviewPagePayload> {
  const supabase = client ?? await createClient();
  const { data: release, error } = await supabase
    .from("cw_lecture_releases")
    .select("id, track, snapshot, courseware_pages")
    .eq("id", releaseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!release) throw new Error("RELEASE_NOT_FOUND");
  if (release.track !== track) throw new Error("RELEASE_TRACK_MISMATCH");

  const snapshot = releaseSnapshotSchema.parse(release.snapshot);
  const releasePages = releaseCoursewarePagesSchema.parse(release.courseware_pages);
  if (releasePages.length !== snapshot.length) throw new Error("RELEASE_SNAPSHOT_INCOMPLETE");
  const pageIndex = snapshot.findIndex((entry) => entry.pageDocId === pageDocId);
  const snapshotEntry = snapshot[pageIndex];
  const releasePage = releasePages[pageIndex];
  if (!snapshotEntry || !releasePage) throw new Error("PREVIEW_PAGE_NOT_FOUND");
  if (releasePage.id !== snapshotEntry.pageDocId || releasePage.docId !== snapshotEntry.pageDocId) {
    throw new Error(`RELEASE_SNAPSHOT_INCOMPLETE: ${snapshotEntry.pageDocId}`);
  }

  return materializeLecturePreviewPage(supabase, track, {
    pageDocId: releasePage.id,
    pageNo: pageIndex + 1,
    title: releasePage.title,
  }, snapshotEntry);
}

async function materializeLecturePreviewPage(
  supabase: Supabase,
  track: CoursewareTrack,
  pageMeta: Omit<CoursewarePreviewPageMeta, "aspect"> & { aspect?: string },
  snapshotEntry: z.infer<typeof releaseSnapshotSchema>[number],
): Promise<CoursewarePreviewPagePayload> {
  const { data: revision, error: revisionError } = await supabase
    .from("cw_page_revisions")
    .select("id, doc, layout_profile")
    .eq("id", snapshotEntry.revisionId)
    .maybeSingle();
  if (revisionError) throw new Error(revisionError.message);
  if (!revision) throw new Error(`RELEASE_SNAPSHOT_INCOMPLETE: ${pageMeta.pageDocId}`);
  const doc = parseCoursewareDoc(revision.doc);
  const requiredBindingKeys = collectCoursewareDocBindingKeys(doc);
  const scopedSnapshotEntry = requiredBindingKeys === null
    ? snapshotEntry
    : { ...snapshotEntry, bindings: scopeCoursewareDocBindings(doc, snapshotEntry.bindings) };
  let bindingRows: Array<{ binding_key: string; kind: string; launch_query: unknown }> = [];
  if (requiredBindingKeys === null || requiredBindingKeys.size > 0) {
    let bindingQuery = supabase
      .from("cw_page_asset_bindings")
      .select("binding_key, kind, launch_query")
      .eq("page_doc_id", pageMeta.pageDocId)
      .eq("track", track);
    if (requiredBindingKeys !== null) bindingQuery = bindingQuery.in("binding_key", [...requiredBindingKeys]);
    const result = await bindingQuery;
    if (result.error) throw new Error(result.error.message);
    bindingRows = result.data ?? [];
  }
  const scopedBindingRows = requiredBindingKeys === null
    ? bindingRows
    : scopeCoursewareDocBindings(
      doc,
      bindingRows.map((binding) => ({ ...binding, bindingKey: binding.binding_key })),
    );

  const bindingUrls = await resolveSnapshotBindingUrls(supabase, [scopedSnapshotEntry], scopedBindingRows);
  return {
    page: {
      ...pageMeta,
      aspect: pageMeta.aspect ?? aspectForLayoutProfile(revision.layout_profile, track),
      doc,
    },
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

  const revisions = await collectPostgrestRowsInBatches<string, {
    id: string;
    object: { sha256: string; storage_path: string; kind: string } | null;
  }>(assetRevisionIds, (batch) => supabase
    .from("cw_asset_revisions")
    .select("id, object:cw_asset_objects!cw_asset_revisions_object_id_fkey(sha256, storage_path, kind)")
    .in("id", batch)
    .returns<Array<{
      id: string;
      object: { sha256: string; storage_path: string; kind: string } | null;
    }>>());
  const objectByRevisionId = new Map(revisions.map((revision) => [revision.id, revision.object]));

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
  learningCheckPages: Array<{
    pageDocId: string;

    learningCheckEnabled: boolean;
  }>;
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
  const revisions = await collectPostgrestRowsInBatches<string, {
    id: string;
    object: { sha256: string } | null;
  }>(assetRevisionIds, (batch) => supabase
    .from("cw_asset_revisions")
    .select("id, object:cw_asset_objects!cw_asset_revisions_object_id_fkey(sha256)")
    .in("id", batch));
  const hashByRevisionId = new Map<string, string>();
  for (const revision of revisions) {
    if (revision.object?.sha256) hashByRevisionId.set(revision.id, revision.object.sha256);
  }
  const bindings = snapshot.flatMap((entry) =>
    entry.bindings.map((binding) => {
      const objectHash = hashByRevisionId.get(binding.assetRevisionId);
      if (!objectHash) throw new Error(`RELEASE_ASSET_REVISION_MISSING: ${binding.assetRevisionId}`);
      return { pageDocId: entry.pageDocId, bindingKey: binding.bindingKey, objectHash };
    }),
  );
  return {
    version: "cw-session-resolved-v1",
    track,
    releaseId,
    bindings,
    learningCheckPages: snapshot.map((entry) => ({
      pageDocId: entry.pageDocId,

      learningCheckEnabled: entry.learningCheckEnabled,
    })),
  };
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
