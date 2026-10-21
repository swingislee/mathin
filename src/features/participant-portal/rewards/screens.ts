import { runtimeText as t, type RuntimeScreenSpec, type RuntimeSpec } from "../../../../contracts/participant-api/runtime";

export const rewardScreens: RuntimeScreenSpec[] = [{
  id: "learning-points", title: t("我的积分", "My points"), navigation: "title", blocks: [
    { id: "points-child", type: "participants", title: t(), empty: t("请先关联孩子", "Link a child first") },
    { id: "points-balance", type: "metrics", title: t(), columns: 2, items: [], source: "rewards.balance" },
    { id: "points-rules", type: "collapse", title: t("积分规则", "Points rules"), summary: t(), open: false, blocks: [
      { id: "points-rules-list", type: "list", title: t(), source: "rewards.rules", template: "row", limit: 10, empty: t(), actionLabel: t(), facets: [] },
    ] },
    { id: "points-ledger", type: "list", title: t("积分明细", "Points history"), source: "rewards.ledger", template: "row", limit: 30,
      empty: t("还没有积分记录", "No points yet"), actionLabel: t(), facets: [] },
  ],
}];

/** Explicit editor action: existing pages and customizations stay intact. */
export function addRewardScreens(spec: RuntimeSpec): RuntimeSpec {
  const existing = new Set(spec.screens.map(s => s.id));
  const account = spec.screens.find(s => s.blocks.some(b => b.type === "account"))?.id || spec.tabs.find(t => t.slot === 3)?.screen;
  return { ...spec, screens: [...spec.screens.map(s => s.id !== account || s.blocks.some(b => b.id === "learning-services") ? s : { ...s, blocks: [...s.blocks, {
    id: "learning-services", type: "entries" as const, title: t("学习成长", "Learning"), style: "grid" as const, visibleWhen: { kind: "hasParticipants" as const },
    items: [{ id: "points-entry", label: t("我的积分", "My points"), icon: "complete", action: { type: "screen" as const, screen: "learning-points" } }],
  }] }), ...rewardScreens.filter(s => !existing.has(s.id))] };
}
