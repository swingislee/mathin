"use server";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { authorizedClient } from "../actions/guards";
import { rewardRulesSchema, rewardErrors, type RewardAccount, type RewardRules, type RewardStudent } from "./contract";

const errors = Object.keys(rewardErrors);
async function rpc(name: string, args: Record<string, unknown>) {
  const { supabase } = await authorizedClient("organization.profile.manage");
  const result = await (supabase.rpc as unknown as RegistrationRpc)(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
export async function loadRewardRules(): Promise<ActionResult<RewardRules>> {
  try {
    const { supabase } = await authorizedClient("organization.profile.manage");
    const result = await supabase.from("learning_reward_rules").select("*").single();
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: rewardRulesSchema.parse(result.data) };
  } catch (error) { return actionError(error, errors); }
}
export async function saveRewardRules(value: RewardRules): Promise<ActionResult<RewardRules>> {
  try {
    const r = rewardRulesSchema.parse(value);
    const data = await rpc("save_learning_reward_rules", { p_version: r.version, p_stars_enabled: r.stars_enabled, p_points_per_star: r.points_per_star,
      p_homework_enabled: r.homework_enabled, p_homework_points: r.homework_points, p_homework_statuses: r.homework_statuses });
    return { ok: true, data: rewardRulesSchema.parse(data) };
  } catch (error) { return actionError(error, errors); }
}
export async function searchRewardStudents(query: string): Promise<ActionResult<RewardStudent[]>> {
  try {
    const q = z.string().trim().min(1).max(60).parse(query).replace(/[%_\\]/g, "");
    if (!q) throw new Error("VALIDATION");
    const { supabase } = await authorizedClient("organization.profile.manage");
    const result = await supabase.from("students").select("id,name,purpose,grade").is("deleted_at", null).ilike("name", `%${q}%`).order("name").order("id").limit(30);
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: result.data };
  } catch (error) { return actionError(error, errors); }
}
export async function loadRewardAccount(student: string, before?: string): Promise<ActionResult<RewardAccount>> {
  try { return { ok: true, data: await rpc("read_learning_points", { p_student: z.string().uuid().parse(student), p_before: before ? z.string().uuid().parse(before) : null }) as RewardAccount }; }
  catch (error) { return actionError(error, errors); }
}
export async function grantRewardPoints(id: string, student: string, amount: number, note: string): Promise<ActionResult> {
  try {
    const input = z.object({ id: z.string().uuid(), student: z.string().uuid(), amount: z.number().int().min(1).max(1000000), note: z.string().trim().min(1).max(500) }).parse({ id, student, amount, note });
    await rpc("grant_learning_points", { p_id: input.id, p_student: input.student, p_amount: input.amount, p_note: input.note });
    return { ok: true };
  } catch (error) { return actionError(error, errors); }
}
export async function reverseRewardPoints(entry: string, note: string): Promise<ActionResult> {
  try {
    await rpc("reverse_learning_points", { p_entry: z.string().uuid().parse(entry), p_note: z.string().trim().min(1).max(500).parse(note) });
    return { ok: true };
  } catch (error) { return actionError(error, errors); }
}
