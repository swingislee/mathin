"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import { getCourseMaterialOptions } from "../class-material";
import {
  MATERIAL_ERROR_CODES, materialOptionsSchema, materialPreviewSchema, materialRuleInputSchema,
  materialRuleSchema, materialSelectionSchema, materialWorkspaceSchema,
  type MaterialOptions, type MaterialPreview, type MaterialRule, type MaterialRuleInput,
  type MaterialSelection, type MaterialWorkspace,
} from "../class-material-contract";
import { authorizedClient, financeClient, nullableRpcArg } from "./guards";
import { parse, uuid } from "./schemas";

const changeSchema = z.object({
  classroomId: uuid, courseId: uuid, selection: materialSelectionSchema, includeDrafts: z.boolean(),
}).strict();
type ChangeInput = z.infer<typeof changeSchema>;

export async function getCourseMaterialOptionsAction(purpose: "production" | "test", sourceClassroomId: string | null = null): Promise<ActionResult<MaterialOptions>> {
  try {
    const value = parse(z.object({ purpose: z.enum(["production", "test"]), sourceClassroomId: uuid.nullable() }).strict(), { purpose, sourceClassroomId });
    await financeClient(["class.create", "class.manage", "course.manage"]);
    return { ok: true, data: materialOptionsSchema.parse(await getCourseMaterialOptions(value.purpose, value.sourceClassroomId)) };
  } catch (error) { return actionError(error, MATERIAL_ERROR_CODES); }
}
export async function getClassroomMaterialWorkspaceAction(classroomId: string): Promise<ActionResult<MaterialWorkspace>> {
  try {
    const id = parse(uuid, classroomId);
    const { supabase } = await authorizedClient("class.manage");
    const { data, error } = await supabase.rpc("get_classroom_material_workspace", { p_classroom_id: id });
    if (error) throw new Error(error.message);
    return { ok: true, data: materialWorkspaceSchema.parse(data) };
  } catch (error) { return actionError(error, MATERIAL_ERROR_CODES); }
}
export async function saveCourseMaterialRuleAction(ruleId: string | null, expectedVersion: number, input: MaterialRuleInput): Promise<ActionResult<MaterialRule>> {
  try {
    const value = parse(z.object({ ruleId: uuid.nullable(), expectedVersion: z.number().int().min(0), input: materialRuleInputSchema }).strict(), { ruleId, expectedVersion, input });
    const { supabase } = await authorizedClient("course.manage");
    const { data, error } = await supabase.rpc("save_course_material_rule", {
      p_rule_id: nullableRpcArg(value.ruleId), p_expected_version: value.expectedVersion, p_input: value.input,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/[locale]/dashboard/courses/material-rules", "page");
    return { ok: true, data: materialRuleSchema.parse(data) };
  } catch (error) { return actionError(error, MATERIAL_ERROR_CODES); }
}
export async function previewClassroomMaterialChangeAction(input: ChangeInput): Promise<ActionResult<MaterialPreview>> {
  try {
    const value = parse(changeSchema, input);
    const { supabase } = await authorizedClient("class.manage");
    const { data, error } = await supabase.rpc("preview_classroom_material_change", {
      p_classroom_id: value.classroomId, p_course_id: value.courseId, p_selection: value.selection,
      p_include_drafts: value.includeDrafts,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: materialPreviewSchema.parse(data) };
  } catch (error) { return actionError(error, MATERIAL_ERROR_CODES); }
}
export async function applyClassroomMaterialChangeAction(input: {
  classroomId: string; courseId: string; selection: MaterialSelection; includeDrafts: boolean; expectedToken: string; reason: string;
}): Promise<ActionResult<{ changedSessions: number; preservedSessions: number; changeId: string }>> {
  try {
    const value = parse(changeSchema.extend({
      expectedToken: z.string().regex(/^[a-f0-9]{32}$/), reason: z.string().trim().min(1).max(500),
    }).strict(), input);
    const { supabase } = await authorizedClient("class.manage");
    const { data, error } = await supabase.rpc("apply_classroom_material_change", {
      p_classroom_id: value.classroomId, p_course_id: value.courseId, p_selection: value.selection,
      p_include_drafts: value.includeDrafts, p_expected_token: value.expectedToken, p_reason: value.reason,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/[locale]/dashboard/classes/[classId]", "page");
    return { ok: true, data: z.object({ changedSessions: z.number(), preservedSessions: z.number(), changeId: uuid }).parse(data) };
  } catch (error) { return actionError(error, MATERIAL_ERROR_CODES); }
}
