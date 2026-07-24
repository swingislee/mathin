"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, parse, text, uuid } from "@/features/school/actions/schemas";

const reviewSchema = z.object({ adaptationIds: z.array(uuid).min(1).max(100), decision: z.enum(["approve", "reject"]) });
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
      p_note: "",
    });
    if (error || data !== value.adaptationIds.length) throw new Error(error?.message ?? "ADAPT_BACKGROUND_NOT_PENDING");
    revalidatePath("/dashboard/adapt-review");
    return { ok: true, data: { reviewedCount: data } };
  } catch (error) {
    return actionError(error, ["ADAPT_BACKGROUND_NOT_PENDING", "INVALID_ADAPT_BACKGROUND_SELECTION", ...COMMON_CODES]);
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
