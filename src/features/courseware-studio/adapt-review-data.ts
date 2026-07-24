import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { AdaptClass } from "./adapt-review-shared";

export const ADAPT_REVIEW_PAGE_SIZE = 24;


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

export interface AdaptPageQueueItem {
  id: string;
  lectureId: string;
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

export function parseAdaptReviewPage(value: string | string[] | undefined): number {
  const first = Array.isArray(value) ? value[0] : value;
  return z.coerce.number().int().min(1).max(10_000).catch(1).parse(first ?? "1");
}

export function parseAdaptClass(value: string | string[] | undefined): AdaptClass | "all" {
  const first = Array.isArray(value) ? value[0] : value;
  return z.enum(["A", "B", "C", "D", "E", "F", "all"]).catch("D").parse(first ?? "D");
}

/**
 * 校对只签发当前页的两组私有 CAS URL，避免把完整待办队列的图片 URL 一次下发到浏览器。
 * 源图与派生图缺任一对象都视为数据损坏，不能静默变成无法审校的空卡片。
 */
export async function loadAdaptReviewQueue(requestedPage: number): Promise<AdaptReviewQueue> {
  const supabase = await createClient();
  const { count, error: countError } = await supabase
    .from("cw_adapt_backgrounds")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  if (countError) throw new Error(countError.message);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ADAPT_REVIEW_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const from = (page - 1) * ADAPT_REVIEW_PAGE_SIZE;
  const { data: rows, error: rowsError } = await supabase
    .from("cw_adapt_backgrounds")
    .select("id,crop_x,crop_y,source_asset_revision_id,derived_asset_revision_id")
    .eq("status", "pending")
    .order("created_at")
    .range(from, from + ADAPT_REVIEW_PAGE_SIZE - 1);
  if (rowsError) throw new Error(rowsError.message);

  const revisionIds = [...new Set((rows ?? []).flatMap((row) => [row.source_asset_revision_id, row.derived_asset_revision_id]))];
  if (revisionIds.length === 0) return { items: [], page, total, totalPages };
  const { data: revisions, error: revisionsError } = await supabase
    .from("cw_asset_revisions")
    .select("id,object_id,shared_asset_id")
    .in("id", revisionIds);
  if (revisionsError) throw new Error(revisionsError.message);
  const revisionById = new Map((revisions ?? []).map((revision) => [revision.id, revision]));
  if (revisionById.size !== revisionIds.length) throw new Error("ADAPT_REVIEW_REVISION_MISSING");
  const objectIds = [...new Set(revisionIds.map((id) => revisionById.get(id)?.object_id).filter((id): id is string => Boolean(id)))];
  if (objectIds.length !== revisionIds.length) throw new Error("ADAPT_REVIEW_REVISION_OBJECT_MISSING");

  const { data: objects, error: objectsError } = await supabase
    .from("cw_asset_objects")
    .select("id,storage_path,width,height,mime")
    .in("id", objectIds);
  if (objectsError) throw new Error(objectsError.message);
  const objectById = new Map((objects ?? []).map((object) => [object.id, object]));
  if (objectById.size !== objectIds.length) throw new Error("ADAPT_REVIEW_OBJECT_MISSING");

  const paths = [...new Set(objectIds.map((id) => objectById.get(id)?.storage_path).filter((path): path is string => Boolean(path)))];
  const { data: signed, error: signedError } = await supabase.storage.from("cw-objects").createSignedUrls(paths, 60 * 60);
  if (signedError) throw new Error(signedError.message);
  const urlByPath = new Map<string, string>();
  for (const item of signed ?? []) if (item.path && item.signedUrl && !item.error) urlByPath.set(item.path, item.signedUrl);

  const derivedRevisionIds = (rows ?? []).map((row) => row.derived_asset_revision_id);
  const sharedAssetIds = [...new Set(derivedRevisionIds.map((id) => revisionById.get(id)?.shared_asset_id).filter((id): id is string => Boolean(id)))];
  const { data: bindings, error: bindingsError } = await supabase
    .from("cw_page_asset_bindings")
    .select("page_doc_id,shared_asset_id")
    .eq("track", "adapted-4x3")
    .eq("role", "background")
    .in("shared_asset_id", sharedAssetIds);
  if (bindingsError) throw new Error(bindingsError.message);
  // 公共背景可绑定数千页。不要把所有 page_doc_id 放进 PostgREST 的 `in.(...)`
  // 查询串，否则会越过网关 URI 限制；队列只展示关联数量，因此直接按绑定计数。
  const pageCountBySharedAsset = new Map<string, number>();
  for (const binding of bindings ?? []) {
    pageCountBySharedAsset.set(binding.shared_asset_id, (pageCountBySharedAsset.get(binding.shared_asset_id) ?? 0) + 1);
  }

  const imageForRevision = (revisionId: string): AdaptReviewImage => {
    const revision = revisionById.get(revisionId);
    const object = revision ? objectById.get(revision.object_id) : null;
    const url = object ? urlByPath.get(object.storage_path) : null;
    if (!object || !url) throw new Error("ADAPT_REVIEW_SIGNED_URL_MISSING");
    return { url, width: object.width, height: object.height, mime: object.mime };
  };

  return {
    items: (rows ?? []).map((row) => {
      const sharedAssetId = revisionById.get(row.derived_asset_revision_id)?.shared_asset_id;
      return {
        id: row.id,
        cropX: row.crop_x,
        cropY: row.crop_y,
        source: imageForRevision(row.source_asset_revision_id),
        derived: imageForRevision(row.derived_asset_revision_id),
        pageCount: sharedAssetId ? pageCountBySharedAsset.get(sharedAssetId) ?? 0 : 0,
      };
    }),
    page,
    total,
    totalPages,
  };
}

/** 页面队列把 D 类作为默认入口，也允许切换查看 A–F。分类变更和可视化编辑均以页面为单位进行。 */
export async function loadAdaptPageQueue(requestedPage: number, classification: AdaptClass | "all"): Promise<AdaptPageQueue> {
  const supabase = await createClient();
  const base = () => {
    const query = supabase
      .from("cw_page_docs")
      .select("id,lecture_id,page_no,title,adapt_class,adapt_reason", { count: "exact" })
      .is("deleted_at", null);
    return classification === "all" ? query.not("adapt_class", "is", null) : query.eq("adapt_class", classification);
  };
  const { count, error: countError } = await base().limit(0);
  if (countError) throw new Error(countError.message);
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / ADAPT_REVIEW_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const { data, error } = await base()
    .order("lecture_id")
    .order("page_no")
    .range((page - 1) * ADAPT_REVIEW_PAGE_SIZE, page * ADAPT_REVIEW_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return {
    items: (data ?? []).map((item) => ({
      id: item.id,
      lectureId: item.lecture_id,
      pageNo: item.page_no,
      title: item.title,
      adaptClass: item.adapt_class as AdaptClass,
      adaptReason: item.adapt_reason,
    })),
    page,
    total,
    totalPages,
    classification,
  };
}
