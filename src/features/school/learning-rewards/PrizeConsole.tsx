"use client";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardCommandActions, DashboardCommandPanel, DashboardPage } from "../dashboard-page";
import { newId } from "@/lib/uuid";
import { fulfilReward, loadRewardPickups, loadRewardPrizes, saveRewardPrize } from "./actions";
import { rewardErrors, type RewardOrder, type RewardPage, type RewardPrize, type RewardPrizeInput } from "./contract";

const emptyPrize = (): RewardPrizeInput => ({ id: newId(), version: 0, title: { zh: "", en: "" }, description: { zh: "", en: "" },
  pickup_instructions: { zh: "向工作人员出示领取码", en: "Show your pickup code to staff" }, kind: "digital", image: "", points_cost: 10, stock: null, enabled: false, redeem_enabled: true });
export function PrizeConsole({ initial, initialPickups, locale }: { initial: RewardPrize[]; initialPickups: RewardPage<RewardOrder>; locale: "zh" | "en" }) {
  const L = (zh: string, en: string) => locale === "zh" ? zh : en;
  const [prizes, setPrizes] = useState(initial), [draft, setDraft] = useState<RewardPrizeInput | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [pickups, setPickups] = useState(initialPickups), [code, setCode] = useState(""), [activeCode, setActiveCode] = useState(""), [confirm, setConfirm] = useState<RewardOrder | null>(null);
  const failure = (value: string) => setMessage(rewardErrors[value]?.[locale] || L("操作未完成，请重试。", "Could not complete. Retry."));
  const title = (p: { zh: string; en: string }) => p[locale] || p.zh;
  async function reload() {
    setBusy(true);
    try { const r = await loadRewardPrizes(); if (r.ok) setPrizes(r.data); else failure(r.code); }
    catch { failure("UNKNOWN"); } finally { setBusy(false); }
  }
  async function save() {
    if (!draft) return;
    setBusy(true); setMessage("");
    try { const r = await saveRewardPrize(draft); if (r.ok) { setPrizes(old => [r.data, ...old.filter(p => p.id !== r.data.id)]); setDraft(null); setMessage(L("奖品已保存。", "Prize saved.")); } else failure(r.code); }
    catch { failure("UNKNOWN"); } finally { setBusy(false); }
  }
  async function readPickups(more = false) {
    setBusy(true); setConfirm(null);
    try { const query = more ? activeCode : code; const r = await loadRewardPickups(query, more ? pickups.next || undefined : undefined);
      if (r.ok) { setActiveCode(query); setPickups(old => more ? { ...r.data, items: [...old.items, ...r.data.items] } : r.data); } else failure(r.code); }
    catch { failure("UNKNOWN"); } finally { setBusy(false); }
  }
  async function fulfil() {
    if (!confirm?.pickup_code) return;
    setBusy(true);
    try { const r = await fulfilReward(confirm.id, confirm.pickup_code); if (r.ok) {
      setPickups(old => ({ ...old, items: old.items.map(o => o.id === r.data.id ? { ...o, ...r.data } : o) })); setConfirm(null); setMessage(L("已登记领取。", "Pickup recorded."));
    } else failure(r.code); } catch { failure("UNKNOWN"); } finally { setBusy(false); }
  }
  return <DashboardPage title={L("兑换与领取", "Prizes and pickups")} backHref="/dashboard/learning-rewards" backLabel={L("学习积分", "Learning rewards")}
    commandPanel={<DashboardCommandPanel><DashboardCommandActions><Button disabled={busy} onClick={() => setDraft(emptyPrize())}>{L("新增奖品", "New prize")}</Button>
      <Button variant="ghost" disabled={busy} onClick={reload}>{L("刷新库存", "Refresh stock")}</Button><Link className={buttonVariants({ variant: "ghost" })} href="/dashboard/learning-rewards/draws">{L("抽取与保底", "Draws and guarantees")}</Link><Link className={buttonVariants({ variant: "ghost" })} href="/dashboard/miniapp-runtime">{L("小程序页面", "Mini Program pages")}</Link>
    </DashboardCommandActions></DashboardCommandPanel>}>
    {message && <p role="status" className="py-2 text-sm">{message}</p>}
    {draft && <form onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-4 border-b border-line pb-5"><fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">{L("奖品名称（中文）", "Prize name (Chinese)")}<Input value={draft.title.zh} required maxLength={80} onChange={e => setDraft({ ...draft, title: { ...draft.title, zh: e.target.value } })} /></label>
      <label className="space-y-1 text-sm">{L("奖品名称（英文，可选）", "Prize name (English, optional)")}<Input value={draft.title.en} maxLength={80} onChange={e => setDraft({ ...draft, title: { ...draft.title, en: e.target.value } })} /></label>
      <label className="space-y-1 text-sm">{L("奖品类型", "Prize type")}<select className="h-10 w-full rounded-md border border-line bg-paper px-2" disabled={draft.version > 0} value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as "digital" | "physical", stock: e.target.value === "physical" ? draft.stock ?? 0 : draft.stock })}>
        <option value="digital">{L("数字收藏", "Digital collectible")}</option><option value="physical">{L("实物奖品", "Physical prize")}</option></select></label>
      <label className="space-y-1 text-sm">{L("兑换所需积分", "Points to redeem")}<Input type="number" min={1} max={1000000} required value={draft.points_cost} onChange={e => setDraft({ ...draft, points_cost: Number(e.target.value) })} /></label>
      <label className="space-y-1 text-sm">{draft.kind === "digital" ? L("剩余数量（留空为不限）", "Remaining stock (blank for unlimited)") : L("剩余数量", "Remaining stock")}<Input type="number" min={0} max={1000000} required={draft.kind === "physical"} value={draft.stock ?? ""} onChange={e => setDraft({ ...draft, stock: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      <label className="space-y-1 text-sm">{L("图片地址（可选）", "Image URL (optional)")}<Input value={draft.image} maxLength={500} placeholder="https://…" onChange={e => setDraft({ ...draft, image: e.target.value })} /></label>
      <label className="space-y-1 text-sm">{L("说明（中文）", "Description (Chinese)")}<Textarea rows={2} maxLength={1000} value={draft.description.zh} onChange={e => setDraft({ ...draft, description: { ...draft.description, zh: e.target.value } })} /></label>
      <label className="space-y-1 text-sm">{L("说明（英文，可选）", "Description (English, optional)")}<Textarea rows={2} maxLength={1000} value={draft.description.en} onChange={e => setDraft({ ...draft, description: { ...draft.description, en: e.target.value } })} /></label>
      {draft.kind === "physical" && <><label className="space-y-1 text-sm">{L("领取说明（中文）", "Pickup instructions (Chinese)")}<Textarea rows={2} maxLength={500} value={draft.pickup_instructions.zh} onChange={e => setDraft({ ...draft, pickup_instructions: { ...draft.pickup_instructions, zh: e.target.value } })} /></label>
        <label className="space-y-1 text-sm">{L("领取说明（英文，可选）", "Pickup instructions (English, optional)")}<Textarea rows={2} maxLength={500} value={draft.pickup_instructions.en} onChange={e => setDraft({ ...draft, pickup_instructions: { ...draft.pickup_instructions, en: e.target.value } })} /></label></>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />{L("启用奖品", "Enable prize")}</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.redeem_enabled} onChange={e => setDraft({ ...draft, redeem_enabled: e.target.checked })} />{L("开放积分兑换", "Allow points redemption")}</label>
    </fieldset><div className="flex gap-2"><Button disabled={busy}>{L("保存奖品", "Save prize")}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>{L("取消", "Cancel")}</Button></div></form>}
    <Table><TableHeader><TableRow><TableHead>{L("奖品", "Prize")}</TableHead><TableHead>{L("类型", "Type")}</TableHead><TableHead>{L("积分", "Points")}</TableHead><TableHead>{L("剩余", "Remaining")}</TableHead><TableHead>{L("状态", "Status")}</TableHead><TableHead>{L("操作", "Action")}</TableHead></TableRow></TableHeader><TableBody>
      {prizes.map(p => <TableRow key={p.id}><TableCell>{title(p.title)}</TableCell><TableCell>{p.kind === "digital" ? L("数字收藏", "Digital") : L("实物", "Physical")}</TableCell><TableCell>{p.points_cost}</TableCell><TableCell>{p.stock ?? L("不限", "Unlimited")}</TableCell><TableCell>{!p.enabled ? L("未启用", "Disabled") : p.redeem_enabled ? L("可兑换", "Redeemable") : L("仅用于抽取", "Draw only")}</TableCell><TableCell><Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(p)}>{L("编辑", "Edit")}</Button></TableCell></TableRow>)}
      {!prizes.length && <TableRow><TableCell colSpan={6}>{L("先新增奖品，启用后会出现在小程序兑换页。", "Add and enable a prize to show it in the Mini Program.")}</TableCell></TableRow>}
    </TableBody></Table>
    <section className="space-y-3 border-t border-line pt-5"><h2 className="text-base font-semibold">{L("实物领取", "Physical pickups")}</h2>
      <form className="flex max-w-xl gap-2" onSubmit={e => { e.preventDefault(); void readPickups(); }}><Input aria-label={L("领取码", "Pickup code")} placeholder={L("输入领取码，留空查看待领取", "Pickup code; leave blank for pending pickups")} value={code} maxLength={64} onChange={e => setCode(e.target.value)} /><Button disabled={busy}>{L("查找", "Find")}</Button></form>
      {confirm && <div className="flex flex-wrap items-center gap-3 bg-moon/30 p-3"><span>{L(`确认已将「${title(confirm.snapshot.title)}」交给 ${confirm.student_name}？`, `Confirm “${title(confirm.snapshot.title)}” was handed to ${confirm.student_name}?`)}</span><Button disabled={busy} onClick={fulfil}>{L("已交付，确认领取", "Handed over — confirm pickup")}</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>{L("取消", "Cancel")}</Button></div>}
      <Table><TableHeader><TableRow><TableHead>{L("学生", "Student")}</TableHead><TableHead>{L("奖品", "Prize")}</TableHead><TableHead>{L("领取码", "Pickup code")}</TableHead><TableHead>{L("获得时间", "Awarded")}</TableHead><TableHead>{L("领取", "Pickup")}</TableHead></TableRow></TableHeader><TableBody>
        {pickups.items.map(o => <TableRow key={o.id}><TableCell>{o.student_name}</TableCell><TableCell>{title(o.snapshot.title)}</TableCell><TableCell>{o.pickup_code}</TableCell><TableCell>{new Date(o.created_at).toLocaleDateString(locale, { timeZone: "Asia/Shanghai" })}</TableCell><TableCell>{o.status === "received" ? L("已领取", "Received") : <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirm(o)}>{L("核销领取", "Record pickup")}</Button>}</TableCell></TableRow>)}
        {!pickups.items.length && <TableRow><TableCell colSpan={5}>{L("暂无符合条件的领取记录", "No matching pickups")}</TableCell></TableRow>}
      </TableBody></Table>{pickups.next && <Button variant="secondary" disabled={busy} onClick={() => readPickups(true)}>{L("更早记录", "Earlier records")}</Button>}
    </section>
  </DashboardPage>;
}
