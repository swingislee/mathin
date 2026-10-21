"use client";
import { useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardPage, DashboardCommandActions, DashboardCommandPanel } from "../dashboard-page";
import { newId } from "@/lib/uuid";
import { grantRewardPoints, loadRewardAccount, loadRewardRules, reverseRewardPoints, saveRewardRules, searchRewardStudents } from "./actions";
import { learningStatuses, learningStatusNames, rewardErrors, type RewardAccount, type RewardRules, type RewardStudent } from "./contract";

export function RewardsConsole({ initial, locale }: { initial: RewardRules; locale: "zh" | "en" }) {
  const L = (zh: string, en: string) => locale === "zh" ? zh : en;
  const [rules, setRules] = useState(initial), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [query, setQuery] = useState(""), [students, setStudents] = useState<RewardStudent[]>([]), [selected, setSelected] = useState<RewardStudent | null>(null);
  const [account, setAccount] = useState<RewardAccount | null>(null), [loadingAccount, setLoadingAccount] = useState(false), [searched, setSearched] = useState(false);
  const [amount, setAmount] = useState("10"), [reason, setReason] = useState(""), [reversing, setReversing] = useState(""), [reverseReason, setReverseReason] = useState("");
  const request = useRef<{ id: string; signature: string } | null>(null), generation = useRef(0);
  const error = (code: string) => setMessage(rewardErrors[code]?.[locale] || L("操作未完成，请重试。", "Could not complete. Retry."));
  async function saveRules() {
    setBusy(true); setMessage("");
    try { const result = await saveRewardRules(rules); if (result.ok) { setRules(result.data); setMessage(L("奖励规则已保存，从后续奖励生效。", "Saved. Applies to future rewards.")); } else error(result.code); }
    finally { setBusy(false); }
  }
  async function reloadRules() { const result = await loadRewardRules(); if (result.ok) setRules(result.data); else error(result.code); }
  async function search() {
    setBusy(true);
    try { const result = await searchRewardStudents(query); if (result.ok) { setStudents(result.data); setSearched(true); } else error(result.code); }
    finally { setBusy(false); }
  }
  async function read(student: RewardStudent, more = false) {
    const current = ++generation.current;
    setSelected(student); setLoadingAccount(true); setMessage("");
    if (!more) { setAccount(null); setReversing(""); setReverseReason(""); }
    try {
      const result = await loadRewardAccount(student.id, more ? account?.next || undefined : undefined);
      if (current !== generation.current) return;
      if (result.ok) setAccount(old => more && old ? { ...result.data, entries: [...old.entries, ...result.data.entries] } : result.data); else error(result.code);
    } finally { if (current === generation.current) setLoadingAccount(false); }
  }
  async function grant() {
    if (!selected) return;
    const signature = JSON.stringify([selected.id, Number(amount), reason.trim()]);
    if (request.current?.signature !== signature) request.current = { id: newId(), signature };
    setBusy(true); setMessage("");
    try {
      const result = await grantRewardPoints(request.current.id, selected.id, Number(amount), reason);
      if (result.ok) { request.current = null; setReason(""); await read(selected); setMessage(L("积分已发放。", "Points granted.")); } else error(result.code);
    } finally { setBusy(false); }
  }
  async function reverse() {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await reverseRewardPoints(reversing, reverseReason);
      if (result.ok) { await read(selected); setMessage(L("已按原金额冲回，历史流水保留。", "Reversed the original amount. History is preserved.")); } else error(result.code);
    } finally { setBusy(false); }
  }
  return <DashboardPage title={L("学习积分", "Learning rewards")} backHref="/dashboard/miniapp-runtime" backLabel={L("小程序画布", "Mini Program canvas")}
    commandPanel={<DashboardCommandPanel><DashboardCommandActions><Link className={buttonVariants({ variant: "secondary" })} href="/dashboard/learning-rewards/prizes">{L("兑换与领取", "Prizes and pickups")}</Link><Link className={buttonVariants({ variant: "ghost" })} href="/dashboard/learning-rewards/draws">{L("抽取与保底", "Draws and guarantees")}</Link><Link className={buttonVariants({ variant: "ghost" })} href="/dashboard/learning-mistakes">{L("错题收录", "Mistake book")}</Link><Link className={buttonVariants({ variant: "ghost" })} href="/dashboard/miniapp-runtime">{L("小程序页面", "Mini Program pages")}</Link></DashboardCommandActions></DashboardCommandPanel>}>
    {message && <p role="status" className="py-2 text-sm">{message}</p>}
    <section className="space-y-4 border-b border-line pb-5">
      <h2 className="text-base font-semibold">{L("奖励规则", "Reward rules")}</h2>
      <p className="text-sm text-muted">{L("规则只影响后续奖励。已有星星不自动折算；星星撤销按原奖励金额冲回。", "Rules apply to future rewards. Existing stars are not converted. Revocations reverse the original reward.")}</p>
      <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2"><input type="checkbox" checked={rules.stars_enabled} disabled={busy} onChange={e => setRules({ ...rules, stars_enabled: e.target.checked })} />{L("课堂星星换积分", "Convert classroom stars")}</label>
        <label className="flex items-center gap-2">{L("每颗星", "Per star")}<Input type="number" min={0} max={10000} className="w-24" value={rules.points_per_star} disabled={busy} onChange={e => setRules({ ...rules, points_per_star: Number(e.target.value) })} />{L("积分", "points")}</label></div>
      <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2"><input type="checkbox" checked={rules.homework_enabled} disabled={busy} onChange={e => setRules({ ...rules, homework_enabled: e.target.checked })} />{L("作业奖励", "Homework reward")}</label>
        <label className="flex items-center gap-2">{L("每份作业", "Per assignment")}<Input type="number" min={0} max={10000} className="w-24" value={rules.homework_points} disabled={busy} onChange={e => setRules({ ...rules, homework_points: Number(e.target.value) })} />{L("积分", "points")}</label></div>
      <fieldset className="space-y-2" disabled={busy}><legend className="text-sm text-muted">{L("老师登记的全部题目达到以下任一档位时，奖励一次", "Reward once when all teacher-marked questions reach any selected level")}</legend>
        <div className="flex flex-wrap gap-4">{learningStatuses.filter(s => s !== "unchecked").map(s => <label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rules.homework_statuses.includes(s)} onChange={e => setRules({ ...rules, homework_statuses: e.target.checked ? [...rules.homework_statuses, s] : rules.homework_statuses.filter(v => v !== s) })} />{learningStatusNames[s][locale]}</label>)}</div>
      </fieldset>
      <div className="flex gap-2"><Button disabled={busy || !rules.homework_statuses.length} onClick={saveRules}>{L("保存规则", "Save rules")}</Button><Button variant="ghost" disabled={busy} onClick={reloadRules}>{L("重新读取", "Reload")}</Button></div>
    </section>
    <section className="space-y-4 py-5"><h2 className="text-base font-semibold">{L("学生积分账本", "Student ledger")}</h2>
      <form className="flex max-w-lg gap-2" onSubmit={e => { e.preventDefault(); void search(); }}><Input aria-label={L("学生姓名", "Student name")} placeholder={L("输入学生姓名", "Student name")} value={query} onChange={e => setQuery(e.target.value)} /><Button disabled={busy || !query.trim()}>{L("查找", "Search")}</Button></form>
      <div className="flex flex-wrap gap-2">{students.map(s => <Button key={s.id} variant={selected?.id === s.id ? "secondary" : "ghost"} disabled={busy} onClick={() => { setReason(""); request.current = null; void read(s); }}>{s.name}{s.purpose === "test" ? L("（开发）", " (dev)") : ""}</Button>)}</div>
      {searched && !students.length && <p className="text-sm text-muted">{L("未找到学生", "No students found")}</p>}
      {loadingAccount && <p role="status">{L("读取积分…", "Loading points…")}</p>}
      {selected && account && <>
        <div className="flex flex-wrap items-baseline gap-4"><h3 className="font-semibold">{selected.name}</h3><span>{L("可用积分", "Available")}: <strong className="text-xl">{account.available}</strong></span>{account.balance < 0 && <span className="text-rose">{L("待抵扣", "To offset")}: {-account.balance}</span>}</div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void grant(); }}>
          <label className="space-y-1 text-sm">{L("独立奖励积分", "Grant points")}<Input className="w-28" type="number" min={1} max={1000000} required value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} /></label>
          <label className="min-w-48 flex-1 space-y-1 text-sm">{L("奖励原因", "Reason")}<Input maxLength={500} required value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label><Button disabled={busy || loadingAccount || !reason.trim()}>{L("发放积分", "Grant points")}</Button>
        </form>
        <Table><TableHeader><TableRow><TableHead>{L("时间", "Date")}</TableHead><TableHead>{L("原因", "Reason")}</TableHead><TableHead>{L("变动", "Change")}</TableHead><TableHead>{L("变动后余额", "Balance after")}</TableHead><TableHead>{L("操作", "Action")}</TableHead></TableRow></TableHeader><TableBody>
          {account.entries.map(e => <TableRow key={e.id}><TableCell>{new Date(e.created_at).toLocaleString(locale, { timeZone: "Asia/Shanghai" })}</TableCell><TableCell>{e.note}</TableCell><TableCell>{e.amount > 0 ? "+" : ""}{e.amount}</TableCell><TableCell>{e.balance_after}</TableCell><TableCell>{e.source === "manual" && !account.entries.some(x => x.snapshot.originalId === e.id) && <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setReversing(e.id); setReverseReason(""); }}>{L("冲回", "Reverse")}</Button>}</TableCell></TableRow>)}
          {!account.entries.length && <TableRow><TableCell colSpan={5}>{L("暂无积分流水", "No points yet")}</TableCell></TableRow>}
        </TableBody></Table>
        {reversing && <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void reverse(); }}><Input aria-label={L("冲回原因", "Reversal reason")} placeholder={L("填写冲回原因", "Reason for reversal")} required maxLength={500} value={reverseReason} onChange={e => setReverseReason(e.target.value)} /><Button disabled={busy || !reverseReason.trim()}>{L("确认冲回原金额", "Reverse original amount")}</Button><Button type="button" variant="ghost" onClick={() => setReversing("")}>{L("取消", "Cancel")}</Button></form>}
        {account.next && <Button variant="secondary" disabled={loadingAccount || busy} onClick={() => read(selected, true)}>{L("更早流水", "Earlier entries")}</Button>}
      </>}
    </section>
  </DashboardPage>;
}
