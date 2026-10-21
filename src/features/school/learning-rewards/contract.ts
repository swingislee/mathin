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
  INSUFFICIENT_POINTS: { zh: "可用积分不足。", en: "Not enough points." },
  OUT_OF_STOCK: { zh: "这件奖品已领完，请刷新查看。", en: "This prize is out of stock. Refresh to see others." },
  FORBIDDEN: { zh: "当前账号没有此操作权限。", en: "You do not have permission." },
  UNAUTHENTICATED: { zh: "请重新登录。", en: "Please sign in again." },
  VALIDATION: { zh: "请检查输入的数值和必填内容。", en: "Check the values and required fields." },
  FORM_CHANGED: { zh: "规则已被其他人更新，请重新读取后编辑。", en: "Rules changed. Reload before editing." },
  CONFLICT: { zh: "这次操作已使用不同内容提交，请重新读取。", en: "This request was submitted with different content. Reload." },
  NOT_FOUND: { zh: "未找到这条记录。", en: "Record not found." },
};

const prizeText = (max: number, required = false) => z.object({ zh: required ? z.string().trim().min(1).max(max) : z.string().max(max), en: z.string().max(max) }).strict();
export const rewardPrizeSchema = z.object({
  id: z.string().uuid(), version: z.number().int().nonnegative(), title: prizeText(80, true), description: prizeText(1000),
  pickup_instructions: prizeText(500), kind: z.enum(["digital", "physical"]), image: z.string().max(500).refine(v => !v || /^https:\/\/\S+$/.test(v) || /^asset:icons\/[a-z-]+$/.test(v)),
  points_cost: z.number().int().min(1).max(1000000), stock: z.number().int().min(0).max(1000000).nullable(), enabled: z.boolean(), redeem_enabled: z.boolean(),
}).refine(v => v.kind === "digital" || v.stock !== null);
export type RewardPrizeInput = z.infer<typeof rewardPrizeSchema>;
export type RewardPrize = RewardPrizeInput & { offer_version: number; created_at: string };
export type RewardOrder = { id: string; origin: "redeem" | "draw"; points_spent: number; status: "collected" | "pending" | "received";
  pickup_code: string | null; created_at: string; fulfilled_at: string | null; student_name?: string;
  snapshot: { title: { zh: string; en: string }; description: { zh: string; en: string }; image: string; kind: "digital" | "physical"; pickupInstructions: { zh: string; en: string }; offerVersion: number; pointsCost: number } };
export type RewardPage<T> = { items: T[]; next: string | null };
