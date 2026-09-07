"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/database.types";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, intInRange, parse, requiredText, text, uuid } from "@/features/school/actions/schemas";
import { COURSEWARE_TRACKS } from "./data";
import { formalManualPageSchema } from "./formal-manual-page-contract";

const createSchema = z.object({ lectureId: uuid, afterPageDocId: uuid.nullable(), title: requiredText(500) }).strict();
const saveSchema = z.object({ pageDocId: uuid, track: z.enum(COURSEWARE_TRACKS), doc: formalManualPageSchema,
  baseRevisionNo: intInRange(1, 100_000), note: text(1000) }).strict();
const codes = ["AFTER_PAGE_NOT_FOUND", "INVALID_MANUAL_COMPOSITION_PAGE", "MANUAL_COMPOSITION_PAGE_REQUIRED", "COURSEWARE_DOC_BINDING_MISSING",
  "PAGE_LIMIT_EXCEEDED", "VERSION_CONFLICT", "PAGE_TRACK_NOT_FOUND", "MISSING_PERMISSION", "INACTIVE_ACTOR",
  "RELATION_REQUIRED", "RESPONSIBILITY_REQUIRED", "LECTURE_NOT_FOUND", "COURSE_TRASHED", "LECTURE_ARCHIVED", "FAMILY_DISABLED", "COURSE_DISABLED", "SAVE_FAILED", ...COMMON_CODES];

/** 接回旧 Studio 的通用空白页接口；组件只在创建后由编辑器插入。 */
export async function createBlankCoursewarePageAction(input: z.input<typeof createSchema>): Promise<ActionResult<{ pageDocId: string }>> {
  try {
    const value = parse(createSchema, input);
    const { supabase } = await authorizedClient("courseware.page.edit");
    const { data, error } = await supabase.rpc("create_blank_cw_page", {
      p_lecture_id: value.lectureId, p_after_page_doc_id: value.afterPageDocId ?? undefined, p_title: value.title,
    });
    if (error || !data) throw new Error(error?.message ?? "SAVE_FAILED");
    revalidatePath("/[locale]/dashboard/courseware/lectures/[lectureId]", "page");
    return { ok: true, data: { pageDocId: data } };
  } catch (error) { return actionError(error, codes); }
}

export async function saveFormalManualPageAction(input: z.input<typeof saveSchema>): Promise<ActionResult<{ revisionNo: number }>> {
  try {
    const value = parse(saveSchema, input);
    const { supabase } = await authorizedClient("courseware.page.edit");
    const { data, error } = await supabase.rpc("save_cw_manual_composition_page", {
      p_page_doc_id: value.pageDocId, p_track: value.track, p_doc: value.doc as unknown as Json,
      p_base_revision_no: value.baseRevisionNo, p_note: value.note,
    });
    if (error || !data?.[0]) throw new Error(error?.message ?? "SAVE_FAILED");
    return { ok: true, data: { revisionNo: data[0].revision_no } };
  } catch (error) { return actionError(error, codes); }
}
