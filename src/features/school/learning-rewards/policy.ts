import { z } from "zod";
import { mistakeRulesSchema, type MistakeRules } from "../learning-mistakes/contract";
import { rewardDrawPoolSchema, type RewardDrawPool } from "./contract";

export const policyKeySchema = z.string().regex(/^(mistakes|draw:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
export type PolicyConfig = MistakeRules | RewardDrawPool;
export type LearningPolicy<T extends PolicyConfig = PolicyConfig> = { published: T | null; draft: T | null; draftVersion: number; baseVersion: number };
export function parseLearningPolicyConfig(key: string, value: unknown): PolicyConfig {
  policyKeySchema.parse(key);
  const result = key === "mistakes" ? mistakeRulesSchema.parse(value) : rewardDrawPoolSchema.parse(value);
  if (key !== "mistakes" && (result as RewardDrawPool).id !== key.slice(5)) throw new Error("VALIDATION");
  return result;
}
