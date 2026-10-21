import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PortalError, requireResult } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { rewardErrors, type RewardOrder, type RewardPage, type RewardPrize } from "@/features/school/learning-rewards/contract";
import type { RuntimeEffect, RuntimeLocale } from "../../../../contracts/participant-api/runtime";
import { item, dateTimeLabel, type RuntimeIdentity, type SourceInput, type SourceResult } from "../runtime/sources";

export type RewardCommand = { participant: string; params: Record<string, string>; locale: RuntimeLocale };
const text = (v: { zh: string; en: string }, locale: RuntimeLocale) => v[locale] || v.zh;

export function rewardFailure(code: string, locale: RuntimeLocale): RuntimeEffect[] | null {
  const message = rewardErrors[code];
  return message && ["INSUFFICIENT_POINTS", "OUT_OF_STOCK", "FORM_CHANGED", "NOT_FOUND", "POOL_UNAVAILABLE", "DRAW_LIMIT"].includes(code)
    ? [{ type: "toast", text: message[locale] }, { type: "refresh" }] : null;
}
export function orderEffects(order: RewardOrder, locale: RuntimeLocale, style: "card" | "wheel" = "card"): RuntimeEffect[] {
  const zh = locale === "zh", physical = order.snapshot.kind === "physical";
  const drawNote = [order.metadata?.tier && text(order.metadata.tier, locale), order.metadata?.guaranteed ? (zh ? "本次为保底抽取" : "Guaranteed draw") : ""].filter(Boolean).join(" · ");
  return [{ type: "reveal", style, title: text(order.snapshot.title, locale), image: order.snapshot.image || (physical ? "asset:icons/activity" : "asset:icons/complete"),
    body: [drawNote, physical ? (zh ? `领取码 ${order.pickup_code}\n${text(order.snapshot.pickupInstructions, locale)}` : `Pickup code ${order.pickup_code}\n${text(order.snapshot.pickupInstructions, locale)}`)
      : (zh ? "已加入我的收藏" : "Added to your collection")].filter(Boolean).join("\n"),
    action: { type: "screen", screen: physical ? "learning-rewards-history" : "learning-collection" } }, { type: "refresh" }];
}
export async function redeemCommand(input: RewardCommand, identity: RuntimeIdentity): Promise<RuntimeEffect[]> {
  if (!identity.db || !input.participant || input.participant !== identity.participant) throw new PortalError("FORBIDDEN");
  const data = z.object({ intentId: z.string().uuid(), prizeId: z.string().uuid(), offerVersion: z.coerce.number().int().positive() }).parse(input.params);
  // The view carries the operation id. Even clients that create a new transport id on retry reuse it.
  const result = await (identity.db.rpc as unknown as RegistrationRpc)("redeem_learning_prize", {
    p_id: data.intentId, p_student: input.participant, p_prize: data.prizeId, p_offer_version: data.offerVersion,
  });
  if (result.error) { const effects = rewardFailure(result.error.message, input.locale); if (effects) return effects; }
  return orderEffects(requireResult(result) as RewardOrder, input.locale);
}
export async function commerceSource(source: string, input: SourceInput): Promise<SourceResult> {
  const { db, participant } = input.identity;
  if (!db || !participant) return { items: [], facets: [] };
  const zh = input.locale === "zh", catalog = source === "rewards.catalog";
  const page = requireResult(await (db.rpc as unknown as RegistrationRpc)(catalog ? "read_learning_reward_catalog" : "read_learning_reward_orders", {
    p_student: participant, p_before: input.cursor || null, ...(!catalog ? { p_kind: source === "rewards.collection" ? "digital" : "" } : {}),
  })) as RewardPage<RewardPrize | RewardOrder>;
  const rows = page.items.slice(0, input.limit ?? 30);
  return { facets: [], next: rows.length && (page.next || page.items.length > rows.length) ? rows.at(-1)!.id : "", items: rows.map(raw => {
    if (catalog) {
      const p = raw as RewardPrize, out = p.stock === 0;
      return item({ id: p.id, title: text(p.title, input.locale), summary: text(p.description, input.locale), image: p.image || (p.kind === "physical" ? "asset:icons/activity" : "asset:icons/complete"),
        tags: [p.kind === "digital" ? (zh ? "数字收藏" : "Digital collectible") : (zh ? "实物奖品" : "Physical prize")],
        meta: [zh ? `${p.points_cost} 积分` : `${p.points_cost} points`, p.stock === null ? (zh ? "数量不限" : "Unlimited") : (zh ? `剩余 ${p.stock}` : `${p.stock} remaining`)],
        status: out ? { label: zh ? "已领完" : "Out of stock", tone: "muted" } : null,
        actionLabel: zh ? "兑换" : "Redeem", action: out ? null : { type: "command", command: "rewards.redeem",
          params: { prizeId: p.id, offerVersion: String(p.offer_version), intentId: randomUUID() },
          confirm: { zh: `使用 ${p.points_cost} 积分兑换「${p.title.zh}」？`, en: `Redeem “${p.title.en || p.title.zh}” for ${p.points_cost} points?` } } });
    }
    const o = raw as RewardOrder, s = o.snapshot, physical = s.kind === "physical";
    const status = { collected: ["已收藏", "Collected"], pending: ["待领取", "Awaiting pickup"], received: ["已领取", "Received"] };
    return item({ id: o.id, title: text(s.title, input.locale), subtitle: dateTimeLabel(o.created_at), image: s.image || (physical ? "asset:icons/activity" : "asset:icons/complete"),
      summary: physical ? text(s.pickupInstructions, input.locale) : text(s.description, input.locale),
      status: { label: status[o.status][zh ? 0 : 1], tone: o.status === "pending" ? "warning" : "positive" },
      meta: [zh ? `使用 ${o.points_spent} 积分` : `${o.points_spent} points`, ...(o.origin === "draw" ? [zh ? "抽取获得" : "Won in a draw", ...(o.metadata?.tier ? [text(o.metadata.tier, input.locale)] : []), ...(o.metadata?.guaranteed ? [zh ? "保底" : "Guaranteed"] : [])] : []), ...(o.status === "pending" ? [zh ? `领取码 ${o.pickup_code}` : `Pickup code ${o.pickup_code}`] : [])],
      actionLabel: zh ? "复制领取码" : "Copy pickup code", action: o.status === "pending" && o.pickup_code ? { type: "copy", text: o.pickup_code } : null });
  }) };
}
