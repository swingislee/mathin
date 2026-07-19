"use server";

import { z } from "zod";
import { pageDocSchema } from "@/features/courseware-doc/schema";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, intInRange, parse, requiredText, text, uuid } from "@/features/school/actions/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { COURSEWARE_TRACKS, type CoursewareTrack } from "./data";

type RpcClient = Awaited<ReturnType<typeof authorizedClient>>["supabase"];
function rpc<T>(client: RpcClient, name: string, args: Record<string, unknown>) {
  return (client.rpc as unknown as (fn: string, params: Record<string, unknown>) => Promise<{ data: T; error: { message: string } | null }>)(name, args);
}

const trackSchema = z.enum(COURSEWARE_TRACKS);
const draftSchema = z.object({ pageDocId: uuid, track: trackSchema, doc: pageDocSchema, baseRevisionNo: intInRange(1, 100_000), note: text(1000) });
export async function saveCoursewareDraftAction(input: z.input<typeof draftSchema>): Promise<ActionResult<{ revisionNo: number }>> {
  try {
    const value = parse(draftSchema, input); const { supabase } = await authorizedClient("courseware.page.edit");
    const { data, error } = await rpc<Array<{ revision_no: number }>>(supabase, "save_cw_track_page_draft", { p_page_doc_id: value.pageDocId, p_track: value.track, p_doc: value.doc, p_base_revision_no: value.baseRevisionNo, p_note: value.note });
    if (error || !data?.[0]) throw new Error(error?.message ?? "SAVE_FAILED");
    return { ok: true, data: { revisionNo: data[0].revision_no } };
  } catch (error) { return actionError(error, ["VERSION_CONFLICT", "SAVE_FAILED", ...COMMON_CODES]); }
}

export async function publishCoursewareReleaseAction(lectureId: string, track: CoursewareTrack, note: string): Promise<ActionResult<{ releaseId: string }>> {
  try {
    const value = parse(z.object({ lectureId: uuid, track: trackSchema, note: text(1000) }), { lectureId, track, note }); const { supabase } = await authorizedClient("courseware.release.publish");
    const { data, error } = await rpc<string>(supabase, "publish_cw_track_release", { p_lecture_id: value.lectureId, p_track: value.track, p_note: value.note });
    if (error) throw new Error(error.message); return { ok: true, data: { releaseId: data } };
  } catch (error) { return actionError(error, ["LECTURE_HAS_NO_PAGES", "UNRESOLVED_ASSET_BINDING", ...COMMON_CODES]); }
}

export async function reorderCoursewarePagesAction(input: { lectureId: string; pageIds: string[] }): Promise<ActionResult> {
  try {
    const value = parse(z.object({ lectureId: uuid, pageIds: z.array(uuid).min(1).max(1000) }), input); const { supabase } = await authorizedClient("courseware.page.edit");
    const { error } = await rpc<null>(supabase, "reorder_cw_pages", { p_lecture_id: value.lectureId, p_page_ids: value.pageIds }); if (error) throw new Error(error.message); return { ok: true };
  } catch (error) { return actionError(error, ["PAGE_ORDER_MISMATCH", ...COMMON_CODES]); }
}

export async function createBlankCoursewarePageAction(input: { lectureId: string; afterPageDocId: string | null; title: string }): Promise<ActionResult<{ pageId: string }>> {
  try {
    const value = parse(z.object({ lectureId: uuid, afterPageDocId: uuid.nullable(), title: requiredText(500) }), input); const { supabase } = await authorizedClient("courseware.page.edit");
    const { data, error } = await rpc<string>(supabase, "create_blank_cw_page", { p_lecture_id: value.lectureId, p_after_page_doc_id: value.afterPageDocId, p_title: value.title }); if (error) throw new Error(error.message); return { ok: true, data: { pageId: data } };
  } catch (error) { return actionError(error, ["AFTER_PAGE_NOT_FOUND", ...COMMON_CODES]); }
}

export async function copyCoursewarePageAction(input: { sourcePageDocId: string; targetLectureId: string; afterPageDocId: string | null; title: string }): Promise<ActionResult<{ pageId: string }>> {
  try {
    const value = parse(z.object({ sourcePageDocId: uuid, targetLectureId: uuid, afterPageDocId: uuid.nullable(), title: text(500) }), input); const { supabase } = await authorizedClient("courseware.page.edit");
    const { data, error } = await rpc<string>(supabase, "copy_cw_page", { p_source_page_doc_id: value.sourcePageDocId, p_target_lecture_id: value.targetLectureId, p_after_page_doc_id: value.afterPageDocId, p_title: value.title });
    if (error) throw new Error(error.message); return { ok: true, data: { pageId: data } };
  } catch (error) { return actionError(error, ["PAGE_NOT_FOUND", "AFTER_PAGE_NOT_FOUND", ...COMMON_CODES]); }
}

export async function deleteCoursewarePageAction(pageDocId: string): Promise<ActionResult> {
  try { const id = parse(uuid, pageDocId); const { supabase } = await authorizedClient("courseware.page.edit"); const { error } = await rpc<null>(supabase, "soft_delete_cw_page", { p_page_doc_id: id }); if (error) throw new Error(error.message); return { ok: true }; }
  catch (error) { return actionError(error, ["LAST_PAGE_FORBIDDEN", "PAGE_NOT_FOUND", ...COMMON_CODES]); }
}

export async function revertCoursewarePageAction(input: { pageDocId: string; track: CoursewareTrack; revisionId: string; baseRevisionNo: number; note: string }): Promise<ActionResult<{ revisionNo: number }>> {
  try {
    const value = parse(z.object({ pageDocId: uuid, track: trackSchema, revisionId: uuid, baseRevisionNo: intInRange(1, 100_000), note: text(1000) }), input); const { supabase } = await authorizedClient("courseware.page.edit");
    const { data, error } = await rpc<Array<{ revision_no: number }>>(supabase, "revert_cw_track_page_revision", { p_page_doc_id: value.pageDocId, p_track: value.track, p_revision_id: value.revisionId, p_base_revision_no: value.baseRevisionNo, p_note: value.note });
    if (error || !data?.[0]) throw new Error(error?.message ?? "SAVE_FAILED"); return { ok: true, data: { revisionNo: data[0].revision_no } };
  } catch (error) { return actionError(error, ["VERSION_CONFLICT", "REVISION_NOT_FOUND", "SAVE_FAILED", ...COMMON_CODES]); }
}

export async function rollbackCoursewareReleaseAction(lectureId: string, track: CoursewareTrack, releaseId: string, note: string): Promise<ActionResult<{ releaseId: string }>> {
  try {
    const value = parse(z.object({ lectureId: uuid, track: trackSchema, releaseId: uuid, note: text(1000) }), { lectureId, track, releaseId, note }); const { supabase } = await authorizedClient("courseware.release.publish");
    const { data, error } = await rpc<string>(supabase, "rollback_cw_track_release", { p_lecture_id: value.lectureId, p_track: value.track, p_release_id: value.releaseId, p_note: value.note }); if (error) throw new Error(error.message); return { ok: true, data: { releaseId: data } };
  } catch (error) { return actionError(error, ["RELEASE_NOT_FOUND", ...COMMON_CODES]); }
}

const imageReplacementSchema = z.object({
  pageDocId: uuid,
  bindingKey: z.string().regex(/^[0-9a-f]{64}$/),
  track: trackSchema,
  scope: z.enum(["current-page", "all-track"]),
  file: z.instanceof(File).refine(
    (file) => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) && file.size > 0 && file.size <= 52_428_800,
  ),
});

function imageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  const read16 = (offset: number) => bytes[offset]! * 256 + bytes[offset + 1]!;
  if (mime === "image/png" && bytes.length >= 24 && bytes.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) {
    return { width: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16), height: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20) };
  }
  if (mime === "image/gif" && bytes.length >= 10 && (String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a" || String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a")) return { width: bytes[6]! + bytes[7]! * 256, height: bytes[8]! + bytes[9]! * 256 };
  if (mime === "image/jpeg") {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]!; const length = read16(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: read16(offset + 7), height: read16(offset + 5) };
      if (length < 2) break; offset += length + 2;
    }
  }
  if (mime === "image/webp" && bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X") return { width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16), height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16) };
    if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: (bytes[26]! + (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! + (bytes[29]! << 8)) & 0x3fff };
    if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const width = 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8);
      const height = 1 + (bytes[22]! >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 0x0f) << 10);
      return { width, height };
    }
  }
  return null;
}

const stagedImageSchema = z.object({
  file: z.instanceof(File).refine(
    (file) => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) && file.size > 0 && file.size <= 52_428_800,
  ),
});

/**
 * P6-8 两阶段的 A 阶段：服务端验证并将不可变对象落到 CAS，再写入仅本人可消费的一小时 staging 记录。
 * 这里故意不改变任何 binding；用户仍可在确认页调整范围或直接离开。
 */
export async function stageCoursewareImageReplacementAction(input: { file: File }): Promise<ActionResult<{ uploadId: string; sha256: string; width: number; height: number }>> {
  try {
    const { file } = parse(stagedImageSchema, input);
    const { user } = await authorizedClient("courseware.asset.manage");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dimensions = imageDimensions(bytes, file.type);
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) throw new Error("VALIDATION");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storagePath = `sha256/${sha256.slice(0, 2)}/${sha256}`;
    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage.from("cw-objects").upload(storagePath, bytes, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) throw new Error(uploadError.message);
    const { data: staged, error: stageError } = await admin
      .from("cw_replacement_uploads")
      .insert({
        sha256,
        mime: file.type,
        byte_count: file.size,
        width: dimensions.width,
        height: dimensions.height,
        storage_path: storagePath,
        original_name: file.name.slice(0, 500),
        created_by: user.id,
      })
      .select("id")
      .single();
    if (stageError || !staged) throw new Error(stageError?.message ?? "STAGE_FAILED");
    return { ok: true, data: { uploadId: staged.id, sha256, ...dimensions } };
  } catch (error) {
    return actionError(error, ["STAGE_FAILED", ...COMMON_CODES]);
  }
}

const applyReplacementSchema = z.object({
  sourceSharedAssetId: uuid,
  selectedBindingIds: z.array(uuid).min(1).max(50_000),
  uploadId: uuid,
  note: text(1000),
});

/** P6-8 B 阶段：单 RPC 原子判定全量/部分替换、写 audit，并在部分场景建立资源语义分支。 */
export async function applyCoursewareImageReplacementAction(
  input: z.input<typeof applyReplacementSchema>,
): Promise<ActionResult<{ batchId: string; mode: "publish_pointer" | "branch_rebind"; affectedCount: number }>> {
  try {
    const value = parse(applyReplacementSchema, input);
    const { supabase } = await authorizedClient("courseware.asset.manage");
    const { data, error } = await rpc<Array<{ batch_id: string; mode: "publish_pointer" | "branch_rebind"; affected_count: number }>>(
      supabase,
      "apply_cw_asset_replacement",
      {
        p_source_shared_asset_id: value.sourceSharedAssetId,
        p_selected_binding_ids: value.selectedBindingIds,
        p_upload_id: value.uploadId,
        p_note: value.note,
      },
    );
    if (error || !data?.[0]) throw new Error(error?.message ?? "REPLACEMENT_FAILED");
    revalidatePath("/dashboard/courseware");
    return {
      ok: true,
      data: {
        batchId: data[0].batch_id,
        mode: data[0].mode,
        affectedCount: data[0].affected_count,
      },
    };
  } catch (error) {
    return actionError(error, [
      "UPLOAD_NOT_FOUND",
      "UPLOAD_EXPIRED",
      "SOURCE_ASSET_NOT_FOUND",
      "SOURCE_ASSET_UNPUBLISHED",
      "SELECTED_BINDING_NOT_FOUND",
      "SELECTED_BINDING_NOT_FROM_SOURCE",
      "PINNED_BINDING_EXCLUDED",
      "OBJECT_METADATA_CONFLICT",
      "INVALID_REPLACEMENT_SELECTION",
      ...COMMON_CODES,
    ]);
  }
}

export async function rollbackCoursewareImageReplacementAction(batchId: string): Promise<ActionResult> {
  try {
    const value = parse(uuid, batchId);
    const { supabase } = await authorizedClient("courseware.asset.manage");
    const { error } = await rpc<null>(supabase, "rollback_cw_asset_replacement", { p_batch_id: value });
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/courseware");
    return { ok: true };
  } catch (error) {
    return actionError(error, [
      "REPLACEMENT_BATCH_NOT_FOUND",
      "REPLACEMENT_ALREADY_ROLLED_BACK",
      "REPLACEMENT_ROLLBACK_CONFLICT",
      "REPLACEMENT_AUDIT_INCOMPLETE",
      ...COMMON_CODES,
    ]);
  }
}

/** P6-7 图片替换：先以 hash 上传不可变 CAS，再经 RPC 建本页独立资源分支。 */
export async function replaceCoursewarePageImageAction(input: { pageDocId: string; bindingKey: string; track: CoursewareTrack; scope: "current-page" | "all-track"; file: File }): Promise<ActionResult<{ affectedCount: number }>> {
  try {
    const value = parse(imageReplacementSchema, input);
    const { supabase } = await authorizedClient("courseware.asset.manage");
    const { pageDocId, bindingKey, track, scope, file } = value;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dimensions = imageDimensions(bytes, file.type);
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) throw new Error("VALIDATION");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `sha256/${sha256.slice(0, 2)}/${sha256}`;
    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage.from("cw-objects").upload(path, bytes, { contentType: file.type, cacheControl: "31536000", upsert: false });
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) throw new Error(uploadError.message);
    const { data, error } = await rpc<Array<{ affected_count: number }>>(supabase, "replace_cw_track_image_binding", { p_page_doc_id: pageDocId, p_binding_key: bindingKey, p_track: track, p_scope: scope, p_sha256: sha256, p_mime: file.type, p_byte_count: file.size, p_width: dimensions.width, p_height: dimensions.height, p_name: file.name });
    if (error || !data?.[0]) throw new Error(error?.message ?? "IMAGE_REPLACEMENT_FAILED");
    revalidatePath("/dashboard/courseware");
    return { ok: true, data: { affectedCount: data[0].affected_count } };
  } catch (error) { return actionError(error, ["IMAGE_BINDING_NOT_FOUND", "INVALID_IMAGE_UPLOAD", "INVALID_REPLACEMENT_SCOPE", ...COMMON_CODES]); }
}
