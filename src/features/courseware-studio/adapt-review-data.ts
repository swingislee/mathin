import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { collectPostgrestRowsInBatches } from "@/lib/supabase/postgrest-batches";
import type { AdaptClass, AdaptRejectionCode } from "./adapt-review-shared";

export const ADAPT_REVIEW_PAGE_SIZE = 24;

type UntypedRpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return (supabase.rpc as UntypedRpc).bind(supabase);
}

export interface AdaptReviewFilters {
  courseId: string | null;
  lectureId: string | null;
}

export interface AdaptReviewCourseOption {
  id: string;
  title: string;
  productCode: string | null;
}

export interface AdaptReviewLectureOption {
  id: string;
  courseId: string;
  no: number;
  name: string;
}

export interface AdaptReviewFilterOptions {
  courses: AdaptReviewCourseOption[];
  lectures: AdaptReviewLectureOption[];
}

export interface AdaptReviewImage {
  url: string;
  width: number | null;
  height: number | null;
  mime: string;
}

export interface AdaptReviewItem {
  id: string;
  cropX: number;
  cropY: number;
  source: AdaptReviewImage;
  derived: AdaptReviewImage;
  pageCount: number;
}

export interface AdaptReviewQueue {
  items: AdaptReviewItem[];
  page: number;
  total: number;
  totalPages: number;
}

export interface AdaptReworkQueueItem extends AdaptReviewItem {
  rejectionCode: AdaptRejectionCode;
  note: string;
  reviewedAt: string;
  courseCount: number;
  lectureCount: number;
  pageDocId: string;
  courseId: string;
  courseTitle: string;
  lectureId: string;
  lectureNo: number;
  lectureName: string;
  pageNo: number;
}

export interface AdaptReworkQueue {
  items: AdaptReworkQueueItem[];
  page: number;
  total: number;
  totalPages: number;
}

export interface AdaptBackgroundHistoryItem {
  id: string;
  status: "rejected" | "superseded";
  rejectionCode: AdaptRejectionCode | null;
  note: string;
  cropX: number;
  cropY: number;
  sourceAssetRevisionId: string;
  derivedAssetRevisionId: string;
  supersedesId: string | null;
  supersededById: string | null;
  successorStatus: string | null;
  reviewedAt: string | null;
  pageCount: number;
  courseId: string | null;
  courseTitle: string | null;
  lectureId: string | null;
  lectureNo: number | null;
  lectureName: string | null;
  pageNo: number | null;
}

export interface AdaptBackgroundHistory {
  items: AdaptBackgroundHistoryItem[];
  page: number;
  total: number;
  totalPages: number;
}

export interface AdaptPageQueueItem {
  id: string;
  courseId: string;
  courseTitle: string;
  lectureId: string;
  lectureNo: number;
  lectureName: string;
  pageNo: number;
  title: string;
  adaptClass: AdaptClass;
  adaptReason: string;
}

export interface AdaptPageQueue {
  items: AdaptPageQueueItem[];
  page: number;
  total: number;
  totalPages: number;
  classification: AdaptClass | "all";
}

export type AdaptReleaseScope = "pending" | "published" | "all";

export interface AdaptReleaseQueueItem {
  lectureId: string;
  courseId: string;
  courseTitle: string;
  productCode: string | null;
  lectureNo: number;
  lectureName: string;
  pageCount: number;
  currentReleaseNo: number | null;
  hasUnpublishedChanges: boolean;
  blockedBackgroundCount: number;
  ready: boolean;
}

export interface AdaptReleaseQueue {
  items: AdaptReleaseQueueItem[];
  page: number;
  total: number;
  totalPages: number;
  scope: AdaptReleaseScope;
}

export function parseAdaptReviewPage(value: string | string[] | undefined): number {
  const first = Array.isArray(value) ? value[0] : value;
  return z.coerce.number().int().min(1).max(10_000).catch(1).parse(first ?? "1");
}

export function parseAdaptClass(value: string | string[] | undefined): AdaptClass | "all" {
  const first = Array.isArray(value) ? value[0] : value;
  return z.enum(["A", "B", "C", "D", "E", "F", "all"]).catch("D").parse(first ?? "D");
}

export function parseAdaptReleaseScope(value: string | string[] | undefined): AdaptReleaseScope {
  const first = Array.isArray(value) ? value[0] : value;
  return z.enum(["pending", "published", "all"]).catch("pending").parse(first ?? "pending");
}

export function parseAdaptFilterId(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return z.string().uuid().nullable().catch(null).parse(first ?? null);
}

export async function loadAdaptReviewFilterOptions(courseId: string | null): Promise<AdaptReviewFilterOptions> {
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("get_cw_adapt_filter_options", { p_course_id: courseId });
  if (error) throw new Error(error.message);
  return z.object({
    courses: z.array(z.object({ id: z.string().uuid(), title: z.string(), productCode: z.string().nullable() })),
    lectures: z.array(z.object({ id: z.string().uuid(), courseId: z.string().uuid(), no: z.number().int(), name: z.string() })),
  }).parse(data);
}

/** 只签发当前页的两组私有 CAS URL；分页和课程/讲次聚合均在数据库完成。 */
export async function loadAdaptReviewQueue(requestedPage: number, filters: AdaptReviewFilters): Promise<AdaptReviewQueue> {
  const supabase = await createClient();
  const loadRows = async (page: number) => {
    const { data, error } = await rpc(supabase)("list_cw_adapt_background_review_queue", {
      p_course_id: filters.courseId,
      p_lecture_id: filters.lectureId,
      p_offset: (page - 1) * ADAPT_REVIEW_PAGE_SIZE,
      p_limit: ADAPT_REVIEW_PAGE_SIZE,
    });
    if (error) throw new Error(error.message);
    return z.array(z.object({
      id: z.string().uuid(),
      crop_x: z.number().int(),
      crop_y: z.number().int(),
      source_asset_revision_id: z.string().uuid(),
      derived_asset_revision_id: z.string().uuid(),
      page_count: z.number().int().nonnegative(),
      total_count: z.number().int().nonnegative(),
    })).parse(data ?? []);
  };

  let rows = await loadRows(requestedPage);
  const total = rows[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ADAPT_REVIEW_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  if (page !== requestedPage) rows = await loadRows(page);

  const revisionIds = [...new Set(rows.flatMap((row) => [row.source_asset_revision_id, row.derived_asset_revision_id]))];
  if (revisionIds.length === 0) return { items: [], page, total, totalPages };
  const revisions = await collectPostgrestRowsInBatches<string, { id: string; object_id: string }>(revisionIds, (batch) => supabase
    .from("cw_asset_revisions")
    .select("id,object_id")
    .in("id", batch)
    .returns<Array<{ id: string; object_id: string }>>());
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  if (revisionById.size !== revisionIds.length) throw new Error("ADAPT_REVIEW_REVISION_MISSING");
  const objectIds = [...new Set(revisionIds.map((id) => revisionById.get(id)?.object_id).filter((id): id is string => Boolean(id)))];
  if (objectIds.length !== revisionIds.length) throw new Error("ADAPT_REVIEW_REVISION_OBJECT_MISSING");

  const objects = await collectPostgrestRowsInBatches<string, {
    id: string;
    storage_path: string;
    width: number;
    height: number;
    mime: string;
  }>(objectIds, (batch) => supabase
    .from("cw_asset_objects")
    .select("id,storage_path,width,height,mime")
    .in("id", batch)
    .returns<Array<{ id: string; storage_path: string; width: number; height: number; mime: string }>>());
  const objectById = new Map(objects.map((object) => [object.id, object]));
  if (objectById.size !== objectIds.length) throw new Error("ADAPT_REVIEW_OBJECT_MISSING");

  const paths = [...new Set(objectIds.map((id) => objectById.get(id)?.storage_path).filter((path): path is string => Boolean(path)))];
  const { data: signed, error: signedError } = await supabase.storage.from("cw-objects").createSignedUrls(paths, 60 * 60);
  if (signedError) throw new Error(signedError.message);
  const urlByPath = new Map<string, string>();
  for (const item of signed ?? []) if (item.path && item.signedUrl && !item.error) urlByPath.set(item.path, item.signedUrl);

  const imageForRevision = (revisionId: string): AdaptReviewImage => {
    const revision = revisionById.get(revisionId);
    const object = revision ? objectById.get(revision.object_id) : null;
    const url = object ? urlByPath.get(object.storage_path) : null;
    if (!object || !url) throw new Error("ADAPT_REVIEW_SIGNED_URL_MISSING");
    return { url, width: object.width, height: object.height, mime: object.mime };
  };

  return {
    items: rows.map((row) => ({
      id: row.id,
      cropX: row.crop_x,
      cropY: row.crop_y,
      source: imageForRevision(row.source_asset_revision_id),
      derived: imageForRevision(row.derived_asset_revision_id),
      pageCount: row.page_count,
    })),
    page,
    total,
    totalPages,
  };
}

/** 页面队列默认 D 类；课程/讲次筛选与分页在单个 RPC 内完成。 */
export async function loadAdaptPageQueue(
  requestedPage: number,
  classification: AdaptClass | "all",
  filters: AdaptReviewFilters,
): Promise<AdaptPageQueue> {
  const supabase = await createClient();
  const loadRows = async (page: number) => {
    const { data, error } = await rpc(supabase)("list_cw_adapt_page_review_queue", {
      p_classification: classification,
      p_course_id: filters.courseId,
      p_lecture_id: filters.lectureId,
      p_offset: (page - 1) * ADAPT_REVIEW_PAGE_SIZE,
      p_limit: ADAPT_REVIEW_PAGE_SIZE,
    });
    if (error) throw new Error(error.message);
    return z.array(z.object({
      id: z.string().uuid(),
      course_id: z.string().uuid(),
      course_title: z.string(),
      lecture_id: z.string().uuid(),
      lecture_no: z.number().int(),
      lecture_name: z.string(),
      page_no: z.number().int(),
      title: z.string(),
      adapt_class: z.enum(["A", "B", "C", "D", "E", "F"]),
      adapt_reason: z.string(),
      total_count: z.number().int().nonnegative(),
    })).parse(data ?? []);
  };
  let rows = await loadRows(requestedPage);
  const total = rows[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ADAPT_REVIEW_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  if (page !== requestedPage) rows = await loadRows(page);
  return {
    items: rows.map((item) => ({
      id: item.id,
      courseId: item.course_id,
      courseTitle: item.course_title,
      lectureId: item.lecture_id,
      lectureNo: item.lecture_no,
      lectureName: item.lecture_name,
      pageNo: item.page_no,
      title: item.title,
      adaptClass: item.adapt_class,
      adaptReason: item.adapt_reason,
    })),
    page,
    total,
    totalPages,
    classification,
  };
}

export async function loadAdaptReleaseQueue(
  requestedPage: number,
  scope: AdaptReleaseScope,
  filters: AdaptReviewFilters,
): Promise<AdaptReleaseQueue> {
  const supabase = await createClient();
  const loadRows = async (page: number) => {
    const { data, error } = await rpc(supabase)("list_cw_adapt_release_queue", {
      p_course_id: filters.courseId,
      p_lecture_id: filters.lectureId,
      p_scope: scope,
      p_offset: (page - 1) * ADAPT_REVIEW_PAGE_SIZE,
      p_limit: ADAPT_REVIEW_PAGE_SIZE,
    });
    if (error) throw new Error(error.message);
    return z.array(z.object({
      lecture_id: z.string().uuid(),
      course_id: z.string().uuid(),
      course_title: z.string(),
      product_code: z.string().nullable(),
      lecture_no: z.number().int(),
      lecture_name: z.string(),
      page_count: z.number().int().nonnegative(),
      current_release_no: z.number().int().positive().nullable(),
      has_unpublished_changes: z.boolean(),
      blocked_background_count: z.number().int().nonnegative(),
      ready: z.boolean(),
      total_count: z.number().int().nonnegative(),
    })).parse(data ?? []);
  };
  let rows = await loadRows(requestedPage);
  const total = rows[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ADAPT_REVIEW_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  if (page !== requestedPage) rows = await loadRows(page);
  return {
    items: rows.map((item) => ({
      lectureId: item.lecture_id,
      courseId: item.course_id,
      courseTitle: item.course_title,
      productCode: item.product_code,
      lectureNo: item.lecture_no,
      lectureName: item.lecture_name,
      pageCount: item.page_count,
      currentReleaseNo: item.current_release_no,
      hasUnpublishedChanges: item.has_unpublished_changes,
      blockedBackgroundCount: item.blocked_background_count,
      ready: item.ready,
    })),
    page,
    total,
    totalPages,
    scope,
  };
}
async function loadSignedAdaptImageMap(revisionIds: string[]): Promise<Map<string, AdaptReviewImage>> {
  const supabase = await createClient();
  const uniqueRevisionIds = [...new Set(revisionIds)];
  if (uniqueRevisionIds.length === 0) return new Map();
  const revisions = await collectPostgrestRowsInBatches<string, { id: string; object_id: string }>(uniqueRevisionIds, (batch) => supabase
    .from("cw_asset_revisions")
    .select("id,object_id")
    .in("id", batch)
    .returns<Array<{ id: string; object_id: string }>>());
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  if (revisionById.size !== uniqueRevisionIds.length) throw new Error("ADAPT_REVIEW_REVISION_MISSING");
  const objectIds = [...new Set(uniqueRevisionIds.map((id) => revisionById.get(id)?.object_id).filter((id): id is string => Boolean(id)))];
  const objects = await collectPostgrestRowsInBatches<string, {
    id: string;
    storage_path: string;
    width: number;
    height: number;
    mime: string;
  }>(objectIds, (batch) => supabase
    .from("cw_asset_objects")
    .select("id,storage_path,width,height,mime")
    .in("id", batch)
    .returns<Array<{ id: string; storage_path: string; width: number; height: number; mime: string }>>());
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const paths = [...new Set(objects.map((object) => object.storage_path))];
  const { data: signed, error: signedError } = await supabase.storage.from("cw-objects").createSignedUrls(paths, 60 * 60);
  if (signedError) throw new Error(signedError.message);
  const urlByPath = new Map<string, string>();
  for (const item of signed ?? []) if (item.path && item.signedUrl && !item.error) urlByPath.set(item.path, item.signedUrl);
  return new Map(uniqueRevisionIds.map((revisionId) => {
    const revision = revisionById.get(revisionId);
    const object = revision ? objectById.get(revision.object_id) : null;
    const url = object ? urlByPath.get(object.storage_path) : null;
    if (!object || !url) throw new Error("ADAPT_REVIEW_SIGNED_URL_MISSING");
    return [revisionId, { url, width: object.width, height: object.height, mime: object.mime }];
  }));
}

export async function loadAdaptReworkQueue(requestedPage: number, filters: AdaptReviewFilters): Promise<AdaptReworkQueue> {
  const supabase = await createClient();
  const loadRows = async (page: number) => {
    const { data, error } = await rpc(supabase)("list_cw_adapt_background_rework_queue", {
      p_course_id: filters.courseId,
      p_lecture_id: filters.lectureId,
      p_offset: (page - 1) * ADAPT_REVIEW_PAGE_SIZE,
      p_limit: ADAPT_REVIEW_PAGE_SIZE,
    });
    if (error) throw new Error(error.message);
    return z.array(z.object({
      id: z.string().uuid(), crop_x: z.number().int(), crop_y: z.number().int(),
      source_asset_revision_id: z.string().uuid(), derived_asset_revision_id: z.string().uuid(),
      rejection_code: z.enum(["crop_error", "subject_missing", "aspect_error", "quality_issue", "classification_error", "other"]),
      note: z.string(), reviewed_at: z.string(), page_count: z.number().int().nonnegative(),
      course_count: z.number().int().nonnegative(), lecture_count: z.number().int().nonnegative(),
      page_doc_id: z.string().uuid(), course_id: z.string().uuid(), course_title: z.string(),
      lecture_id: z.string().uuid(), lecture_no: z.number().int(), lecture_name: z.string(),
      page_no: z.number().int(), total_count: z.number().int().nonnegative(),
    })).parse(data ?? []);
  };
  let rows = await loadRows(requestedPage);
  const total = rows[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ADAPT_REVIEW_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  if (page !== requestedPage) rows = await loadRows(page);
  const images = await loadSignedAdaptImageMap(rows.flatMap((row) => [row.source_asset_revision_id, row.derived_asset_revision_id]));
  return {
    items: rows.map((row) => ({
      id: row.id, cropX: row.crop_x, cropY: row.crop_y,
      source: images.get(row.source_asset_revision_id)!, derived: images.get(row.derived_asset_revision_id)!,
      pageCount: row.page_count, rejectionCode: row.rejection_code, note: row.note,
      reviewedAt: row.reviewed_at, courseCount: row.course_count, lectureCount: row.lecture_count,
      pageDocId: row.page_doc_id, courseId: row.course_id, courseTitle: row.course_title,
      lectureId: row.lecture_id, lectureNo: row.lecture_no, lectureName: row.lecture_name, pageNo: row.page_no,
    })),
    page, total, totalPages,
  };
}

export async function loadAdaptBackgroundHistory(requestedPage: number, filters: AdaptReviewFilters): Promise<AdaptBackgroundHistory> {
  const supabase = await createClient();
  const loadRows = async (page: number) => {
    const { data, error } = await rpc(supabase)("list_cw_adapt_background_history", {
      p_course_id: filters.courseId,
      p_lecture_id: filters.lectureId,
      p_offset: (page - 1) * ADAPT_REVIEW_PAGE_SIZE,
      p_limit: ADAPT_REVIEW_PAGE_SIZE,
    });
    if (error) throw new Error(error.message);
    return z.array(z.object({
      id: z.string().uuid(), status: z.enum(["rejected", "superseded"]),
      rejection_code: z.enum(["crop_error", "subject_missing", "aspect_error", "quality_issue", "classification_error", "other"]).nullable(),
      note: z.string(), crop_x: z.number().int(), crop_y: z.number().int(),
      source_asset_revision_id: z.string().uuid(), derived_asset_revision_id: z.string().uuid(),
      supersedes_id: z.string().uuid().nullable(), superseded_by_id: z.string().uuid().nullable(),
      successor_status: z.string().nullable(), reviewed_at: z.string().nullable(),
      page_count: z.number().int().nonnegative(), course_id: z.string().uuid().nullable(),
      course_title: z.string().nullable(), lecture_id: z.string().uuid().nullable(),
      lecture_no: z.number().int().nullable(), lecture_name: z.string().nullable(),
      page_no: z.number().int().nullable(), total_count: z.number().int().nonnegative(),
    })).parse(data ?? []);
  };
  let rows = await loadRows(requestedPage);
  const total = rows[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ADAPT_REVIEW_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  if (page !== requestedPage) rows = await loadRows(page);
  return {
    items: rows.map((row) => ({
      id: row.id, status: row.status, rejectionCode: row.rejection_code, note: row.note,
      cropX: row.crop_x, cropY: row.crop_y, sourceAssetRevisionId: row.source_asset_revision_id,
      derivedAssetRevisionId: row.derived_asset_revision_id, supersedesId: row.supersedes_id,
      supersededById: row.superseded_by_id, successorStatus: row.successor_status,
      reviewedAt: row.reviewed_at, pageCount: row.page_count, courseId: row.course_id,
      courseTitle: row.course_title, lectureId: row.lecture_id, lectureNo: row.lecture_no,
      lectureName: row.lecture_name, pageNo: row.page_no,
    })),
    page, total, totalPages,
  };
}
