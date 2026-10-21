import { z } from "zod";
import { learningStatuses } from "../learning-rewards/contract";
export { learningStatuses, learningStatusNames, rewardErrors as mistakeErrors } from "../learning-rewards/contract";
export const mistakeRulesSchema = z.object({ version: z.number().int().positive(), enabled: z.boolean(), classroom_enabled: z.boolean(), homework_enabled: z.boolean(),
  statuses: z.array(z.enum(learningStatuses)).min(1).max(6).refine(v => new Set(v).size === v.length),
  history_mode: z.enum(["current", "retain"]).default("current"), mastered_statuses: z.array(z.enum(learningStatuses)).max(6).default([]),
}).refine(v => new Set(v.mastered_statuses).size === v.mastered_statuses.length && !v.mastered_statuses.some(s => v.statuses.includes(s)));
export const mistakeKey = z.string().regex(/^(classroom|homework):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
export type MistakeRules = z.infer<typeof mistakeRulesSchema>;
export type MistakeRecord = { id: string; kind: "classroom" | "homework"; question_id: string; title: string; source_id: string; source_title: string; classroom_name: string;
  lesson_at: string; status: typeof learningStatuses[number]; note: string; marked_at: string; source_page: string | null; instructions?: string; included: boolean; mastered?: boolean; collected_at?: string | null };
export type MistakePage = { enabled: boolean; items: MistakeRecord[]; next: string | null; rules: MistakeRules };
