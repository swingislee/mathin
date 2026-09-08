"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, parse, uuid } from "@/features/school/actions/schemas";

const orderSchema = z.object({ lectureId: uuid, pageIds: z.array(uuid).min(1).max(1000).refine((ids) => new Set(ids).size === ids.length) }).strict();
const deleteSchema = z.object({ pageDocId: uuid }).strict();
const codes = ["INVALID_PAGE_ORDER", "PAGE_ORDER_MISMATCH", "LAST_PAGE_FORBIDDEN", "PAGE_NOT_FOUND", "LECTURE_NOT_FOUND",
  "RELATION_REQUIRED", "RESPONSIBILITY_REQUIRED", "MISSING_PERMISSION", "INACTIVE_ACTOR", "COURSE_TRASHED", "LECTURE_ARCHIVED", ...COMMON_CODES];

export async function reorderFormalCoursewarePagesAction(input: z.input<typeof orderSchema>): Promise<ActionResult> {
  try {
    const value = parse(orderSchema, input);
    const { supabase } = await authorizedClient("courseware.page.edit");
    const { error } = await supabase.rpc("reorder_cw_pages", { p_lecture_id: value.lectureId, p_page_ids: value.pageIds });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) { return actionError(error, codes); }
}

/** 只标记当前草稿页已移除；原 revision、资源、发布与冻结快照均保留。 */
export async function deleteFormalCoursewarePageAction(input: z.input<typeof deleteSchema>): Promise<ActionResult> {
  try {
    const value = parse(deleteSchema, input);
    const { supabase } = await authorizedClient("courseware.page.edit");
    const { error } = await supabase.rpc("soft_delete_cw_page", { p_page_doc_id: value.pageDocId });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) { return actionError(error, codes); }
}
