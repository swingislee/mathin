import { runtimeText as t, type RuntimeBlockSpec, type RuntimeEntrySpec, type RuntimeScreenSpec, type RuntimeSpec } from "../../../../contracts/participant-api/runtime";

const entries: RuntimeEntrySpec[] = [
  { id: "points-entry", label: t("我的积分", "My points"), icon: "complete", action: { type: "screen", screen: "learning-points" } },
  { id: "prizes-entry", label: t("积分兑换", "Redeem points"), icon: "activity", action: { type: "screen", screen: "learning-prizes" } },
  { id: "draws-entry", label: t("积分抽取", "Points draws"), icon: "complete", action: { type: "screen", screen: "learning-draws" } },
  { id: "mistakes-entry", label: t("回顾整理", "Review"), icon: "book", action: { type: "screen", screen: "learning-mistakes" } },
  { id: "collection-entry", label: t("我的收藏", "My collection"), icon: "book", action: { type: "screen", screen: "learning-collection" } },
  { id: "reward-orders-entry", label: t("获得与领取", "Rewards and pickups"), icon: "ticket", action: { type: "screen", screen: "learning-rewards-history" } },
];
function menu(blocks: RuntimeBlockSpec[], id: string): RuntimeBlockSpec[] {
  const prior = blocks.find(b => b.id === id && b.type === "entries");
  return prior ? blocks.map(b => b.id === id && b.type === "entries" ? { ...b, items: [...b.items, ...entries.filter(e => !b.items.some(old => old.id === e.id))] } : b)
    : [...blocks, { id, type: "entries", title: t("积分与收藏", "Points and collection"), style: "grid", visibleWhen: { kind: "hasParticipants" }, items: entries }];
}

export const rewardScreens: RuntimeScreenSpec[] = [{
  id: "learning-points", title: t("我的积分", "My points"), navigation: "title", blocks: [
    { id: "points-child", type: "participants", title: t(), empty: t("请先关联参与人", "Link a participant first") },
    { id: "points-balance", type: "metrics", title: t(), columns: 2, items: [], source: "rewards.balance" },
    { id: "points-rules", type: "collapse", title: t("积分规则", "Points rules"), summary: t(), open: false, blocks: [
      { id: "points-rules-list", type: "list", title: t(), source: "rewards.rules", template: "row", limit: 10, empty: t(), actionLabel: t(), facets: [] },
    ] },
    { id: "points-ledger", type: "list", title: t("积分明细", "Points history"), source: "rewards.ledger", template: "row", limit: 30,
      empty: t("还没有积分记录", "No points yet"), actionLabel: t(), facets: [] },
  ],
}, ...([
  { id: "learning-prizes", title: t("积分兑换", "Redeem points"), source: "rewards.catalog", empty: t("暂未上架奖品", "No prizes available"), template: "card" },
  { id: "learning-draws", title: t("积分抽取", "Points draws"), source: "rewards.draws", empty: t("暂无开放的奖池", "No pools available"), template: "card" },
  { id: "learning-draw", title: t("规则与抽取", "Rules and draw"), source: "rewards.drawDetail", empty: t("请从奖池列表进入", "Choose a pool from the list"), template: "message" },
  { id: "learning-mistakes", title: t("回顾整理", "Review"), source: "learning.mistakes", empty: t("暂无符合收录规则的题目", "No questions match the inclusion rules"), template: "row" },
  { id: "learning-mistake", title: t("回顾详情", "Review details"), source: "learning.mistakeDetail", empty: t("请从回顾列表选择题目", "Choose a question from the list"), template: "message" },
  { id: "learning-collection", title: t("我的收藏", "My collection"), source: "rewards.collection", empty: t("还没有收藏", "No collectibles yet"), template: "tile" },
  { id: "learning-rewards-history", title: t("获得与领取", "Rewards and pickups"), source: "rewards.orders", empty: t("还没有获得记录", "No rewards yet"), template: "row" },
] as const).map(s => ({ id: s.id, title: s.title, navigation: "title" as const, blocks: [
  { id: s.id + "-child", type: "participants" as const, title: t(), empty: t("请先关联参与人", "Link a participant first") },
  { id: s.id + "-list", type: "list" as const, title: t(), source: s.source, template: s.template, limit: 30, empty: s.empty, actionLabel: t(), facets: s.id === "learning-mistakes" ? ["kind", "status"] : [] },
  { id: s.id + "-points", type: "button" as const, label: t("我的积分", "My points"), appearance: "secondary" as const, action: { type: "screen" as const, screen: "learning-points" } },
] }))];

/** Explicit editor action: existing pages and customizations stay intact. */
export function addRewardScreens(spec: RuntimeSpec): RuntimeSpec {
  const existing = new Set(spec.screens.map(s => s.id));
  const account = spec.screens.find(s => s.blocks.some(b => b.type === "account"))?.id || spec.tabs.find(t => t.slot === 3)?.screen;
  return { ...spec, screens: [...spec.screens, ...rewardScreens.filter(s => !existing.has(s.id))].map(s =>
    s.id === account ? { ...s, blocks: menu(s.blocks, "learning-services") } : s.id === "learning-points" ? { ...s, blocks: menu(s.blocks, "points-menu") } : s) };
}
