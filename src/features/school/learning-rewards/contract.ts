import { z } from "zod";

export const learningStatuses = ["explained", "independent", "prompted", "imitated", "incomplete", "unchecked"] as const;
export const learningStatusNames = {
  explained: { zh: "讲明白", en: "Can explain" }, independent: { zh: "独立完成", en: "Independent" },
  prompted: { zh: "提示完成", en: "With prompts" }, imitated: { zh: "模仿完成", en: "With examples" },
  incomplete: { zh: "未完成", en: "Incomplete" }, unchecked: { zh: "未检查", en: "Unchecked" },
};
export const rewardRulesSchema = z.object({
  version: z.number().int().positive(), stars_enabled: z.boolean(), points_per_star: z.number().int().min(0).max(10000),
  homework_enabled: z.boolean(), homework_points: z.number().int().min(0).max(10000),
  homework_statuses: z.array(z.enum(["explained", "independent", "prompted", "imitated", "incomplete"])).min(1).max(5),
});
export type RewardRules = z.infer<typeof rewardRulesSchema>;
export type RewardEntry = { id: string; source: string; amount: number; balance_after: number; note: string; created_at: string; snapshot: Record<string, unknown> };
export type RewardAccount = { balance: number; available: number; entries: RewardEntry[]; next: string | null;
  rules: { starsEnabled: boolean; pointsPerStar: number; homeworkEnabled: boolean; homeworkPoints: number; homeworkStatuses: (typeof learningStatuses[number])[] } };
export type RewardStudent = { id: string; name: string; purpose: string; grade: number | null };
export const rewardErrors: Record<string, { zh: string; en: string }> = {
  FORBIDDEN: { zh: "当前账号没有此操作权限。", en: "You do not have permission." },
  UNAUTHENTICATED: { zh: "请重新登录。", en: "Please sign in again." },
  VALIDATION: { zh: "请检查输入的数值和必填内容。", en: "Check the values and required fields." },
  FORM_CHANGED: { zh: "规则已被其他人更新，请重新读取后编辑。", en: "Rules changed. Reload before editing." },
  CONFLICT: { zh: "这次操作已使用不同内容提交，请重新读取。", en: "This request was submitted with different content. Reload." },
  NOT_FOUND: { zh: "未找到这条记录。", en: "Record not found." },
};
