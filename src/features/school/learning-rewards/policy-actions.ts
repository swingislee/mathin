"use server";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { authorizedClient } from "../actions/guards";
import { rewardErrors } from "./contract";
import { parseLearningPolicyConfig, policyKeySchema, type LearningPolicy, type PolicyConfig } from "./policy";

async function rpc(name: string, args: Record<string, unknown>): Promise<LearningPolicy> {
  const { supabase } = await authorizedClient("organization.profile.manage");
  const result = await (supabase.rpc as unknown as RegistrationRpc)(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as LearningPolicy;
}
export async function loadLearningPolicy(key: string): Promise<ActionResult<LearningPolicy>> {
  try { return { ok: true, data: await rpc("read_learning_policy", { p_key: policyKeySchema.parse(key) }) }; }
  catch (error) { return actionError(error, Object.keys(rewardErrors)); }
}
export async function saveLearningPolicyDraft(key: string, draftVersion: number, baseVersion: number, config: PolicyConfig): Promise<ActionResult<LearningPolicy>> {
  try { return { ok: true, data: await rpc("save_learning_policy_draft", { p_key: policyKeySchema.parse(key), p_draft_version: z.number().int().nonnegative().parse(draftVersion),
    p_base_version: z.number().int().nonnegative().parse(baseVersion), p_config: parseLearningPolicyConfig(key, config) }) }; }
  catch (error) { return actionError(error, Object.keys(rewardErrors)); }
}
export async function publishLearningPolicy(key: string, draftVersion: number): Promise<ActionResult<LearningPolicy>> {
  try { return { ok: true, data: await rpc("publish_learning_policy", { p_key: policyKeySchema.parse(key), p_draft_version: z.number().int().positive().parse(draftVersion) }) }; }
  catch (error) { return actionError(error, Object.keys(rewardErrors)); }
}
