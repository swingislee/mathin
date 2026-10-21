"use client";
import { useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DashboardCommandActions, DashboardCommandPanel, DashboardPage } from "../dashboard-page";
import { searchRewardStudents } from "../learning-rewards/actions";
import type { RewardStudent } from "../learning-rewards/contract";
import { loadMistakes } from "./actions";
import { loadLearningPolicy, saveLearningPolicyDraft, publishLearningPolicy } from "../learning-rewards/policy-actions";
import type { LearningPolicy } from "../learning-rewards/policy";
import { learningStatuses, learningStatusNames, mistakeErrors, type MistakePage, type MistakeRecord, type MistakeRules } from "./contract";

export function MistakeConsole({ initial, initialPolicy, locale }: { initial: MistakeRules; initialPolicy: LearningPolicy<MistakeRules>; locale: "zh" | "en" }) {
  const L = (zh: string, en: string) => locale === "zh" ? zh : en;
  const [rules, setRules] = useState(initial), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [query, setQuery] = useState(""), [students, setStudents] = useState<RewardStudent[]>([]), [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<RewardStudent | null>(null), [page, setPage] = useState<MistakePage | null>(null), [detail, setDetail] = useState<MistakeRecord | null>(null);
  const [policy, setPolicy] = useState(initialPolicy);
  const generation = useRef(0), [loading, setLoading] = useState(false);
  const fail = (code: string) => setMessage(mistakeErrors[code]?.[locale] || L("操作未完成，请重试。", "Could not complete. Retry."));
  async function read(student: RewardStudent, more = false, key?: string) {
    const token = ++generation.current; setSelected(student); setLoading(true); setMessage("");
    if (!more && !key) { setPage(null); setDetail(null); }
    try { const result = await loadMistakes(student.id, more ? page?.next || undefined : undefined, key);
      if (token !== generation.current) return;
      if (!result.ok) { fail(result.code); return; }
      if (key) setDetail(result.data.items[0]); else setPage(old => more && old ? { ...result.data, items: [...old.items, ...result.data.items] } : result.data);
    } catch { if (token === generation.current) fail("UNKNOWN"); } finally { if (token === generation.current) setLoading(false); }
  }
  async function save(publish = false) {
    setBusy(true); setMessage(""); try { const saved = await saveLearningPolicyDraft("mistakes", policy.draftVersion, policy.baseVersion, rules);
      if (!saved.ok) { fail(saved.code); return; }
      setPolicy(saved.data as LearningPolicy<MistakeRules>);
      if (!publish) { setMessage(L("草稿已保存；发布后才应用于家长端。", "Draft saved. Publish to apply it for families.")); return; }
      const result = await publishLearningPolicy("mistakes", saved.data.draftVersion);
      if (result.ok) { const next = result.data as LearningPolicy<MistakeRules>; setPolicy(next); setRules(next.published!); if (selected) await read(selected); setMessage(L("规则已发布，家长端会自动更新。", "Rules published. The family book updates automatically.")); } else fail(result.code);
    } catch { fail("UNKNOWN"); } finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true); try { const result = await loadLearningPolicy("mistakes"); if (result.ok) { const next = result.data as LearningPolicy<MistakeRules>; setPolicy(next); setRules(next.draft || next.published!); } else fail(result.code); } catch { fail("UNKNOWN"); } finally { setBusy(false); }
  }
  async function search() {
    setBusy(true); try { const result = await searchRewardStudents(query); if (result.ok) { setStudents(result.data); setSearched(true); } else fail(result.code); } catch { fail("UNKNOWN"); } finally { setBusy(false); }
  }
  return <DashboardPage title={L("错题与复习收录", "Mistakes and review")} backHref="/dashboard/learning-rewards" backLabel={L("学习服务", "Learning services")}
    commandPanel={<DashboardCommandPanel><DashboardCommandActions><Link className={buttonVariants({ variant: "ghost" })} href="/dashboard/miniapp-runtime">{L("小程序页面", "Mini Program pages")}</Link></DashboardCommandActions></DashboardCommandPanel>}>
    {message && <p role="status" className="py-2 text-sm">{message}</p>}
    <form className="space-y-4 border-b border-line pb-5" onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy} className="space-y-4">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rules.enabled} onChange={e => setRules({ ...rules, enabled: e.target.checked })} />{L("开放家长错题本", "Enable the family mistake book")}</label>
      <div className="flex flex-wrap gap-5"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rules.classroom_enabled} onChange={e => setRules({ ...rules, classroom_enabled: e.target.checked })} />{L("课堂习题（已结课）", "Classroom questions (completed sessions)")}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rules.homework_enabled} onChange={e => setRules({ ...rules, homework_enabled: e.target.checked })} />{L("课后作业习题", "Homework questions")}</label></div>
      <div className="space-y-2"><h2 className="font-semibold">{L("收录哪些学情", "Learning statuses to include")}</h2><div className="flex flex-wrap gap-4">{learningStatuses.map(status => <label key={status} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rules.statuses.includes(status)} onChange={e => setRules({ ...rules, statuses: e.target.checked ? [...rules.statuses, status] : rules.statuses.filter(s => s !== status), mastered_statuses: e.target.checked ? rules.mastered_statuses.filter(s => s !== status) : rules.mastered_statuses })} />{learningStatusNames[status][locale]}</label>)}</div></div>
      <div className="space-y-3 rounded-lg border border-line p-4"><label className="text-sm">{L("学情变化后的记录方式", "When learning status changes")}<select className="ml-3 rounded-md border border-line bg-paper p-2" value={rules.history_mode} onChange={e => setRules({ ...rules, history_mode: e.target.value as "current" | "retain" })}><option value="current">{L("按当前学情显示", "Follow current inclusion statuses")}</option><option value="retain">{L("保留收录历史", "Retain included history")}</option></select></label>
        {rules.history_mode === "retain" && <><p className="text-sm">{L("哪些学情自动标为已掌握", "Statuses that mean mastered")}</p><div className="flex flex-wrap gap-4">{learningStatuses.map(status => <label key={status} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={rules.statuses.includes(status)} checked={rules.mastered_statuses.includes(status)} onChange={e => setRules({ ...rules, mastered_statuses: e.target.checked ? [...rules.mastered_statuses, status] : rules.mastered_statuses.filter(s => s !== status) })} />{learningStatusNames[status][locale]}</label>)}</div><p className="text-sm text-muted-foreground">{L("发布时收录符合条件的现有记录，之后保留收录历史；最新学情达到以上状态即归为已掌握，后续状态变化会同步调整。", "Publication includes current matching records, then retains their history. Mastery follows the latest teacher record and changes with it.")}</p></>}
      </div>
      <p className="text-sm text-muted-foreground">{L("按老师当前的逐题登记收录；修改状态或规则后重新显示，不改动原始学情。未登记表示未知，不自动纳入。课堂“未检查”包含本功能启用后撤回的登记；作业使用已保存的“未检查”。", "Inclusion follows teachers’ current question records. Updating a mark or rule changes this list without changing the source. Unrecorded questions remain unknown. Classroom Unchecked includes marks explicitly reset after this feature was installed; homework uses saved Unchecked records.")}</p>
      <p className="text-sm text-muted-foreground">{L("仅展示已有题目标题、课次／作业来源、评语和作业说明；没有保存题干的记录提示查看原材料。", "Shows existing question titles, lesson or assignment context, teacher notes and homework instructions. Records without question content refer to the original materials.")}</p>
    </fieldset><div className="flex gap-2"><Button disabled={busy || !rules.statuses.length}>{L("保存草稿", "Save draft")}</Button><Button type="button" disabled={busy || !rules.statuses.length} onClick={() => save(true)}>{L("发布规则", "Publish rules")}</Button><Button type="button" variant="ghost" disabled={busy} onClick={reload}>{L("重新读取", "Reload")}</Button></div></form>
    <section className="space-y-3 pt-5"><h2 className="font-semibold">{L("按学生查看收录", "Review a student’s included questions")}</h2><p className="text-sm text-muted-foreground">{L("后台可在开放前查看收录结果。", "Staff can preview included records before enabling the family book.")}</p>
      <form className="flex max-w-xl gap-2" onSubmit={e => { e.preventDefault(); void search(); }}><Input aria-label={L("学生姓名", "Student name")} placeholder={L("输入学生姓名", "Student name")} required maxLength={60} value={query} onChange={e => setQuery(e.target.value)} /><Button disabled={busy}>{L("查找", "Find")}</Button></form>
      <div className="flex flex-wrap gap-2">{students.map(student => <Button key={student.id} size="sm" variant={selected?.id === student.id ? "secondary" : "ghost"} disabled={busy} onClick={() => read(student)}>{student.name}{student.purpose === "test" ? L("（测试）", " (test)") : ""}</Button>)}</div>
      {searched && !students.length && <p className="text-sm">{L("未找到学生", "No students found")}</p>}
      {loading && <p role="status" className="text-sm">{L("读取记录…", "Loading records…")}</p>}
      {selected && page && <><div className="flex items-center gap-3"><h3 className="font-semibold">{selected.name}</h3><Button size="sm" variant="ghost" disabled={loading} onClick={() => read(selected)}>{L("刷新学情", "Refresh learning records")}</Button></div>
        <div className="divide-y divide-line">{page.items.map(row => <button key={row.id} type="button" disabled={loading} onClick={() => read(selected, false, row.id)} className="flex w-full flex-wrap items-center justify-between gap-3 py-3 text-left"><div><p className="font-medium">{row.title}</p><p className="text-sm text-muted-foreground">{row.classroom_name} · {row.source_title} · {row.kind === "classroom" ? L("课堂", "Classroom") : L("作业", "Homework")}</p></div><span className="text-sm">{row.mastered ? L("已掌握 · ", "Mastered · ") : ""}{learningStatusNames[row.status][locale]}</span></button>)}</div>
        {!page.items.length && <p className="text-sm">{L("没有符合当前收录规则的已登记题目。", "No recorded questions match the current rules.")}</p>}
        {page.next && <Button variant="secondary" disabled={loading} onClick={() => read(selected, true)}>{L("更早记录", "Earlier records")}</Button>}
      </>}
      {detail && <div className="space-y-2 rounded-md border border-line p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">{detail.title}</h3><Button size="sm" variant="ghost" onClick={() => setDetail(null)}>{L("收起", "Close")}</Button></div><p className="text-sm">{learningStatusNames[detail.status][locale]} · {new Date(detail.marked_at).toLocaleString(locale, { timeZone: "Asia/Shanghai" })}</p>
        {!detail.included && <p className="text-sm">{L("学情已更新，此题已不在当前收录范围。", "The record has changed and is no longer included.")}</p>}
        <p className="text-sm">{detail.classroom_name} · {detail.source_title}</p>
        {detail.note && <p className="whitespace-pre-wrap text-sm">{L("老师评语：", "Teacher note: ")}{detail.note}</p>}
        {detail.instructions && <p className="whitespace-pre-wrap text-sm">{L("作业说明：", "Homework instructions: ")}{detail.instructions}</p>}
        <p className="text-sm text-muted-foreground">{L("此逐题登记未保存独立题干，请结合原课堂／作业材料复习。", "This question record has no separate question content. Review it with the original classroom or homework materials.")}</p>
      </div>}
    </section>
  </DashboardPage>;
}
