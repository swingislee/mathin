"use server";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { authorizedClient } from "../actions/guards";
import { mistakeErrors, mistakeKey, mistakeRulesSchema, type MistakePage, type MistakeRules } from "./contract";
const errors = Object.keys(mistakeErrors);
export async function loadMistakeRules(): Promise<ActionResult<MistakeRules>> {
  try {
    const { supabase } = await authorizedClient("organization.profile.manage");
    const result = await (supabase.rpc as unknown as RegistrationRpc)("read_learning_mistake_rules", {});
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: mistakeRulesSchema.parse(result.data) };
  } catch (error) { return actionError(error, errors); }
}
export async function saveMistakeRules(value: MistakeRules): Promise<ActionResult<MistakeRules>> {
  try {
    const r = mistakeRulesSchema.parse(value), { supabase } = await authorizedClient("organization.profile.manage");
    const result = await (supabase.rpc as unknown as RegistrationRpc)("save_learning_mistake_rules", { p_version: r.version, p_enabled: r.enabled, p_classroom: r.classroom_enabled, p_homework: r.homework_enabled, p_statuses: r.statuses });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: mistakeRulesSchema.parse(result.data) };
  } catch (error) { return actionError(error, errors); }
}
export async function loadMistakes(student: string, before?: string, item?: string): Promise<ActionResult<MistakePage>> {
  try {
    const { supabase } = await authorizedClient("organization.profile.manage");
    const result = await (supabase.rpc as unknown as RegistrationRpc)("read_learning_mistakes", { p_student: z.string().uuid().parse(student), p_before: before ? mistakeKey.parse(before) : null, p_item: item ? mistakeKey.parse(item) : null });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: result.data as MistakePage };
  } catch (error) { return actionError(error, errors); }
}
