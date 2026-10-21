"use client";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DashboardCommandActions, DashboardCommandPanel, DashboardPage } from "../dashboard-page";
import { newId } from "@/lib/uuid";
import { loadRewardDrawPools } from "./actions";
import { loadLearningPolicy, saveLearningPolicyDraft, publishLearningPolicy } from "./policy-actions";
import type { LearningPolicy } from "./policy";
import { DrawMechanismEditor } from "./DrawMechanismEditor";
import { rewardRarities } from "./contract";
import { rewardErrors, rewardProbability, type RewardDrawPool, type RewardPrize } from "./contract";

const emptyPool = (): RewardDrawPool => ({ id: newId(), version: 0, title: { zh: "", en: "" }, description: { zh: "", en: "" }, enabled: false,
  points_cost: 10, daily_limit: 1, total_limit: 0, pity_after: 0, entries: [] });
export function DrawConsole({ initial, prizes, locale }: { initial: RewardDrawPool[]; prizes: RewardPrize[]; locale: "zh" | "en" }) {
  const L = (zh: string, en: string) => locale === "zh" ? zh : en;
  const name = (t: { zh: string; en: string }) => t[locale] || t.zh;
  const [pools, setPools] = useState(initial), [draft, setDraft] = useState<RewardDrawPool | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [policy, setPolicy] = useState<LearningPolicy<RewardDrawPool> | null>(null);
  const fail = (code: string) => setMessage(rewardErrors[code]?.[locale] || L("操作未完成，请重试。", "Could not complete. Retry."));
  const weight = draft?.entries.reduce((n, e) => n + e.weight, 0) || 0;
  const pityWeight = draft?.entries.reduce((n, e) => n + (e.is_pity ? e.weight : 0), 0) || 0;
  async function edit(pool: RewardDrawPool) {
    setBusy(true); setMessage("");
    try { const result = await loadLearningPolicy(`draw:${pool.id}`); if (!result.ok) { fail(result.code); return; }
      const value = result.data as LearningPolicy<RewardDrawPool>; setPolicy(value); setDraft(value.draft || value.published || pool);
    } catch { fail("UNKNOWN"); } finally { setBusy(false); }
  }
  async function save(publish = false) {
    if (!draft) return; setBusy(true); setMessage("");
    try {
      const saved = await saveLearningPolicyDraft(`draw:${draft.id}`, policy?.draftVersion || 0, policy?.baseVersion ?? draft.version, draft);
      if (!saved.ok) { fail(saved.code); return; }
      setPolicy(saved.data as LearningPolicy<RewardDrawPool>);
      if (!publish) { setMessage(L("草稿已保存，家长端规则保持当前发布版本。", "Draft saved. Families continue to use the published version.")); return; }
      const r = await publishLearningPolicy(`draw:${draft.id}`, saved.data.draftVersion);
      if (r.ok) { const value = r.data.published as RewardDrawPool; setPools(old => [value, ...old.filter(p => p.id !== value.id)]); setDraft(null); setPolicy(null); setMessage(L("奖池已发布，后续抽取使用新规则。", "Pool published. Future draws use the new rules.")); } else fail(r.code);
    }
    catch { fail("UNKNOWN"); } finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true); try { const r = await loadRewardDrawPools(); if (r.ok) setPools(r.data); else fail(r.code); } catch { fail("UNKNOWN"); } finally { setBusy(false); }
  }
  return <DashboardPage title={L("抽取与保底", "Draws and guarantees")} backHref="/dashboard/learning-rewards" backLabel={L("学习积分", "Learning rewards")}
    commandPanel={<DashboardCommandPanel><DashboardCommandActions><Button disabled={busy} onClick={() => edit(emptyPool())}>{L("新增奖池", "New pool")}</Button><Button variant="ghost" disabled={busy} onClick={reload}>{L("刷新", "Refresh")}</Button>
      <Link className={buttonVariants({ variant: "ghost" })} href="/dashboard/learning-rewards/prizes">{L("奖品与库存", "Prizes and stock")}</Link></DashboardCommandActions></DashboardCommandPanel>}>
    <p className="text-sm text-muted-foreground">{L("每次抽取获得一件奖品。概率与保底规则会展示给家长；任一奖品停用或缺货时，整个奖池暂停。次数与保底按孩子、奖池累计，跨天和规则调整均保留；每日限额按北京时间重置。", "Each draw awards one prize. Families see probabilities and guarantees. The whole pool pauses if any prize is unavailable. Counts and guarantee progress persist per child and pool across days and rule changes. Daily limits reset at midnight in Shanghai.")}</p>
    {message && <p role="status" className="py-2 text-sm">{message}</p>}
    {draft && <form onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-4 border-b border-line py-4"><fieldset disabled={busy} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">{(["zh", "en"] as const).map(lang => <label key={lang} className="space-y-1 text-sm">{lang === "zh" ? L("名称（中文）", "Name (Chinese)") : L("名称（英文，可选）", "Name (English, optional)")}<Input required={lang === "zh"} maxLength={80} value={draft.title[lang]} onChange={e => setDraft({ ...draft, title: { ...draft.title, [lang]: e.target.value } })} /></label>)}
        {(["points_cost", "daily_limit", "total_limit", "pity_after"] as const).filter(key => key !== "pity_after" || draft.mechanism?.mode !== "rarity").map(key => <label key={key} className="space-y-1 text-sm">{{ points_cost: L("每次消耗积分", "Points per draw"), daily_limit: L("每人每日次数（0 为不限）", "Daily limit per child (0 = unlimited)"), total_limit: L("每人累计次数（0 为不限）", "Lifetime limit per child (0 = unlimited)"), pity_after: L("最多连续几次必得保底奖（0 为关闭）", "Guaranteed within this many draws (0 = off)") }[key]}<Input type="number" required min={key === "points_cost" ? 1 : 0} max={key === "daily_limit" ? 10000 : 1000000} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: Number(e.target.value) })} /></label>)}
        {(["zh", "en"] as const).map(lang => <label key={lang} className="space-y-1 text-sm">{lang === "zh" ? L("规则说明（中文）", "Description (Chinese)") : L("规则说明（英文，可选）", "Description (English, optional)")}<Textarea rows={2} maxLength={1000} value={draft.description[lang]} onChange={e => setDraft({ ...draft, description: { ...draft.description, [lang]: e.target.value } })} /></label>)}
      </div>
      <DrawMechanismEditor pool={draft} onChange={setDraft} locale={locale} />
      <div className="space-y-3"><h2 className="font-semibold">{L("奖品与概率", "Prizes and probabilities")}</h2><p className="text-sm text-muted-foreground">{L(draft.mechanism?.mode === "rarity" ? "每件奖品选择 R / SR / SSR / SP / UR；权重只在同档位内比较。" : "基础概率 = 权重 ÷ 全部权重。触发保底时，只在勾选的保底奖品中按权重抽取；提前获得任一保底奖品也会重新累计。", "Base probability = weight / total weight. Guaranteed draws choose only marked prizes by weight. Any marked prize, including an early win, restarts the guarantee count.")}</p>
        {draft.entries.map((entry, index) => {
          const update = (patch: Partial<typeof entry>) => setDraft({ ...draft, entries: draft.entries.map((e, i) => i === index ? { ...e, ...patch } : e) });
          return <div key={index} className="grid items-end gap-2 rounded-md border border-line p-3 sm:grid-cols-6">
            <label className="text-sm sm:col-span-2">{L("奖品", "Prize")}<select required className="h-10 w-full rounded-md border border-line bg-paper px-2" value={entry.prize_id} onChange={e => update({ prize_id: e.target.value })}><option value="">{L("选择奖品", "Select prize")}</option>{prizes.filter(p => p.id === entry.prize_id || !draft.entries.some(e => e.prize_id === p.id)).map(p => <option value={p.id} key={p.id}>{name(p.title)}{!p.enabled || p.stock === 0 ? L("（暂不可用）", " (unavailable)") : ""}</option>)}</select></label>
            <label className="text-sm">{L("权重", "Weight")}<Input type="number" required min={1} max={1000000} value={entry.weight} onChange={e => update({ weight: Number(e.target.value) })} /></label>
            {draft.mechanism?.mode === "rarity" && <label className="text-sm">{L("稀有度", "Rarity")}<select className="h-10 w-full rounded-md border border-line bg-paper px-2" value={entry.rarity || "R"} onChange={e => update({ rarity: e.target.value as typeof rewardRarities[number] })}>{rewardRarities.map(r => <option key={r}>{r}</option>)}</select></label>}
            <label className="text-sm" hidden={draft.mechanism?.mode === "rarity"}>{L("展示名称（中文）", "Display label (Chinese)")}<Input maxLength={40} value={entry.tier.zh} onChange={e => update({ tier: { ...entry.tier, zh: e.target.value } })} /></label>
            <label className="text-sm" hidden={draft.mechanism?.mode === "rarity"}>{L("展示名称（英文）", "Display label (English)")}<Input maxLength={40} value={entry.tier.en} onChange={e => update({ tier: { ...entry.tier, en: e.target.value } })} /></label>
            <Button type="button" variant="ghost" onClick={() => setDraft({ ...draft, entries: draft.entries.filter((_, i) => i !== index) })}>{L("移除", "Remove")}</Button>
            <label className="flex items-center gap-2 text-sm sm:col-span-2" hidden={draft.mechanism?.mode === "rarity"}><input type="checkbox" checked={entry.is_pity} onChange={e => update({ is_pity: e.target.checked })} />{L("保底奖品", "Guaranteed prize")}</label>
            <span className="text-sm sm:col-span-4" hidden={draft.mechanism?.mode === "rarity"}>{L("基础", "Base")}: {rewardProbability(entry.weight, weight)}{entry.is_pity && draft.pity_after > 0 ? ` · ${L("触发保底时", "On guarantee")}: ${rewardProbability(entry.weight, pityWeight)}` : ""}</span>
          </div>;
        })}
        <Button type="button" variant="secondary" disabled={draft.entries.length >= 50 || draft.entries.length >= prizes.length} onClick={() => setDraft({ ...draft, entries: [...draft.entries, { prize_id: "", weight: 1, tier: { zh: "", en: "" }, is_pity: false, rarity: "R" }] })}>{L("添加奖品", "Add prize")}</Button>
        {!prizes.length && <p className="text-sm">{L("先在“奖品与库存”中创建奖品。", "Create prizes in Prizes and stock first.")}</p>}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />{L("开放抽取", "Enable draws")}</label>
    </fieldset><div className="flex gap-2"><Button disabled={busy || !draft.entries.length}>{L("保存草稿", "Save draft")}</Button><Button type="button" disabled={busy || !draft.entries.length} onClick={() => save(true)}>{L("发布规则", "Publish rules")}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>{L("取消", "Cancel")}</Button></div></form>}
    <div className="divide-y divide-line">{pools.map(p => <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><h2 className="font-semibold">{name(p.title)}</h2><p className="text-sm text-muted-foreground">{p.enabled ? L("已开放", "Enabled") : L("未开放", "Disabled")} · {p.points_cost} {L("积分／次", "points / draw")} · {p.entries.length} {L("种奖品", "prizes")} · {p.pity_after ? L(`${p.pity_after} 次内保底`, `Guaranteed within ${p.pity_after}`) : L("无保底", "No guarantee")}</p></div><Button size="sm" variant="ghost" disabled={busy} onClick={() => edit(p)}>{L("编辑", "Edit")}</Button></div>)}</div>
    {!pools.length && <p className="py-4 text-sm">{L("新增奖池后配置概率和次数，再开放给家长。", "Create a pool, configure probabilities and limits, then enable it for families.")}</p>}
  </DashboardPage>;
}
