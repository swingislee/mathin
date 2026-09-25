"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { newId } from "@/lib/uuid";
import { QuestionGroupControls, ALL_QUESTION_GROUPS, UNGROUPED_QUESTIONS } from "@/features/interactive-questions/QuestionGroupControls";
import { questionCompositionText } from "@/features/interactive-questions/contract";
import { DashboardCommandActions, DashboardCommandPanel, DashboardTableShell } from "./dashboard-page";
import { readHomeworkDocument, saveHomeworkDocument } from "./homework-document-actions";
import { bindHomeworkQuestion, createHomeworkQuestions, homeworkCompositionFor, homeworkContentFor, homeworkGroups, type HomeworkDocument, type HomeworkScope, type HomeworkWorkspace } from "./homework-document-contract";

const HomeworkQuestionCanvas = dynamic(() => import("./HomeworkQuestionCanvas"), { ssr: false });
const groupKey = (name: string) => name ? `group:${name}` : UNGROUPED_QUESTIONS;

export function HomeworkDocumentEditor({ scope, targetId, onSaved }: { scope: HomeworkScope; targetId: string; onSaved?: (data: HomeworkWorkspace) => void }) {
  const en = useLocale() === "en";
  const t = (zh: string, english: string) => en ? english : zh;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<HomeworkWorkspace | null>(null);
  const [draft, setDraftState] = useState<HomeworkDocument | null>(null);
  function setDraft(value: HomeworkDocument | null | ((current: HomeworkDocument) => HomeworkDocument)) {
    setDraftState(current => typeof value === "function" ? current && value(current) : value);
  }
  const [studentId, setStudentId] = useState("all");
  const [selectedGroup, setSelectedGroup] = useState(ALL_QUESTION_GROUPS);
  const [canvas, setCanvas] = useState<{ questionId: string; field: "content" | "answer" } | null>(null);
  const [bindingUrls, setBindingUrls] = useState<Record<string, string>>({});
  const onAsset = useCallback((key: string, url: string) => setBindingUrls(current => ({ ...current, [key]: url })), []);
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [message, setMessage] = useState("");
  const dirty = Boolean(state && draft && JSON.stringify(state.document) !== JSON.stringify(draft));
  const title = scope === "classroom" ? t("班级作业题号模板", "Class homework structure") : scope === "lecture" ? t("本讲作业与标准教案", "Lesson homework and teaching plan") : t("编辑作业与课后主题", "Edit homework and topic");
  const writable = Boolean(state?.canWrite && !pending && !canvasBusy);
  const groups = draft ? homeworkGroups(draft) : [];
  const activeGroup = groups.find(name => groupKey(name) === selectedGroup) ?? "";
  const orderedGroups = [...groups, ""].filter(name => selectedGroup === ALL_QUESTION_GROUPS || groupKey(name) === selectedGroup);
  const questions = draft ? orderedGroups.flatMap(name => draft.questions.filter(q => q.group === name)) : [];
  const activeQuestion = draft?.questions.find(q => q.id === canvas?.questionId);
  const dueDate = draft?.dueAt ? new Date(draft.dueAt) : null;
  const dueValue = dueDate ? new Date(dueDate.getTime() - dueDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function load() {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage(""); setStudentId("all"); setCanvas(null); setSelectedGroup(ALL_QUESTION_GROUPS);
    try {
      const result = await readHomeworkDocument(scope, targetId);
      if (!result.ok) { setMessage(t("读取失败，请重试。", "Could not load. Please retry.")); return; }
      setState(result.data); setDraft(result.data.document); setBindingUrls(result.data.bindingUrls ?? {});
    } catch { setMessage(t("读取失败，请重试。", "Could not load. Please retry.")); }
    finally { busy.current = false; setPending(false); }
  }
  async function save() {
    if (!state || !draft || busy.current || canvasBusy) return;
    busy.current = true; setPending(true); setMessage("");
    try {
      const result = await saveHomeworkDocument({ scope, targetId, revision: state.revision, document: draft });
      if (!result.ok) {
        setMessage(result.code === "CONFLICT" ? t("内容已被其他人更新。本次草稿已保留，请核对后关闭并重新读取。", "This document changed elsewhere. Your draft is retained; review it, close and reopen to reload.")
          : result.code === "VALIDATION" ? t("请检查同组题号是否重复、题目内容和分组名称。", "Check duplicate question numbers, content and group names.") : t("保存失败，填写内容已保留。", "Could not save. Your changes are retained.")); return;
      }
      setState(result.data); setDraft(result.data.document); setBindingUrls(current => ({ ...current, ...result.data.bindingUrls }));
      setMessage(t("已保存。", "Saved.")); onSaved?.(result.data); router.refresh();
    } catch { setMessage(t("保存失败，填写内容已保留。", "Could not save. Your changes are retained.")); }
    finally { busy.current = false; setPending(false); }
  }
  function changeQuestion(id: string, patch: Partial<HomeworkDocument["questions"][number]>) {
    setDraft(current => ({ ...current, questions: current.questions.map(row => row.id === id ? { ...row, ...patch } : row) }));
  }
  function addQuestion(focus = false, group = activeGroup) {
    if (!draft || draft.questions.length >= 60) return;
    const labels = new Set(draft.questions.filter(q => q.group === group).map(q => q.label));
    let number = 1; while (labels.has(String(number))) number++;
    const question = { ...createHomeworkQuestions(1, group)[0], label: String(number) };
    setDraft({ ...draft, questions: [...draft.questions, question] });
    if (focus) requestAnimationFrame(() => document.getElementById(`homework-content-${question.id}`)?.focus());
  }
  function groupSelect(id: string) { setSelectedGroup(id); setCanvas(null); }
  function moveGroup(id: string, direction: -1 | 1) {
    const order = [...groups], index = order.findIndex(name => groupKey(name) === id), next = index + direction;
    if (index < 0 || next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]]; setDraft(current => ({ ...current, groups: order }));
  }
  const structureEditable = writable && studentId === "all";
  return <>
    <Button size="sm" variant="secondary" onClick={() => { setOpen(true); void load(); }}>{title}</Button>
    <Dialog open={open} onOpenChange={value => { if (!pending && !canvasBusy && !dirty) setOpen(value); }}>
      <DialogContent className="flex h-[94dvh] w-[96vw] max-w-none flex-col gap-3 overflow-hidden sm:max-w-none" data-homework-question-workspace>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>
          {scope === "classroom" ? t("按分组设置常用题号；新课次作业会复制这份结构。", "Organize question numbers into groups for new assignments.")
            : t("在表格中连续录入题干和答案；用交互题目编辑器插入文字、图片、公式、游戏、H5 和教具。", "Enter questions and answers in the table. Use the interactive question editor for text, images, formulas, games, H5 and teaching tools.")}
        </DialogDescription></DialogHeader>
        <DashboardCommandPanel><DashboardCommandActions>
          {state?.canWrite && <Button size="sm" disabled={pending || canvasBusy || !dirty} onClick={() => void save()}>{t("保存", "Save")}</Button>}
          <Button size="sm" variant="ghost" disabled={pending || canvasBusy} onClick={() => { setDraft(state?.document ?? null); setCanvas(null); setOpen(false); }}>{dirty ? t("放弃修改并关闭", "Discard changes and close") : t("关闭", "Close")}</Button>
          {dirty && <span className="text-xs text-muted">{t("有未保存修改", "Unsaved changes")}</span>}
        </DashboardCommandActions></DashboardCommandPanel>
        {message && <p role="status" className="text-xs">{message}</p>}
        {!draft && !pending && <Button onClick={() => void load()}>{t("重试", "Retry")}</Button>}
        {draft && canvas && activeQuestion ? <HomeworkQuestionCanvas key={`${canvas.questionId}:${canvas.field}:${studentId}`} scope={scope} targetId={targetId}
          questionId={activeQuestion.id} title={`${activeQuestion.group} ${activeQuestion.label}`} field={canvas.field}
          composition={canvas.field === "answer" ? activeQuestion.answerComposition ?? null : homeworkCompositionFor(draft, activeQuestion.id, studentId === "all" ? undefined : studentId)}
          text={canvas.field === "answer" ? activeQuestion.answer : homeworkContentFor(draft, activeQuestion.id, studentId === "all" ? undefined : studentId)}
          bindingUrls={bindingUrls} onAsset={onAsset} onPendingChange={setCanvasBusy} disabled={pending || canvasBusy} readOnly={!state?.canWrite}
          questions={questions.map(q => ({ id: q.id, title: `${q.group} ${q.label} · ${q.content.slice(0, 25)}` }))}
          onSelect={id => setCanvas({ ...canvas, questionId: id })} onBack={() => setCanvas(null)}
          onChange={composition => {
            if (!state?.canWrite) return;
            if (studentId !== "all") setDraft(current => ({ ...current, overrides: [...current.overrides.filter(row => row.studentId !== studentId || row.questionId !== activeQuestion.id), { studentId, questionId: activeQuestion.id, content: questionCompositionText(composition), composition }] }));
            else changeQuestion(activeQuestion.id, canvas.field === "answer" ? { answerComposition: composition, answer: questionCompositionText(composition) } : { composition, content: questionCompositionText(composition) });
          }} /> : draft && <Tabs defaultValue="homework" className="flex min-h-0 flex-1 flex-col">
          {scope === "lecture" && <TabsList><TabsTrigger value="homework">{t("课后作业题库", "Homework questions")}</TabsTrigger><TabsTrigger value="plan">{t("标准教案", "Teaching plan")}</TabsTrigger></TabsList>}
          <TabsContent value="homework" className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {scope !== "classroom" && <div className="grid gap-3 sm:grid-cols-3">
              <Label className="grid gap-1 text-xs">{t("课后主题", "Homework topic")}<Input value={draft.topic} maxLength={100} disabled={!writable} onChange={event => setDraft({ ...draft, topic: event.target.value })} /></Label>
              <Label className="grid gap-1 text-xs">{t("作业说明", "Instructions")}<Textarea rows={1} value={draft.instructions} maxLength={20000} disabled={!writable} onChange={event => setDraft({ ...draft, instructions: event.target.value })} /></Label>
              {scope === "assignment" && <Label className="grid gap-1 text-xs">{t("截止时间", "Due date")}<DateTimePicker mode="datetime" value={dueValue} onValueChange={value => { if (writable) setDraft({ ...draft, dueAt: value ? new Date(value).toISOString() : null }); }} disabled={!writable} /></Label>}
            </div>}
            <DashboardCommandPanel><DashboardCommandActions>
              <QuestionGroupControls groups={groups.map(name => ({ id: groupKey(name), name, count: draft.questions.filter(q => q.group === name).length }))} selected={selectedGroup} onSelect={groupSelect}
                disabled={pending || canvasBusy} readOnly={!structureEditable} onAdd={name => { setDraft({ ...draft, groups: [...groups, name] }); groupSelect(groupKey(name)); }}
                onRename={(id, name) => { const old = groups.find(group => groupKey(group) === id)!; setDraft({ ...draft, groups: groups.map(g => g === old ? name : g), questions: draft.questions.map(q => q.group === old ? { ...q, group: name } : q) }); groupSelect(groupKey(name)); }} onMove={moveGroup} />
              {structureEditable && <>
                {questions.length === 0 && [6, 8].map(count => <Button key={count} size="sm" variant="secondary" disabled={draft.questions.length + count > 60} onClick={() => setDraft({ ...draft, questions: [...draft.questions, ...createHomeworkQuestions(count, activeGroup)] })}>{t(`${count} 题模板`, `${count} questions`)}</Button>)}
                <Button size="sm" variant="secondary" disabled={draft.questions.length >= 60} onClick={() => addQuestion(true)}>{t("新增题目", "Add question")}</Button>
                {scope === "assignment" && state?.classTemplate && <Button size="sm" variant="secondary" onClick={() => {
                  const missing = state.classTemplate!.questions.filter(row => !draft.questions.some(current => current.group === row.group && current.label === row.label));
                  setDraft({ ...draft, questions: [...draft.questions, ...missing.map(row => ({ ...row, id: newId(), content: "", answer: "", composition: null, answerComposition: null, sourceQuestionId: null }))].slice(0, 60) });
                }}>{t("补入班级模板题号", "Add class template labels")}</Button>}
                {scope === "assignment" && state?.lectureTemplate && <Button size="sm" variant="secondary" onClick={() => setDraft({ ...draft, topic: state.lectureTemplate!.topic || draft.topic,
                  questions: draft.questions.map(row => { const source = state.lectureTemplate!.questions.find(q => q.group === row.group && q.label === row.label); return source && !row.content && !row.composition ? bindHomeworkQuestion(row, source) : row; }),
                })}>{t("采用本讲主题并补齐空题", "Use lesson topic and fill empty questions")}</Button>}
              </>}
              {scope === "assignment" && <Select value={studentId} onValueChange={setStudentId} disabled={pending}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="all">{t("全班共同题目", "Common questions")}</SelectItem>{state?.students.map(student => <SelectItem key={student.id} value={student.id}>{student.name}</SelectItem>)}
              </SelectContent></Select>}
              <span className="text-xs text-muted">{t(`${questions.length} 题 · Ctrl + Enter 连续新增`, `${questions.length} questions · Ctrl + Enter to add`)}</span>
            </DashboardCommandActions></DashboardCommandPanel>
            <DashboardTableShell><Table className="text-xs" containerClassName="max-h-[58vh] overflow-auto">
              <TableHeader className="sticky top-0 z-10"><TableRow><TableHead className="w-20">{t("题号", "No.")}</TableHead>{scope !== "classroom" && <><TableHead>{t("题目／题干", "Question / stem")}</TableHead><TableHead>{t("答案／解析", "Answer / explanation")}</TableHead></>}<TableHead className="w-36">{t("所属分组", "Group")}</TableHead><TableHead className="w-20">{t("操作", "Actions")}</TableHead></TableRow></TableHeader>
              <TableBody>{orderedGroups.map(group => <Fragment key={group}>
                <TableRow><TableCell colSpan={scope === "classroom" ? 3 : 5} className="font-medium">{group || t("未分组", "Ungrouped")} · {draft.questions.filter(q => q.group === group).length}</TableCell></TableRow>
                {draft.questions.filter(q => q.group === group).map(question => {
                  const composition = homeworkCompositionFor(draft, question.id, studentId === "all" ? undefined : studentId);
                  return <TableRow key={question.id} onKeyDown={event => { if (event.ctrlKey && event.key === "Enter" && structureEditable) { event.preventDefault(); addQuestion(true, question.group); } }}>
                    <TableCell className="align-top"><Input aria-label={t("题号", "Question number")} value={question.label} maxLength={100} disabled={!structureEditable} onChange={event => changeQuestion(question.id, { label: event.target.value })} /></TableCell>
                    {scope !== "classroom" && <>
                      <TableCell className="min-w-72 align-top">
                        <Textarea id={`homework-content-${question.id}`} aria-label={t("题目／题干", "Question / stem")} value={homeworkContentFor(draft, question.id, studentId === "all" ? undefined : studentId)} rows={2} maxLength={10000} disabled={!writable} readOnly={Boolean(composition)}
                          placeholder={composition ? t("交互题目", "Interactive question") : t("直接录入题干", "Enter question text")} onChange={event => {
                            if (studentId === "all") changeQuestion(question.id, { content: event.target.value });
                            else setDraft({ ...draft, overrides: [...draft.overrides.filter(row => row.studentId !== studentId || row.questionId !== question.id), { studentId, questionId: question.id, content: event.target.value, composition: null }] });
                          }} />
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setCanvas({ questionId: question.id, field: "content" })}>{!state?.canWrite ? t("查看题目", "View question") : composition ? t("编辑交互题目", "Edit interactive question") : t("交互题目编辑器", "Interactive question editor")}</Button>
                        {scope === "assignment" && studentId === "all" && Boolean(state?.lectureTemplate?.questions.length) && <Select disabled={!writable} value={question.sourceQuestionId ?? "custom"} onValueChange={id => {
                          const source = state!.lectureTemplate!.questions.find(row => row.id === id); changeQuestion(question.id, source ? bindHomeworkQuestion(question, source) : { sourceQuestionId: null });
                        }}><SelectTrigger aria-label={t("从本讲题库选题", "Select lesson question")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="custom">{t("自定义题目", "Custom question")}</SelectItem>
                          {state!.lectureTemplate!.questions.map(source => <SelectItem key={source.id} value={source.id}>{source.group} {source.label} · {source.content.slice(0, 40)}</SelectItem>)}
                        </SelectContent></Select>}
                        {studentId !== "all" && draft.overrides.some(row => row.studentId === studentId && row.questionId === question.id) && <Button size="sm" variant="ghost" disabled={!writable} onClick={() => setDraft({ ...draft, overrides: draft.overrides.filter(row => row.studentId !== studentId || row.questionId !== question.id) })}>{t("恢复共同题目", "Use common question")}</Button>}
                      </TableCell>
                      <TableCell className="min-w-60 align-top"><Textarea aria-label={t("答案／解析", "Answer / explanation")} value={question.answer} rows={2} maxLength={10000} disabled={!structureEditable} readOnly={Boolean(question.answerComposition)} onChange={event => changeQuestion(question.id, { answer: event.target.value })} />
                        <Button size="sm" variant="ghost" disabled={pending || studentId !== "all"} onClick={() => setCanvas({ questionId: question.id, field: "answer" })}>{state?.canWrite ? t("编辑交互答案", "Edit interactive answer") : t("查看答案", "View answer")}</Button>
                      </TableCell>
                    </>}
                    <TableCell className="align-top"><Select value={groupKey(question.group)} disabled={!structureEditable} onValueChange={value => changeQuestion(question.id, { group: groups.find(name => groupKey(name) === value) ?? "" })}><SelectTrigger aria-label={t("所属分组", "Group")}><SelectValue /></SelectTrigger><SelectContent>
                      <SelectItem value={UNGROUPED_QUESTIONS}>{t("未分组", "Ungrouped")}</SelectItem>{groups.map(name => <SelectItem key={name} value={groupKey(name)}>{name}</SelectItem>)}
                    </SelectContent></Select></TableCell>
                    <TableCell className="align-top">{scope !== "assignment" && <Button size="sm" variant="ghost" disabled={!structureEditable} onClick={() => setDraft({ ...draft, questions: draft.questions.filter(row => row.id !== question.id) })}>{t("移除", "Remove")}</Button>}</TableCell>
                  </TableRow>;
                })}
              </Fragment>)}</TableBody>
            </Table></DashboardTableShell>
          </TabsContent>
          {scope === "lecture" && <TabsContent value="plan" className="overflow-y-auto"><Label className="grid gap-2 text-sm">{t("标准教案", "Teaching plan")}<Textarea rows={16} value={draft.lessonPlan} maxLength={50000} disabled={!writable} onChange={event => setDraft({ ...draft, lessonPlan: event.target.value })} /></Label></TabsContent>}
        </Tabs>}
      </DialogContent>
    </Dialog>
  </>;
}
