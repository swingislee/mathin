"use client";

import { useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { newId } from "@/lib/uuid";
import { DashboardCommandActions, DashboardCommandPanel, DashboardTableShell } from "./dashboard-page";
import { readHomeworkDocument, saveHomeworkDocument } from "./homework-document-actions";
import { bindHomeworkQuestion, createHomeworkQuestions, homeworkContentFor, type HomeworkDocument, type HomeworkScope, type HomeworkWorkspace } from "./homework-document-contract";

export function HomeworkDocumentEditor({ scope, targetId, onSaved }: { scope: HomeworkScope; targetId: string; onSaved?: (data: HomeworkWorkspace) => void }) {
  const en = useLocale() === "en";
  const t = (zh: string, english: string) => en ? english : zh;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<HomeworkWorkspace | null>(null);
  const [draft, setDraft] = useState<HomeworkDocument | null>(null);
  const [studentId, setStudentId] = useState("all");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [message, setMessage] = useState("");
  const dirty = Boolean(state && draft && JSON.stringify(state.document) !== JSON.stringify(draft));
  const title = scope === "classroom" ? t("班级作业题号模板", "Class homework structure") : scope === "lecture" ? t("本讲作业与标准教案", "Lesson homework and teaching plan") : t("编辑作业与课后主题", "Edit homework and topic");
  const writable = Boolean(state?.canWrite && !pending);
  const dueDate = draft?.dueAt ? new Date(draft.dueAt) : null;
  const dueValue = dueDate ? new Date(dueDate.getTime() - dueDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  async function load() {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage(""); setStudentId("all");
    try {
      const result = await readHomeworkDocument(scope, targetId);
      if (!result.ok) { setMessage(t("读取失败，请重试。", "Could not load. Please retry.")); return; }
      setState(result.data); setDraft(result.data.document);
    } catch { setMessage(t("读取失败，请重试。", "Could not load. Please retry.")); }
    finally { busy.current = false; setPending(false); }
  }
  async function save() {
    if (!state || !draft || busy.current) return;
    busy.current = true; setPending(true); setMessage("");
    try {
      const result = await saveHomeworkDocument({ scope, targetId, revision: state.revision, document: draft });
      if (!result.ok) {
        setMessage(result.code === "CONFLICT" ? t("内容已被其他人更新。本次草稿已保留，请核对后关闭并重新读取。", "This document changed elsewhere. Your draft is retained; review it, close and reopen to reload.")
          : result.code === "VALIDATION" ? t("请检查题号、同组重复题号和文本长度。", "Check question labels, duplicate labels within a group and text lengths.") : t("保存失败，填写内容已保留。", "Could not save. Your changes are retained.")); return;
      }
      setState(result.data); setDraft(result.data.document); setMessage(t("已保存。", "Saved.")); onSaved?.(result.data); router.refresh();
    } catch { setMessage(t("保存失败，填写内容已保留。", "Could not save. Your changes are retained.")); }
    finally { busy.current = false; setPending(false); }
  }
  function changeQuestion(id: string, patch: Partial<HomeworkDocument["questions"][number]>) {
    if (draft) setDraft({ ...draft, questions: draft.questions.map(row => row.id === id ? { ...row, ...patch } : row) });
  }
  return <>
    <Button size="sm" variant="secondary" onClick={() => { setOpen(true); void load(); }}>{title}</Button>
    <Dialog open={open} onOpenChange={value => { if (!pending && !dirty) setOpen(value); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted">{scope === "classroom" ? t("设置本班常用的题号和分组名称。发布新课次作业时套用；已发布作业保留原有内容。", "Set the class question labels and group names. New homework copies this structure; published homework keeps its own content.")
          : scope === "lecture" ? t("教研在本讲维护题目、参考答案和标准教案，老师布置作业时可绑定并调整。", "Maintain this lesson's question bank, reference answers and teaching plan. Teachers can copy and adapt them for their classes.")
            : t("修改本次作业主题与题目；选择学生后可单独调整题目内容。", "Edit this assignment's topic and questions. Select a student to customize their question content.")}</p>
        <DashboardCommandPanel><DashboardCommandActions>
          {state?.canWrite && <Button size="sm" disabled={pending || !dirty} onClick={() => void save()}>{t("保存", "Save")}</Button>}
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setDraft(state?.document ?? null); setOpen(false); }}>{dirty ? t("放弃修改并关闭", "Discard changes and close") : t("关闭", "Close")}</Button>
        </DashboardCommandActions></DashboardCommandPanel>
        {message && <p role="status" className="text-xs">{message}</p>}
        {!draft && !pending && <Button onClick={() => void load()}>{t("重试", "Retry")}</Button>}
        {draft && <Tabs defaultValue="homework">
          {scope === "lecture" && <TabsList><TabsTrigger value="homework">{t("课后作业题库", "Homework questions")}</TabsTrigger><TabsTrigger value="plan">{t("标准教案", "Teaching plan")}</TabsTrigger></TabsList>}
          <TabsContent value="homework" className="space-y-4">
            {scope !== "classroom" && <div className="grid gap-3 sm:grid-cols-2">
              <Label className="grid gap-1 text-xs">{t("课后主题", "Homework topic")}<Input value={draft.topic} maxLength={100} disabled={!writable} onChange={event => setDraft({ ...draft, topic: event.target.value })} /></Label>
              {scope === "assignment" && <Label className="grid gap-1 text-xs">{t("截止时间", "Due date")}<DateTimePicker mode="datetime" value={dueValue} onValueChange={value => { if (writable) setDraft({ ...draft, dueAt: value ? new Date(value).toISOString() : null }); }} disabled={!writable} /></Label>}
              <Label className="grid gap-1 text-xs sm:col-span-2">{t("作业说明", "Instructions")}<Textarea value={draft.instructions} maxLength={20000} disabled={!writable} onChange={event => setDraft({ ...draft, instructions: event.target.value })} /></Label>
            </div>}
            <DashboardCommandPanel><DashboardCommandActions>
              {writable && studentId === "all" && <>
                {draft.questions.length === 0 && [6, 8].map(count => <Button key={count} size="sm" variant="secondary" onClick={() => setDraft({ ...draft, questions: createHomeworkQuestions(count) })}>{t(`${count} 题模板`, `${count} questions`)}</Button>)}
                <Button size="sm" variant="secondary" disabled={draft.questions.length >= 60} onClick={() => setDraft({ ...draft, questions: [...draft.questions, { ...createHomeworkQuestions(1)[0], label: String(draft.questions.length + 1) }] })}>{t("增加题号", "Add question")}</Button>
                {scope === "assignment" && state?.classTemplate && <Button size="sm" variant="secondary" onClick={() => {
                  const missing = state.classTemplate!.questions.filter(row => !draft.questions.some(current => current.group === row.group && current.label === row.label));
                  setDraft({ ...draft, questions: [...draft.questions, ...missing.map(row => ({ ...row, id: newId(), content: "", answer: "", sourceQuestionId: null }))].slice(0, 60) });
                }}>{t("补入班级模板题号", "Add class template labels")}</Button>}
                {scope === "assignment" && state?.lectureTemplate && <Button size="sm" variant="secondary" onClick={() => setDraft({ ...draft,
                  topic: state.lectureTemplate!.topic || draft.topic,
                  questions: draft.questions.map(row => { const source = state.lectureTemplate!.questions.find(q => q.group === row.group && q.label === row.label); return source && !row.content ? bindHomeworkQuestion(row, source) : row; }),
                })}>{t("采用本讲主题并补齐空题", "Use lesson topic and fill empty questions")}</Button>}
              </>}
              {scope === "assignment" && <Select value={studentId} onValueChange={setStudentId} disabled={pending}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="all">{t("全班共同题目", "Common questions")}</SelectItem>{state?.students.map(student => <SelectItem key={student.id} value={student.id}>{student.name}</SelectItem>)}
              </SelectContent></Select>}
            </DashboardCommandActions></DashboardCommandPanel>
            <DashboardTableShell><Table containerClassName="max-h-[48vh] overflow-auto" className="text-xs">
              <TableHeader><TableRow><TableHead className="w-32">{t("分组名称", "Group")}</TableHead><TableHead className="w-28">{t("题号", "Label")}</TableHead>{scope !== "classroom" && <TableHead>{t("具体题目", "Question")}</TableHead>}<TableHead className="w-24" /></TableRow></TableHeader>
              <TableBody>{draft.questions.map(question => <TableRow key={question.id}>
                <TableCell><Input aria-label={t("分组名称", "Group")} value={question.group} maxLength={60} disabled={!writable || studentId !== "all"} onChange={event => changeQuestion(question.id, { group: event.target.value })} /></TableCell>
                <TableCell><Input aria-label={t("题号", "Label")} value={question.label} maxLength={100} disabled={!writable || studentId !== "all"} onChange={event => changeQuestion(question.id, { label: event.target.value })} /></TableCell>
                {scope !== "classroom" && <TableCell className="min-w-72 space-y-2">
                  {scope === "assignment" && studentId === "all" && state?.lectureTemplate?.questions.length ? <Select disabled={!writable} value={question.sourceQuestionId ?? "custom"} onValueChange={id => {
                    const source = state.lectureTemplate!.questions.find(row => row.id === id); changeQuestion(question.id, source ? bindHomeworkQuestion(question, source) : { sourceQuestionId: null });
                  }}><SelectTrigger><SelectValue placeholder={t("选择本讲题目", "Select lesson question")} /></SelectTrigger><SelectContent><SelectItem value="custom">{t("自定义题目", "Custom question")}</SelectItem>
                    {state.lectureTemplate.questions.map(source => <SelectItem key={source.id} value={source.id}>{source.group} {source.label} · {source.content.slice(0, 40)}</SelectItem>)}
                  </SelectContent></Select> : null}
                  <Textarea aria-label={t("具体题目", "Question")} value={homeworkContentFor(draft, question.id, studentId === "all" ? undefined : studentId)} rows={2} maxLength={10000} disabled={!writable} onChange={event => {
                    if (studentId === "all") changeQuestion(question.id, { content: event.target.value });
                    else setDraft({ ...draft, overrides: [...draft.overrides.filter(row => row.studentId !== studentId || row.questionId !== question.id), { studentId, questionId: question.id, content: event.target.value }] });
                  }} />
                  {studentId === "all" ? <Label className="grid gap-1 text-xs text-muted">{t("参考答案／解析", "Reference answer")}<Textarea value={question.answer} rows={2} maxLength={10000} disabled={!writable} onChange={event => changeQuestion(question.id, { answer: event.target.value })} /></Label>
                    : draft.overrides.some(row => row.studentId === studentId && row.questionId === question.id) && <Button size="sm" variant="ghost" disabled={!writable} onClick={() => setDraft({ ...draft, overrides: draft.overrides.filter(row => row.studentId !== studentId || row.questionId !== question.id) })}>{t("恢复共同题目", "Use common question")}</Button>}
                </TableCell>}
                <TableCell>{scope !== "assignment" && <Button size="sm" variant="ghost" disabled={!writable} onClick={() => setDraft({ ...draft, questions: draft.questions.filter(row => row.id !== question.id) })}>{t("移除", "Remove")}</Button>}</TableCell>
              </TableRow>)}</TableBody>
            </Table></DashboardTableShell>
          </TabsContent>
          {scope === "lecture" && <TabsContent value="plan"><Label className="grid gap-2 text-sm">{t("标准教案", "Teaching plan")}<Textarea rows={16} value={draft.lessonPlan} maxLength={50000} disabled={!writable} onChange={event => setDraft({ ...draft, lessonPlan: event.target.value })} /></Label></TabsContent>}
        </Tabs>}
      </DialogContent>
    </Dialog>
  </>;
}
