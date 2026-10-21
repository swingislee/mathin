import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PortalError, requireResult } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { rewardErrors, rewardProbability, type RewardDrawView, type RewardOrder, type RewardPage } from "@/features/school/learning-rewards/contract";
import type { RuntimeEffect } from "../../../../contracts/participant-api/runtime";
import { item, type RuntimeIdentity, type SourceInput, type SourceResult } from "../runtime/sources";
import { orderEffects, rewardFailure, type RewardCommand } from "./commerce";

export async function drawCommand(input: RewardCommand, identity: RuntimeIdentity): Promise<RuntimeEffect[]> {
  if (!identity.db || !input.participant || input.participant !== identity.participant) throw new PortalError("FORBIDDEN");
  const p = z.object({ intentId: z.string().uuid(), poolId: z.string().uuid(), version: z.coerce.number().int().positive(), expectedTotal: z.coerce.number().int().nonnegative() }).parse(input.params);
  const result = await (identity.db.rpc as unknown as RegistrationRpc)("draw_learning_reward", { p_id: p.intentId, p_student: input.participant, p_pool: p.poolId, p_version: p.version, p_expected_total: p.expectedTotal });
  if (result.error) { const effects = rewardFailure(result.error.message, input.locale); if (effects) return effects; }
  return orderEffects(requireResult(result) as RewardOrder, input.locale, "wheel");
}
export async function drawsSource(source: string, input: SourceInput): Promise<SourceResult> {
  const { db, participant } = input.identity;
  if (!db || !participant) return { items: [], facets: [] };
  const detail = source === "rewards.drawDetail", zh = input.locale === "zh";
  const poolId = detail ? z.string().uuid().safeParse(input.params?.poolId) : null;
  if (detail && !poolId?.success) return { items: [], facets: [] };
  const page = requireResult(await (db.rpc as unknown as RegistrationRpc)("read_learning_reward_draws", { p_student: participant, p_pool: poolId?.success ? poolId.data : null, p_before: detail ? null : input.cursor || null })) as RewardPage<RewardDrawView>;
  const text = (v: { zh: string; en: string }) => v[input.locale] || v.zh;
  if (!detail) {
    const rows = page.items.slice(0, input.limit ?? 30);
    return { facets: [], next: rows.length && (page.next || page.items.length > rows.length) ? rows.at(-1)!.id : "", items: rows.map(p => item({ id: p.id, title: text(p.title), summary: text(p.description),
      meta: [zh ? `${p.points_cost} 积分／次` : `${p.points_cost} points / draw`, p.mechanism?.mode === "rarity" ? "R / SR / SSR / SP / UR" : p.pity_after ? (zh ? `${p.pity_after} 次内保底` : `Guaranteed within ${p.pity_after} draws`) : (zh ? "无保底" : "No guarantee")],
      status: p.blocked ? { label: zh ? "暂不可抽取" : "Unavailable", tone: "muted" } : null,
      actionLabel: zh ? "查看规则与概率" : "Rules and probabilities", action: { type: "screen", screen: "learning-draw", params: { poolId: p.id } } })) };
  }
  const p = page.items[0]; if (!p) return { items: [], facets: [] };
  const rarityRules = p.mechanism?.mode === "rarity" ? p.mechanism.pities.map(rule => zh ? `${rule.minRarity} 或以上：最多再抽 ${Math.max(1, rule.after - (p.rarity_counts?.[rule.minRarity] || 0))} 次必得；获得对应或更高档后重计。` : `${rule.minRarity} or above: within ${Math.max(1, rule.after - (p.rarity_counts?.[rule.minRarity] || 0))} more draws; resets on a win at or above this rarity.`) : [];
  const sum = p.entries.reduce((n, e) => n + e.weight, 0), guaranteedSum = p.entries.reduce((n, e) => n + (e.is_pity ? e.weight : 0), 0);
  const rules = [zh ? `每次消耗 ${p.points_cost} 积分，每次获得一件奖品。` : `${p.points_cost} points per draw. Every draw awards one prize.`,
    p.daily_limit ? (zh ? `今日剩余 ${Math.max(0, p.daily_limit - p.today_draws)}／${p.daily_limit} 次（北京时间零点重置）` : `${Math.max(0, p.daily_limit - p.today_draws)} / ${p.daily_limit} draws left today (Shanghai midnight reset)`) : (zh ? "每日次数不限" : "No daily limit"),
    p.total_limit ? (zh ? `累计剩余 ${Math.max(0, p.total_limit - p.total_draws)}／${p.total_limit} 次` : `${Math.max(0, p.total_limit - p.total_draws)} / ${p.total_limit} lifetime draws left`) : (zh ? "累计次数不限" : "No lifetime limit"),
    ...(p.mechanism?.mode === "rarity" ? [...rarityRules, zh ? "同时触发多档保底时采用最高档，其上各档按基础概率的相对比例抽取。" : "Simultaneous guarantees use the highest threshold and relative base rates above it."] : [p.pity_after ? (zh ? `最多再抽 ${Math.max(1, p.pity_after - p.since_pity)} 次必得保底奖品。跨天累计，命中任一保底奖品后重新计数。` : `A guaranteed prize within ${Math.max(1, p.pity_after - p.since_pity)} more draws. Progress carries across days and restarts on any guaranteed prize.`) : (zh ? "此奖池未设置保底" : "This pool has no guarantee")]),
    zh ? "任一奖品缺货时整个奖池暂停。规则调整后累计次数保留，下一次使用当时公布的规则。" : "The pool pauses if any prize is unavailable. Counts survive rule changes; the next draw uses the published rules."];
  // The message template renders full text; ordinary row summaries clamp after two lines.
  const rates = p.entries.map(e => {
    const base = e.base_probability === undefined ? rewardProbability(e.weight, sum) : rewardProbability(e.base_probability, 1), actual = e.actual_probability === undefined ? rewardProbability(e.is_pity ? e.weight : 0, guaranteedSum) : rewardProbability(e.actual_probability, 1);
    return `${text(e.title)}${text(e.tier) ? ` · ${text(e.tier)}` : ""}${e.is_pity ? (zh ? "（保底奖）" : " (guaranteed prize)") : ""}: ${zh ? "基础" : "base"} ${base}${p.guaranteed ? ` · ${zh ? "本次" : "this draw"} ${actual}` : ""}`;
  });
  return { facets: [], items: [item({ id: p.id, title: text(p.title), summary: [text(p.description), ...rules, ...rates, p.blocked ? rewardErrors[p.blocked]?.[input.locale] : ""].filter(Boolean).join("\n"),
    subtitle: zh ? `已抽 ${p.total_draws} 次${p.guaranteed ? " · 本次触发保底" : ""}` : `${p.total_draws} draws completed${p.guaranteed ? " · Guaranteed draw" : ""}` }),
    ...(!p.blocked ? [item({ id: p.id + "-draw", title: zh ? `使用 ${p.points_cost} 积分抽取` : `Draw for ${p.points_cost} points`, summary: zh ? "点此确认抽取" : "Tap to confirm your draw",
    actionLabel: zh ? `使用 ${p.points_cost} 积分抽取` : `Draw for ${p.points_cost} points`, action: p.blocked ? null : { type: "command", command: "rewards.draw",
      params: { intentId: randomUUID(), poolId: p.id, version: String(p.version), expectedTotal: String(p.total_draws) },
      confirm: { zh: `使用 ${p.points_cost} 积分抽取「${p.title.zh}」？`, en: `Draw from “${p.title.en || p.title.zh}” for ${p.points_cost} points?` } } })] : [])] };
}
