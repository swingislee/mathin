"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, parse, text, uuid } from "@/features/school/actions/schemas";
import { ADAPT_REJECTION_CODES } from "./adapt-review-shared";

type RpcClient = Awaited<ReturnType<typeof authorizedClient>>["supabase"];
function rpc<T>(client: RpcClient, name: string, args: Record<string, unknown>) {
  return (client.rpc as unknown as (fn: string, params: Record<string, unknown>) => Promise<{ data: T; error: { message: string } | null }>)(name, args);
}

const reviewSchema = z.object({
  adaptationIds: z.array(uuid).min(1).max(100),
  decision: z.enum(["approve", "reject"]),
  rejectionCode: z.enum(ADAPT_REJECTION_CODES).nullable(),
  note: text(1000),
}).superRefine((value, context) => {
  if (value.decision === "reject" && !value.rejectionCode) {
    context.addIssue({ code: "custom", path: ["rejectionCode"], message: "REJECTION_REASON_REQUIRED" });
  }
  if (value.decision === "approve" && value.rejectionCode) {
    context.addIssue({ code: "custom", path: ["rejectionCode"], message: "INVALID_REJECTION_REASON" });
  }
  if (value.decision === "reject" && value.rejectionCode === "other" && !value.note.trim()) {
    context.addIssue({ code: "custom", path: ["note"], message: "REJECTION_NOTE_REQUIRED" });
  }
});
const repairSchema = z.object({ adaptationId: uuid, uploadId: uuid, cropX: z.number().int().min(0), cropY: z.number().int().min(0), note: text(1000) });
const classificationSchema = z.object({ pageDocId: uuid, classification: z.enum(["A", "B", "C", "D", "E", "F"]), note: text(1000) });

/** P6-6 背景确认闸门；一页内的选择通过单 RPC 原子落库，避免并发时半批次提交。 */
export async function reviewAdaptBackgroundsAction(input: z.input<typeof reviewSchema>): Promise<ActionResult<{ reviewedCount: number }>> {
  try {
    const value = parse(reviewSchema, input);
    if (new Set(value.adaptationIds).size !== value.adaptationIds.length) throw new Error("VALIDATION");
    const { supabase } = await authorizedClient("courseware.asset.manage");
    const { data, error } = await supabase.rpc("review_cw_adapt_backgrounds", {
      p_adaptation_ids: value.adaptationIds,
      p_approve: value.decision === "approve",
      p_rejection_code: value.rejectionCode,
      p_note: value.note,
    });
    if (error || data !== value.adaptationIds.length) throw new Error(error?.message ?? "ADAPT_BACKGROUND_NOT_PENDING");
    revalidatePath("/dashboard/adapt-review");
    return { ok: true, data: { reviewedCount: data } };
  } catch (error) {
    return actionError(error, [
      "ADAPT_BACKGROUND_NOT_PENDING",
      "INVALID_ADAPT_BACKGROUND_SELECTION",
      "INVALID_REJECTION_REASON",
      "REJECTION_REASON_REQUIRED",
      "REJECTION_NOTE_REQUIRED",
      ...COMMON_CODES,
    ]);
  }
}

/** 退回修复创建新的 CAS revision 与 pending 候选，原决定仅补 successor 链接。 */
export async function repairAdaptBackgroundAction(input: z.input<typeof repairSchema>): Promise<ActionResult<{ adaptationId: string; affectedCount: number }>> {
  try {
    const value = parse(repairSchema, input);
    const { supabase } = await authorizedClient("courseware.asset.manage");
    const { data, error } = await rpc<Array<{ adaptation_id: string; revision_id: string; affected_count: number }>>(supabase, "repair_cw_adapt_background", {
      p_adaptation_id: value.adaptationId,
      p_upload_id: value.uploadId,
      p_crop_x: value.cropX,
      p_crop_y: value.cropY,
      p_note: value.note,
    });
    const repaired = data?.[0];
    if (error || !repaired) throw new Error(error?.message ?? "ADAPT_REPAIR_FAILED");
    revalidatePath("/dashboard/adapt-review");
    return { ok: true, data: { adaptationId: repaired.adaptation_id, affectedCount: repaired.affected_count } };
  } catch (error) {
    return actionError(error, [
      "ADAPT_BACKGROUND_NOT_FOUND",
      "ADAPT_BACKGROUND_NOT_REPAIRABLE",
      "ADAPT_BACKGROUND_NOT_SELECTED",
      "ADAPT_REPAIR_MUST_BE_4X3",
      "INVALID_ADAPT_REPAIR_CROP",
      "UPLOAD_NOT_FOUND",
      "UPLOAD_EXPIRED",
      "OBJECT_METADATA_CONFLICT",
      "ADAPT_REPAIR_FAILED",
      ...COMMON_CODES,
    ]);
  }
}

/** 分类覆写不覆盖 4:3 草稿；页面需要通过可视化编辑器调整后，再走正常的审校/发布流程。 */
export async function setAdaptPageClassificationAction(input: z.input<typeof classificationSchema>): Promise<ActionResult> {
  try {
    const value = parse(classificationSchema, input);
    const { supabase } = await authorizedClient("courseware.page.edit");
    const { error } = await supabase.rpc("set_cw_adapt_page_classification", {
      p_page_doc_id: value.pageDocId,
      p_classification: value.classification,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/adapt-review");
    return { ok: true };
  } catch (error) {
    return actionError(error, ["PAGE_NOT_FOUND", "INVALID_ADAPT_CLASSIFICATION", ...COMMON_CODES]);
  }
}
