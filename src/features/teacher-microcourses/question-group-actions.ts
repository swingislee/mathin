"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, parse, uuid } from "@/features/school/actions/schemas";
import { questionGroupsSchema, questionGroupStateSchema, type QuestionGroupState } from "@/features/interactive-questions/contract";

const schema = z.object({ microcourseId: uuid, version: z.number().int().nonnegative(), groups: questionGroupsSchema });
export async function saveMicrocourseQuestionGroups(input: z.infer<typeof schema>): Promise<ActionResult<QuestionGroupState>> {
  try {
    const value = parse(schema, input);
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const { data, error } = await supabase.rpc("save_teacher_microcourse_question_groups", { p_microcourse_id: value.microcourseId, p_version: value.version, p_groups: value.groups });
    if (error) throw new Error(error.message);
    revalidatePath("/[locale]/dashboard", "layout");
    return { ok: true, data: questionGroupStateSchema.parse(data) };
  } catch (error) { return actionError(error, [...COMMON_CODES, "CONFLICT", "FORBIDDEN_AUTHOR", "PAGE_ORDER_MISMATCH"]); }
}
