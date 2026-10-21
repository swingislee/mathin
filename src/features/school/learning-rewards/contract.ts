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
  POOL_UNAVAILABLE: { zh: "奖池中有奖品暂不可用，恢复后可继续抽取。", en: "A prize is unavailable. Draws will resume when it is restored." },
  DRAW_LIMIT: { zh: "已达到本奖池的抽取次数限制。", en: "The draw limit for this pool has been reached." },
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
  metadata?: { poolTitle?: { zh: string; en: string }; tier?: { zh: string; en: string }; guaranteed?: boolean; isPity?: boolean; drawNumber?: number };
  snapshot: { title: { zh: string; en: string }; description: { zh: string; en: string }; image: string; kind: "digital" | "physical"; pickupInstructions: { zh: string; en: string }; offerVersion: number; pointsCost: number } };
export type RewardPage<T> = { items: T[]; next: string | null };

export const rewardRarities = ["R", "SR", "SSR", "SP", "UR"] as const;
export const drawMechanismSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("weighted") }),
  z.object({ mode: z.literal("rarity"), rates: z.object({ R: z.number().int().min(0).max(1000000), SR: z.number().int().min(0).max(1000000), SSR: z.number().int().min(0).max(1000000), SP: z.number().int().min(0).max(1000000), UR: z.number().int().min(0).max(1000000) }),
    pities: z.array(z.object({ minRarity: z.enum(["SR", "SSR", "SP", "UR"]), after: z.number().int().min(1).max(1000000) })).max(4) }),
]);
export const rewardDrawPoolSchema = z.object({
  id: z.string().uuid(), version: z.number().int().nonnegative(), title: prizeText(80, true), description: prizeText(1000), enabled: z.boolean(),
  points_cost: z.number().int().min(1).max(1000000), daily_limit: z.number().int().min(0).max(10000),
  total_limit: z.number().int().min(0).max(1000000), pity_after: z.number().int().min(0).max(1000000),
  mechanism: drawMechanismSchema.optional(),
  entries: z.array(z.object({ prize_id: z.string().uuid(), weight: z.number().int().min(1).max(1000000), tier: prizeText(40), is_pity: z.boolean(), rarity: z.enum(rewardRarities).optional() })).min(1).max(50),
}).refine(v => new Set(v.entries.map(e => e.prize_id)).size === v.entries.length && (!v.pity_after || v.entries.some(e => e.is_pity)))
  .refine(v => { const m = v.mechanism; return m?.mode !== "rarity" || (v.pity_after === 0 && Object.values(m.rates).reduce((a, b) => a + b, 0) === 1000000
    && v.entries.every(e => e.rarity && m.rates[e.rarity] > 0) && rewardRarities.every(r => m.rates[r] === 0 || v.entries.some(e => e.rarity === r))
    && new Set(m.pities.map(p => p.minRarity)).size === m.pities.length && m.pities.every(p => rewardRarities.some(r => rewardRarities.indexOf(r) >= rewardRarities.indexOf(p.minRarity) && m.rates[r] > 0))); });
export type RewardDrawPool = z.infer<typeof rewardDrawPoolSchema>;
/** Rarity selection followed by prize weights can produce very small, nonzero probabilities. */
export function rewardProbability(weight: number, total: number): string {
  const percent = total > 0 ? weight / total * 100 : 0;
  const small = percent > 0 && percent < 0.0001;
  const value = percent.toFixed(small ? Math.min(16, Math.max(6, Math.ceil(-Math.log10(percent)) + 2)) : 4);
  return `${small ? value.replace(/0+$/, "") : value}%`;
}
export type RewardDrawView = Omit<RewardDrawPool, "entries"> & {
  entries: (RewardDrawPool["entries"][number] & Pick<RewardPrize, "title" | "image" | "kind" | "stock" | "enabled"> & { base_probability?: number; actual_probability?: number })[];
  total_draws: number; since_pity: number; today_draws: number; guaranteed: boolean; blocked: string;
  rarity_counts?: Partial<Record<typeof rewardRarities[number], number>>; forced_rank?: number;
};
